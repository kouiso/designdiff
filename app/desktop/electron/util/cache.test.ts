import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 本物のファイルシステムを使う。差し替えると、名前の作り方と実際に置かれる
// 場所が合っているかという本題が確かめられない。
const mocks = vi.hoisted(() => ({ getPath: vi.fn() }));

vi.mock("electron", () => ({ app: { getPath: mocks.getPath } }));

describe("NodeFsCacheStrategy", () => {
  let userDataDir: string;

  beforeEach(async () => {
    userDataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "figdiff-cache-"));
    mocks.getPath.mockReturnValue(userDataDir);
    vi.resetModules();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await fs.promises.rm(userDataDir, { recursive: true, force: true });
  });

  async function createCache() {
    const { NodeFsCacheStrategy } = await import("./cache.js");
    return new NodeFsCacheStrategy();
  }

  it("保存先のディレクトリを作ること", async () => {
    const cache = await createCache();

    expect(fs.existsSync(path.join(userDataDir, "cache"))).toBe(true);
    expect(cache.get).toHaveLength(4);
    expect(cache.set).toHaveLength(5);
  });

  it("保存していないものは null を返すこと", async () => {
    const cache = await createCache();

    expect(await cache.get("FILE", "1:2", 2, undefined)).toBeNull();
  });

  it("保存したものをそのまま取り出せること", async () => {
    const cache = await createCache();
    const base64 = Buffer.from([1, 2, 3, 4]).toString("base64");

    await cache.set("FILE", "1:2", 2, undefined, base64);

    expect(await cache.get("FILE", "1:2", 2, undefined)).toBe(base64);
  });

  it("ファイル名に使えない文字を含むキーでも保存できること", async () => {
    const cache = await createCache();
    const base64 = Buffer.from("x").toString("base64");

    // ノードIDのコロンや、鍵に混じる記号がそのままだと保存できない。
    await cache.set("a/b:c*d", "10:20", 1, undefined, base64);

    expect(await cache.get("a/b:c*d", "10:20", 1, undefined)).toBe(base64);
  });

  it("倍率が違えば別のものとして扱うこと", async () => {
    const cache = await createCache();
    const one = Buffer.from("one").toString("base64");
    const two = Buffer.from("two").toString("base64");

    await cache.set("FILE", "1:2", 1, undefined, one);
    await cache.set("FILE", "1:2", 2, undefined, two);

    expect(await cache.get("FILE", "1:2", 1, undefined)).toBe(one);
    expect(await cache.get("FILE", "1:2", 2, undefined)).toBe(two);
  });

  it("同じnodeの未指定版とWindowsで大小文字が衝突するversionを分離すること", async () => {
    const cache = await createCache();
    const current = Buffer.from("current").toString("base64");
    const versionA = Buffer.from("version-a").toString("base64");
    const versionB = Buffer.from("version-b").toString("base64");

    await cache.set("FILE", "1:2", 2, undefined, current);
    await cache.set("FILE", "1:2", 2, "aaa", versionA);
    await cache.set("FILE", "1:2", 2, "aaG", versionB);

    await expect(cache.get("FILE", "1:2", 2, undefined)).resolves.toBe(current);
    await expect(cache.get("FILE", "1:2", 2, "aaa")).resolves.toBe(versionA);
    await expect(cache.get("FILE", "1:2", 2, "aaG")).resolves.toBe(versionB);
    expect(await fs.promises.readdir(path.join(userDataDir, "cache"))).toHaveLength(3);
  });

  it("FigmaClientの5引数setからversion固定画像を保存して再利用すること", async () => {
    const cache = await createCache();
    const imageBytes = new Uint8Array([1, 2, 3, 4]);
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      return url.hostname === "api.figma.com"
        ? new Response(JSON.stringify({ images: { "1:2": "https://image.example/frame.png" } }))
        : new Response(imageBytes);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { FigmaClient } = await import("@figdiff/shared");
    const client = new FigmaClient("figd_fixture_token_123456", cache);

    const first = await client.downloadImageAsBase64("FILE", "1:2", 2, "version-A");
    const second = await client.downloadImageAsBase64("FILE", "1:2", 2, "version-A");

    expect(first).toBe(Buffer.from(imageBytes).toString("base64"));
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("読み込みに失敗しても落ちずに null を返すこと", async () => {
    const cache = await createCache();
    await cache.set("FILE", "1:2", 2, undefined, Buffer.from("x").toString("base64"));

    // 保存先をディレクトリに差し替えて読み込みを失敗させる。
    const cachedPath = path.join(userDataDir, "cache", "FILE_1_2_2x.png");
    await fs.promises.rm(cachedPath);
    await fs.promises.mkdir(cachedPath);

    expect(await cache.get("FILE", "1:2", 2, undefined)).toBeNull();
  });
});

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
    await fs.promises.rm(userDataDir, { recursive: true, force: true });
  });

  async function createCache() {
    const { NodeFsCacheStrategy } = await import("./cache.js");
    return new NodeFsCacheStrategy();
  }

  it("保存先のディレクトリを作ること", async () => {
    await createCache();

    expect(fs.existsSync(path.join(userDataDir, "cache"))).toBe(true);
  });

  it("保存していないものは null を返すこと", async () => {
    const cache = await createCache();

    expect(await cache.get("FILE", "1:2", 2)).toBeNull();
  });

  it("保存したものをそのまま取り出せること", async () => {
    const cache = await createCache();
    const base64 = Buffer.from([1, 2, 3, 4]).toString("base64");

    await cache.set("FILE", "1:2", 2, base64);

    expect(await cache.get("FILE", "1:2", 2)).toBe(base64);
  });

  it("ファイル名に使えない文字を含むキーでも保存できること", async () => {
    const cache = await createCache();
    const base64 = Buffer.from("x").toString("base64");

    // ノードIDのコロンや、鍵に混じる記号がそのままだと保存できない。
    await cache.set("a/b:c*d", "10:20", 1, base64);

    expect(await cache.get("a/b:c*d", "10:20", 1)).toBe(base64);
  });

  it("倍率が違えば別のものとして扱うこと", async () => {
    const cache = await createCache();
    const one = Buffer.from("one").toString("base64");
    const two = Buffer.from("two").toString("base64");

    await cache.set("FILE", "1:2", 1, one);
    await cache.set("FILE", "1:2", 2, two);

    expect(await cache.get("FILE", "1:2", 1)).toBe(one);
    expect(await cache.get("FILE", "1:2", 2)).toBe(two);
  });

  it("読み込みに失敗しても落ちずに null を返すこと", async () => {
    const cache = await createCache();
    await cache.set("FILE", "1:2", 2, Buffer.from("x").toString("base64"));

    // 保存先をディレクトリに差し替えて読み込みを失敗させる。
    const cachedPath = path.join(userDataDir, "cache", "FILE_1_2_2x.png");
    await fs.promises.rm(cachedPath);
    await fs.promises.mkdir(cachedPath);

    expect(await cache.get("FILE", "1:2", 2)).toBeNull();
  });
});

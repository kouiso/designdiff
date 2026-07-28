import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 読み取りの許可範囲が本題なので、ファイルシステムは本物を使う。
// 撮影は窓を作るので、そこだけ差し替える。
const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  BrowserWindow: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: { handle: mocks.handle },
  BrowserWindow: mocks.BrowserWindow,
}));

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

describe("registerFileHandlers", () => {
  let workDir: string;
  let handlers: Map<string, Handler>;

  beforeEach(async () => {
    workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "figdiff-file-"));
    mocks.handle.mockClear();
    vi.resetModules();

    const { registerFileHandlers } = await import("./file.js");
    registerFileHandlers();

    handlers = new Map();
    for (const [channel, handler] of mocks.handle.mock.calls) {
      if (typeof channel === "string" && typeof handler === "function") {
        handlers.set(channel, handler);
      }
    }
  });

  afterEach(async () => {
    await fs.promises.rm(workDir, { recursive: true, force: true });
  });

  const invoke = (channel: string, ...args: unknown[]): Promise<unknown> => {
    const handler = handlers.get(channel);
    if (!handler) {
      throw new Error(`handler not registered: ${channel}`);
    }
    return handler({}, ...args);
  };

  it("許可された場所の画像を base64 で返すこと", async () => {
    const imagePath = path.join(workDir, "a.png");
    const bytes = Buffer.from([137, 80, 78, 71]);
    await fs.promises.writeFile(imagePath, bytes);

    expect(await invoke("file:read-local-image", imagePath)).toBe(bytes.toString("base64"));
  });

  it("許可されていない置き場所は弾くこと", async () => {
    // 読み取りの範囲を絞らないと、画面から任意のファイルを取り出せる。
    await expect(invoke("file:read-local-image", "/etc/passwd")).rejects.toThrow(
      /ホームディレクトリまたはシステム一時ディレクトリ/,
    );
  });

  it("画像でない拡張子は弾くこと", async () => {
    const textPath = path.join(workDir, "secret.txt");
    await fs.promises.writeFile(textPath, "x");

    await expect(invoke("file:read-local-image", textPath)).rejects.toThrow(
      /許可されていないファイル形式/,
    );
  });

  it("大文字の拡張子でも画像として扱うこと", async () => {
    const imagePath = path.join(workDir, "b.PNG");
    await fs.promises.writeFile(imagePath, Buffer.from([1]));

    await expect(invoke("file:read-local-image", imagePath)).resolves.toBeTypeOf("string");
  });

  it("無い画像を読もうとしたら、読み取りの失敗で終わること", async () => {
    await expect(
      invoke("file:read-local-image", path.join(workDir, "missing.png")),
    ).rejects.toThrow();
  });

  it("http でも https でもないURLの撮影は弾くこと", async () => {
    await expect(invoke("file:capture-url-screenshot", "file:///etc", 100, 100)).rejects.toThrow(
      /http/,
    );
    expect(mocks.BrowserWindow).not.toHaveBeenCalled();
  });
});

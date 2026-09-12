import { beforeEach, describe, expect, it, vi } from "vitest";

import { ActiveSessionPayloadSchema } from "./active-session.js";

// 進行中の比較は、比較サーバー側が書いたファイルを土台側が読んで画面へ渡す。
// 読み取りの範囲と、受け付ける形だけを見る。
const mocks = vi.hoisted(() => {
  const mainWindow = { webContents: { send: vi.fn() } };
  return {
    handle: vi.fn(),
    getAllWindows: vi.fn(() => [mainWindow]),
    mainWindow,
    readFile: vi.fn(),
    mkdir: vi.fn(() => Promise.resolve(undefined)),
    watch: vi.fn((..._args: unknown[]) => ({ on: vi.fn(), close: vi.fn() })),
  };
});

vi.mock("electron", () => ({
  ipcMain: { handle: mocks.handle },
  BrowserWindow: { getAllWindows: mocks.getAllWindows },
}));

vi.mock("node:fs/promises", () => ({
  default: { readFile: mocks.readFile, mkdir: mocks.mkdir },
  readFile: mocks.readFile,
  mkdir: mocks.mkdir,
}));

vi.mock("node:fs", () => ({
  default: { watch: mocks.watch },
  watch: mocks.watch,
}));

const VALID_PAYLOAD = {
  comparisonId: "cmp-1",
  sourceKey: "figma:FILE:1-2",
  designSource: "https://example.test/design",
  matchRate: 91.5,
  status: "UNCERTAIN",
  updatedAt: 1785000000000,
};

describe("ActiveSessionPayloadSchema", () => {
  it("人間レビューへ回した状態も受け付けること", () => {
    // 受け付けないと、いちばん人が見るべき比較だけ画面から消える。
    for (const status of ["PASS", "FAIL", "UNCERTAIN", "ERROR"]) {
      expect(ActiveSessionPayloadSchema.safeParse({ ...VALID_PAYLOAD, status }).success).toBe(true);
    }
  });

  it("知らない状態は受け付けないこと", () => {
    expect(
      ActiveSessionPayloadSchema.safeParse({ ...VALID_PAYLOAD, status: "MAYBE" }).success,
    ).toBe(false);
  });
});

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

describe("registerActiveSessionHandlers", () => {
  let handlers: Map<string, Handler>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.mkdir.mockReturnValue(Promise.resolve(undefined));
    mocks.watch.mockImplementation(() => ({ on: vi.fn(), close: vi.fn() }));
    mocks.getAllWindows.mockReturnValue([mocks.mainWindow]);
    vi.resetModules();

    const { registerActiveSessionHandlers } = await import("./active-session.js");
    registerActiveSessionHandlers();

    handlers = new Map();
    for (const [channel, handler] of mocks.handle.mock.calls) {
      if (typeof channel === "string" && typeof handler === "function") {
        handlers.set(channel, handler);
      }
    }
  });

  const invoke = (channel: string, ...args: unknown[]): Promise<unknown> => {
    const handler = handlers.get(channel);
    if (!handler) {
      throw new Error(`handler not registered: ${channel}`);
    }
    return handler({}, ...args);
  };

  it("読み取りの窓口を登録すること", () => {
    expect(handlers.has("active-session:read")).toBe(true);
    expect(handlers.has("active-session:read-image")).toBe(true);
  });

  it("保存された内容をそのまま返すこと", async () => {
    mocks.readFile.mockResolvedValue(JSON.stringify(VALID_PAYLOAD));

    expect(await invoke("active-session:read")).toEqual(VALID_PAYLOAD);
  });

  it("読めないときや形が違うときは null を返すこと", async () => {
    mocks.readFile.mockRejectedValue(new Error("ENOENT"));
    expect(await invoke("active-session:read")).toBeNull();

    mocks.readFile.mockResolvedValue("{ not json");
    expect(await invoke("active-session:read")).toBeNull();

    mocks.readFile.mockResolvedValue(JSON.stringify({ comparisonId: "only" }));
    expect(await invoke("active-session:read")).toBeNull();
  });

  it("決められた置き場所の外の画像は読まないこと", async () => {
    // 画面から任意のパスを渡せるので、範囲を絞らないと何でも取り出せる。
    expect(await invoke("active-session:read-image", "/etc/passwd")).toBeNull();
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it("決められた置き場所の画像は base64 で返すこと", async () => {
    const bytes = Buffer.from([137, 80, 78, 71]);
    mocks.readFile.mockResolvedValue(bytes);
    const { homedir } = await import("node:os");
    const { join } = await import("node:path");

    const result = await invoke(
      "active-session:read-image",
      join(homedir(), ".figdiff", "results", "a.png"),
    );

    expect(result).toBe(bytes.toString("base64"));
  });

  it("監視対象の更新を読み取り、画面へ通知すること", async () => {
    mocks.readFile.mockResolvedValue(JSON.stringify(VALID_PAYLOAD));
    await Promise.resolve();

    const callback = mocks.watch.mock.calls[0]?.[2];
    expect(callback).toBeTypeOf("function");
    if (typeof callback !== "function") throw new Error("watch callback was not registered");

    callback("change", "unrelated.json");
    expect(mocks.mainWindow.webContents.send).not.toHaveBeenCalled();
    callback("change", "active-session.json");
    await new Promise((resolve) => setTimeout(resolve, 220));

    expect(mocks.mainWindow.webContents.send).toHaveBeenCalledWith(
      "active-session:updated",
      VALID_PAYLOAD,
    );
  });

  it("画面が無い場合は更新を通知しないこと", async () => {
    mocks.getAllWindows.mockReturnValue([]);
    mocks.readFile.mockResolvedValue(JSON.stringify(VALID_PAYLOAD));
    await Promise.resolve();

    const callback = mocks.watch.mock.calls[0]?.[2];
    expect(callback).toBeTypeOf("function");
    if (typeof callback !== "function") throw new Error("watch callback was not registered");
    callback("change", "active-session.json");
    await new Promise((resolve) => setTimeout(resolve, 220));

    expect(mocks.mainWindow.webContents.send).not.toHaveBeenCalled();
  });

  it("監視対象の作成に失敗しても読み取り窓口を登録すること", async () => {
    mocks.mkdir.mockRejectedValue(new Error("mkdir failed"));
    vi.resetModules();
    const { registerActiveSessionHandlers } = await import("./active-session.js");
    registerActiveSessionHandlers();
    await Promise.resolve();

    expect(mocks.handle).toHaveBeenCalledWith("active-session:read", expect.any(Function));
  });
});

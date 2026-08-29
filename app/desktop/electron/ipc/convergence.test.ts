import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConvergenceHistorySchema } from "@figdiff/shared";

// MCP サーバが書いた収束履歴を読むだけの経路。読み取り範囲と、
// 壊れたファイルを混ぜたときに残りが読めることを見る。

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

const mocks = vi.hoisted(() => {
  const mainWindow = { webContents: { send: vi.fn() } };
  return {
    // handler を型付きで受けておく。ここを緩くすると、取り出すときに
    // 型アサーションが要るようになる (このリポジトリでは `as` を使わん)。
    handle: vi.fn<(channel: string, handler: Handler) => void>(),
    getAllWindows: vi.fn(() => [mainWindow]),
    mainWindow,
    readFile: vi.fn(),
    readdir: vi.fn(),
    mkdir: vi.fn(() => Promise.resolve(undefined)),
    watch: vi.fn(),
  };
});

vi.mock("electron", () => ({
  ipcMain: { handle: mocks.handle },
  BrowserWindow: { getAllWindows: mocks.getAllWindows },
}));

vi.mock("node:fs/promises", () => ({
  default: { readFile: mocks.readFile, readdir: mocks.readdir, mkdir: mocks.mkdir },
  readFile: mocks.readFile,
  readdir: mocks.readdir,
  mkdir: mocks.mkdir,
}));

vi.mock("node:fs", () => ({
  default: { watch: mocks.watch },
  watch: mocks.watch,
}));

const { registerConvergenceHandlers } = await import("./convergence.js");

const history = (sourceKey: string, updatedAt: number) => ({
  sourceKey,
  campaigns: [
    {
      campaignId: `camp-${sourceKey}`,
      sourceKey,
      startedAt: 1000,
      updatedAt,
      iterations: [
        {
          comparisonId: "cmp-1",
          matchRate: 98.5,
          structuralVerdict: "fail",
          status: "FAIL",
          timestamp: updatedAt,
        },
      ],
    },
  ],
});

const handlerFor = (channel: string): Handler => {
  const entry = mocks.handle.mock.calls.find((call) => call[0] === channel);
  if (!entry) throw new Error(`handler not registered: ${channel}`);
  return entry[1];
};

beforeEach(() => {
  mocks.handle.mockClear();
  mocks.readFile.mockReset();
  mocks.readdir.mockReset();
  registerConvergenceHandlers();
});

describe("registerConvergenceHandlers", () => {
  it("読み取りの窓口だけを登録する", () => {
    const channels = mocks.handle.mock.calls.map((call) => call[0]);
    expect(channels).toEqual(["convergence:list", "convergence:read"]);
  });

  it("最後に動いた順に並べて返す", async () => {
    mocks.readdir.mockResolvedValue(["old.json", "new.json"]);
    mocks.readFile.mockImplementation(async (filePath: string) =>
      filePath.endsWith("new.json")
        ? JSON.stringify(history("local:/new.png", 5000))
        : JSON.stringify(history("local:/old.png", 1000)),
    );

    const listed = ConvergenceHistorySchema.array().parse(
      await handlerFor("convergence:list")(null),
    );
    expect(listed.map((entry) => entry.sourceKey)).toEqual(["local:/new.png", "local:/old.png"]);
  });

  // 1つ壊れとるだけで全部見えんようになると、直す手掛かりまで消える。
  it("壊れたファイルは飛ばして残りを返す", async () => {
    mocks.readdir.mockResolvedValue(["broken.json", "ok.json", "notes.txt"]);
    mocks.readFile.mockImplementation(async (filePath: string) =>
      filePath.endsWith("ok.json") ? JSON.stringify(history("local:/ok.png", 2000)) : "{ not json",
    );

    const listed = await handlerFor("convergence:list")(null);
    expect(listed).toHaveLength(1);
  });

  // ファイル単位でも同じ。読めてへん1件を黙って落とすと、反復が減ったように見える。
  it("個々のファイルの権限やI/Oの失敗も握り潰さず伝える", async () => {
    mocks.readdir.mockResolvedValue(["denied.json"]);
    const denied: NodeJS.ErrnoException = new Error("EACCES: permission denied");
    denied.code = "EACCES";
    mocks.readFile.mockRejectedValue(denied);

    await expect(handlerFor("convergence:list")(null)).rejects.toThrow(/EACCES/);
  });

  // 一覧を取った後に保持上限で消えることはある。それは「無い」で正しい。
  it("読む直前に消えたファイルは飛ばす", async () => {
    mocks.readdir.mockResolvedValue(["gone.json", "ok.json"]);
    const missing: NodeJS.ErrnoException = new Error("ENOENT");
    missing.code = "ENOENT";
    mocks.readFile.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith("gone.json")) throw missing;
      return JSON.stringify(history("local:/ok.png", 2000));
    });

    const listed = ConvergenceHistorySchema.array().parse(
      await handlerFor("convergence:list")(null),
    );
    expect(listed.map((entry) => entry.sourceKey)).toEqual(["local:/ok.png"]);
  });

  it("置き場がまだ無いときは空配列を返す", async () => {
    const missing: NodeJS.ErrnoException = new Error("ENOENT");
    missing.code = "ENOENT";
    mocks.readdir.mockRejectedValue(missing);
    expect(await handlerFor("convergence:list")(null)).toEqual([]);
  });

  // 読めてへんことを空履歴として返すと、記録が無いのと区別がつかんようになる。
  it("権限やI/Oの失敗は握り潰さず伝える", async () => {
    const denied: NodeJS.ErrnoException = new Error("EACCES: permission denied");
    denied.code = "EACCES";
    mocks.readdir.mockRejectedValue(denied);

    await expect(handlerFor("convergence:list")(null)).rejects.toThrow(/EACCES/);
  });

  it("sourceKey を指定すると1件だけ返す", async () => {
    mocks.readdir.mockResolvedValue(["a.json", "b.json"]);
    mocks.readFile.mockImplementation(async (filePath: string) =>
      filePath.endsWith("a.json")
        ? JSON.stringify(history("local:/a.png", 1000))
        : JSON.stringify(history("local:/b.png", 2000)),
    );

    const found = ConvergenceHistorySchema.parse(
      await handlerFor("convergence:read")(null, "local:/a.png"),
    );
    expect(found.sourceKey).toBe("local:/a.png");
    expect(await handlerFor("convergence:read")(null, "local:/missing.png")).toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

// MCP サーバが書いた収束履歴を読むだけの経路。読み取り範囲と、
// 壊れたファイルを混ぜたときに残りが読めることを見る。
const mocks = vi.hoisted(() => {
  const mainWindow = { webContents: { send: vi.fn() } };
  return {
    handle: vi.fn(),
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

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

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
  return entry[1] as Handler;
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

    const listed = await handlerFor("convergence:list")(null);
    expect(listed).toHaveLength(2);
    expect((listed as { sourceKey: string }[]).map((h) => h.sourceKey)).toEqual([
      "local:/new.png",
      "local:/old.png",
    ]);
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

  it("履歴が無いときは空配列を返す", async () => {
    mocks.readdir.mockRejectedValue(new Error("ENOENT"));
    expect(await handlerFor("convergence:list")(null)).toEqual([]);
  });

  it("sourceKey を指定すると1件だけ返す", async () => {
    mocks.readdir.mockResolvedValue(["a.json", "b.json"]);
    mocks.readFile.mockImplementation(async (filePath: string) =>
      filePath.endsWith("a.json")
        ? JSON.stringify(history("local:/a.png", 1000))
        : JSON.stringify(history("local:/b.png", 2000)),
    );

    const found = await handlerFor("convergence:read")(null, "local:/a.png");
    expect((found as { sourceKey: string }).sourceKey).toBe("local:/a.png");
    expect(await handlerFor("convergence:read")(null, "local:/missing.png")).toBeNull();
  });
});

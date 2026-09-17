import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  list: vi.fn().mockResolvedValue([]),
  save: vi.fn().mockResolvedValue({ version: 1, regions: [] }),
  remove: vi.fn().mockResolvedValue({ version: 1, regions: [] }),
}));

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/home" },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      mocks.handlers.set(channel, handler),
  },
}));

vi.mock("@figdiff/shared/node/ignore-region-store", () => ({
  createIgnoreRegionStore: () => ({
    getIgnoreRegionConfig: mocks.list,
    setIgnoreRegionConfig: mocks.save,
    deleteIgnoreRegion: mocks.remove,
  }),
}));

describe("ignore region IPC", () => {
  beforeEach(async () => {
    mocks.handlers.clear();
    vi.clearAllMocks();
    const { registerIgnoreRegionHandlers } = await import("./ignore-region.js");
    registerIgnoreRegionHandlers();
  });

  it("validates and forwards a frame-scoped entry", async () => {
    const handler = mocks.handlers.get("ignore-region:save");
    await handler?.({}, "project-1", {
      id: "header-clock",
      frame_name: "Home",
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    });
    expect(mocks.save).toHaveBeenCalledWith("project-1", [
      expect.objectContaining({ id: "header-clock", frame_name: "Home" }),
    ]);
  });

  it("rejects traversal project ids before touching the store", async () => {
    const handler = mocks.handlers.get("ignore-region:list");
    expect(() => handler?.({}, "../outside", "Home")).toThrow();
    expect(mocks.list).not.toHaveBeenCalled();
  });
});

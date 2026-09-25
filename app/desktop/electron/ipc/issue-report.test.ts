import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  prepare: vi.fn(),
  submit: vi.fn(),
  discard: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      mocks.handlers.set(channel, handler),
  },
}));

describe("issue report IPC", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.handlers.clear();
    const { registerIssueReportHandlers } = await import("./issue-report.js");
    registerIssueReportHandlers({
      prepare: mocks.prepare,
      submit: mocks.submit,
      discard: mocks.discard,
    });
  });

  it("validates and forwards a report only to prepare", async () => {
    const input = { title: "  Problem  ", body: "  Details  ", category: "bug" };
    await mocks.handlers.get("issue-report:prepare")?.({}, input);

    expect(mocks.prepare).toHaveBeenCalledWith({
      title: "Problem",
      body: "Details",
      category: "bug",
    });
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("rejects invalid input before preparing a draft", () => {
    const handler = mocks.handlers.get("issue-report:prepare");
    expect(() => handler?.({}, { title: "", body: "Details", category: "secret" })).toThrow();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("submits and discards by draft ID only", async () => {
    await mocks.handlers.get("issue-report:submit")?.({}, "draft-1", "ignored payload");
    await mocks.handlers.get("issue-report:discard")?.({}, "draft-1", "ignored payload");

    expect(mocks.submit).toHaveBeenCalledWith("draft-1");
    expect(mocks.discard).toHaveBeenCalledWith("draft-1");
  });

  it("rejects malformed draft IDs before touching the service", () => {
    const handler = mocks.handlers.get("issue-report:submit");
    expect(() => handler?.({}, "")).toThrow();
    expect(mocks.submit).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const ipcMainHandle = vi.fn();
const getTelemetryConsent = vi.fn();
const setTelemetryConsent = vi.fn();
const trackTelemetryEventUnsafe = vi.fn();

vi.mock("electron", () => ({
  ipcMain: { handle: ipcMainHandle },
}));

vi.mock("../telemetry", () => ({
  getTelemetryConsent,
  setTelemetryConsent,
  trackTelemetryEventUnsafe,
}));

const findHandler = (channel: string) =>
  ipcMainHandle.mock.calls.find(([name]) => name === channel)?.[1];

describe("registerTelemetryHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("telemetry:get-consent は main 側の同意状態をそのまま返すこと", async () => {
    const { registerTelemetryHandlers } = await import("./telemetry-handler");
    getTelemetryConsent.mockReturnValue(true);
    registerTelemetryHandlers();

    const handler = findHandler("telemetry:get-consent");
    expect(handler).toBeTypeOf("function");
    expect(handler()).toBe(true);
  });

  it("telemetry:set-consent は boolean へ強制してから渡すこと", async () => {
    const { registerTelemetryHandlers } = await import("./telemetry-handler");
    registerTelemetryHandlers();

    const handler = findHandler("telemetry:set-consent");
    handler({}, true);
    expect(setTelemetryConsent).toHaveBeenCalledWith(true);

    // renderer から来た値が boolean でなくても、真偽へ落として渡す (=== true で厳密判定)
    handler({}, "true");
    expect(setTelemetryConsent).toHaveBeenLastCalledWith(false);
  });

  it("telemetry:track は name が string でなければ検証層に渡さず false を返すこと", async () => {
    const { registerTelemetryHandlers } = await import("./telemetry-handler");
    registerTelemetryHandlers();

    const handler = findHandler("telemetry:track");
    const result = handler({}, 42, { toolName: "compare_design" });

    expect(result).toBe(false);
    expect(trackTelemetryEventUnsafe).not.toHaveBeenCalled();
  });

  it("telemetry:track は name/properties をそのまま許可リスト検証層へ渡すこと", async () => {
    const { registerTelemetryHandlers } = await import("./telemetry-handler");
    trackTelemetryEventUnsafe.mockReturnValue(true);
    registerTelemetryHandlers();

    const handler = findHandler("telemetry:track");
    const properties = { toolName: "compare_design", durationMs: 5, ok: true };
    const result = handler({}, "mcp_tool_invoked", properties);

    expect(trackTelemetryEventUnsafe).toHaveBeenCalledWith("mcp_tool_invoked", properties);
    expect(result).toBe(true);
  });
});

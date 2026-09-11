import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMcpServer } from "../server.js";

const { setCropRegion } = vi.hoisted(() => ({ setCropRegion: vi.fn() }));
vi.mock("../service/crop-region-store.js", () => ({ setCropRegion }));

async function callTool(arguments_: Record<string, unknown>) {
  const server = createMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "set-crop-region-test", version: "1.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    return await client.callTool({ name: "set_crop_region", arguments: arguments_ });
  } finally {
    await client.close();
  }
}

describe("set_crop_region MCP handler", () => {
  beforeEach(() => {
    setCropRegion.mockReset();
    setCropRegion.mockResolvedValue({
      frameName: "Home",
      region: { x: 4, y: 8, width: 300, height: 600 },
      note: "status bar",
      updatedAt: "2026-01-01T00:00:00.000Z",
      capturedWidth: 390,
      capturedHeight: 692,
    });
  });

  it("saves the project, frame, rectangle, note, and captured dimensions", async () => {
    const region = { x: 4, y: 8, width: 300, height: 600 };
    const response = await callTool({
      project_id: "project_1",
      frame_name: "Home",
      region,
      note: "status bar",
      screenshot_width: 390,
      screenshot_height: 692,
    });

    expect(response.isError).toBeFalsy();
    expect(setCropRegion).toHaveBeenCalledWith("project_1", "Home", region, "status bar", {
      width: 390,
      height: 692,
    });
    expect(String((response.content[0] as { text?: string }).text)).toContain('"success": true');
  });

  it("rejects invalid project IDs and non-positive rectangle dimensions", async () => {
    const badProject = await callTool({
      project_id: "../outside",
      frame_name: "Home",
      region: { x: 0, y: 0, width: 1, height: 1 },
    });
    expect(badProject.isError).toBe(true);

    const badRegion = await callTool({
      project_id: "project_1",
      frame_name: "Home",
      region: { x: 0, y: 0, width: 0, height: 1 },
    });
    expect(badRegion.isError).toBe(true);
    expect(setCropRegion).not.toHaveBeenCalled();
  });

  it("propagates persistence errors as an MCP error result", async () => {
    setCropRegion.mockRejectedValueOnce(new Error("cannot write crop config"));
    const response = await callTool({
      project_id: "missing",
      frame_name: "Home",
      region: { x: 0, y: 0, width: 1, height: 1 },
    });
    expect(response.isError).toBe(true);
    expect(String((response.content[0] as { text?: string }).text)).toContain(
      "cannot write crop config",
    );
  });

  it("stringifies non-Error persistence failures safely", async () => {
    setCropRegion.mockRejectedValueOnce("crop store unavailable");
    const response = await callTool({
      project_id: "project_1",
      frame_name: "Home",
      region: { x: 0, y: 0, width: 1, height: 1 },
    });
    expect(response.isError).toBe(true);
    expect(String((response.content[0] as { text?: string }).text)).toContain(
      "crop store unavailable",
    );
  });
});

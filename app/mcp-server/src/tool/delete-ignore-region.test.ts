import { beforeEach, describe, expect, it, vi } from "vitest";

import { registerDeleteIgnoreRegion } from "./delete-ignore-region.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const mocks = vi.hoisted(() => ({
  deleteIgnoreRegion: vi.fn(),
}));

vi.mock("../service/ignore-region-store.js", () => ({
  deleteIgnoreRegion: mocks.deleteIgnoreRegion,
}));

type ToolHandler = (args: {
  project_id: string;
  frame_name?: string;
  region_id: string;
}) => Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }>;

describe("registerDeleteIgnoreRegion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers delete_ignore_region and deletes the requested region id", async () => {
    mocks.deleteIgnoreRegion.mockResolvedValue({
      version: 1,
      regions: [{ id: "keep", x: 0, y: 0, width: 10, height: 10 }],
    });
    const registerTool = vi.fn();
    const server = { registerTool } as unknown as McpServer;

    registerDeleteIgnoreRegion(server);

    expect(registerTool).toHaveBeenCalledTimes(1);
    const [name, config, handler] = registerTool.mock.calls[0] as [
      string,
      { inputSchema: { project_id: unknown; frame_name: unknown; region_id: unknown } },
      ToolHandler,
    ];
    expect(name).toBe("delete_ignore_region");
    expect(config.inputSchema).toHaveProperty("project_id");
    expect(config.inputSchema).toHaveProperty("frame_name");
    expect(config.inputSchema).toHaveProperty("region_id");

    const result = await handler({
      project_id: "demo-project",
      frame_name: "Home",
      region_id: "remove-me",
    });

    expect(mocks.deleteIgnoreRegion).toHaveBeenCalledWith("demo-project", "remove-me");
    expect(JSON.parse(result.content[0].text)).toEqual({
      success: true,
      deletedRegionId: "remove-me",
      frameName: "Home",
      regionCount: 1,
    });
  });
});

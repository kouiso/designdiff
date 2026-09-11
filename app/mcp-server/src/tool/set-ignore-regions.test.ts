import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMcpServer } from "../server.js";

const { setIgnoreRegionConfig } = vi.hoisted(() => ({ setIgnoreRegionConfig: vi.fn() }));
vi.mock("../service/ignore-region-store.js", () => ({ setIgnoreRegionConfig }));

async function callTool(arguments_: Record<string, unknown>) {
  const server = createMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "set-ignore-regions-test", version: "1.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    return await client.callTool({ name: "set_ignore_regions", arguments: arguments_ });
  } finally {
    await client.close();
  }
}

describe("set_ignore_regions MCP handler", () => {
  beforeEach(() => {
    setIgnoreRegionConfig.mockReset();
    setIgnoreRegionConfig.mockResolvedValue({
      version: 1,
      regions: [{ id: "header", x: 1, y: 2, width: 30, height: 40 }],
    });
  });

  it("saves the supplied project and rectangular regions", async () => {
    const regions = [{ id: "header", x: 1, y: 2, width: 30, height: 40, frame_name: "Home" }];
    const response = await callTool({ project_id: "project_1", regions });

    expect(response.isError).toBeFalsy();
    expect(setIgnoreRegionConfig).toHaveBeenCalledWith("project_1", regions);
    expect(response.content[0]).toMatchObject({ type: "text" });
    expect(response.content[0]?.type === "text" ? response.content[0].text : undefined).toContain(
      '"regionCount": 1',
    );
  });

  it("rejects invalid project IDs and rectangle dimensions at the public boundary", async () => {
    const badProject = await callTool({
      project_id: "../outside",
      regions: [{ id: "r", x: 0, y: 0, width: 1, height: 1 }],
    });
    expect(badProject.isError).toBe(true);

    const badRegion = await callTool({
      project_id: "project_1",
      regions: [{ id: "r", x: -1, y: 0, width: 1, height: 1 }],
    });
    expect(badRegion.isError).toBe(true);
    expect(setIgnoreRegionConfig).not.toHaveBeenCalled();
  });

  it("propagates persistence errors as an MCP error result", async () => {
    setIgnoreRegionConfig.mockRejectedValueOnce(new Error("project does not exist"));
    const response = await callTool({
      project_id: "missing",
      regions: [{ id: "r", x: 0, y: 0, width: 1, height: 1 }],
    });
    expect(response.isError).toBe(true);
    expect(response.content[0]?.type === "text" ? response.content[0].text : undefined).toContain(
      "project does not exist",
    );
  });

  it("stringifies non-Error persistence failures safely", async () => {
    setIgnoreRegionConfig.mockRejectedValueOnce("ignore store unavailable");
    const response = await callTool({
      project_id: "project_1",
      regions: [{ id: "r", x: 0, y: 0, width: 1, height: 1 }],
    });
    expect(response.isError).toBe(true);
    expect(response.content[0]?.type === "text" ? response.content[0].text : undefined).toContain(
      "ignore store unavailable",
    );
  });
});

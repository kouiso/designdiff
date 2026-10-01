// get_crop_region の正常系と異常系を実ファイルで検証する。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMcpServer } from "../server.js";
import { setCropRegion } from "../service/crop-region-store.js";

describe("get_crop_region MCP handler", () => {
  let directory: string;
  let client: Client;
  let server: ReturnType<typeof createMcpServer>;

  const callTool = (tool: string, arguments_: Record<string, unknown>) =>
    client.callTool({ name: tool, arguments: arguments_ });

  const payloadOf = (response: Awaited<ReturnType<typeof callTool>>) => {
    const block = response.content;
    if (!Array.isArray(block)) throw new Error("Missing content");
    const text = block.find((entry) => entry.type === "text")?.text;
    if (typeof text !== "string") throw new Error("Missing text content");
    return JSON.parse(text);
  };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "figdiff-get-crop-region-"));
    vi.stubEnv("FIGDIFF_PROJECTS_DIR", join(directory, "projects"));
    server = createMcpServer();
    client = new Client({ name: "get-crop-region-test", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(a), server.connect(b)]);
  });

  afterEach(async () => {
    await client?.close();
    await server?.close();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  const createProject = (id: string) =>
    callTool("create_project", { name: id, implementation_url: "https://example.com", id });

  it("存在しないプロジェクトはエラーではなく projectExists:false を返す", async () => {
    const response = await callTool("get_crop_region", { project_id: "missing" });
    expect(response.isError).toBeFalsy();
    expect(payloadOf(response)).toEqual({ projectExists: false, regionCount: 0, regions: [] });
  });

  it("crop 未設定のプロジェクトは空配列を返す", async () => {
    await createProject("proj-1");
    const response = await callTool("get_crop_region", { project_id: "proj-1" });
    expect(response.isError).toBeFalsy();
    expect(payloadOf(response)).toMatchObject({ projectExists: true, regionCount: 0 });
  });

  it("保存済みの crop を返し、frame_name で絞り込める", async () => {
    await createProject("proj-1");
    await setCropRegion("proj-1", "Home", { x: 0, y: 24, width: 390, height: 668 });
    await setCropRegion("proj-1", "Detail", { x: 0, y: 0, width: 390, height: 692 });

    const all = payloadOf(await callTool("get_crop_region", { project_id: "proj-1" }));
    expect(all.regionCount).toBe(2);

    const filtered = payloadOf(
      await callTool("get_crop_region", { project_id: "proj-1", frame_name: "Home" }),
    );
    expect(filtered.regionCount).toBe(1);
    expect(filtered.regions[0]).toMatchObject({
      frameName: "Home",
      region: { x: 0, y: 24, width: 390, height: 668 },
    });
  });

  it("パストラバーサルを含むIDを拒否する", async () => {
    const response = await callTool("get_crop_region", { project_id: "../escape" });
    expect(response.isError).toBe(true);
  });
});

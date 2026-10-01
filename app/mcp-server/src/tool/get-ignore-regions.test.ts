// get_ignore_regions の正常系と異常系を実ファイルで検証する。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMcpServer } from "../server.js";
import { setIgnoreRegionConfig } from "../service/ignore-region-store.js";

describe("get_ignore_regions MCP handler", () => {
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
    directory = await mkdtemp(join(tmpdir(), "figdiff-get-ignore-regions-"));
    vi.stubEnv("FIGDIFF_PROJECTS_DIR", join(directory, "projects"));
    server = createMcpServer();
    client = new Client({ name: "get-ignore-regions-test", version: "1" });
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
    const response = await callTool("get_ignore_regions", { project_id: "missing" });
    expect(response.isError).toBeFalsy();
    expect(payloadOf(response)).toEqual({ projectExists: false, regionCount: 0, regions: [] });
  });

  it("マスク未設定のプロジェクトは空配列を返す", async () => {
    await createProject("proj-1");
    const response = await callTool("get_ignore_regions", { project_id: "proj-1" });
    expect(response.isError).toBeFalsy();
    expect(payloadOf(response)).toMatchObject({ projectExists: true, regionCount: 0 });
  });

  it("保存済みのマスクを返し、frame_name で絞り込める", async () => {
    await createProject("proj-1");
    await setIgnoreRegionConfig("proj-1", [
      { id: "clock", x: 0, y: 0, width: 100, height: 24, label: "時計", frame_name: "Home" },
      { id: "ad", x: 0, y: 600, width: 390, height: 50, label: "広告" },
      { id: "other", x: 10, y: 10, width: 20, height: 20, frame_name: "Detail" },
    ]);

    const all = payloadOf(await callTool("get_ignore_regions", { project_id: "proj-1" }));
    expect(all.regionCount).toBe(3);

    // frame_name 指定時は「そのフレームのマスク + グローバル (frame_name なし) 」を返し、
    // 別フレーム固有のマスクは返さない。
    const filtered = payloadOf(
      await callTool("get_ignore_regions", { project_id: "proj-1", frame_name: "Home" }),
    );
    expect(filtered.regionCount).toBe(2);
    expect(filtered.regions.map((r: { id: string }) => r.id).sort()).toEqual(["ad", "clock"]);
  });

  it("パストラバーサルを含むIDを拒否する", async () => {
    const response = await callTool("get_ignore_regions", { project_id: "../escape" });
    expect(response.isError).toBe(true);
  });
});

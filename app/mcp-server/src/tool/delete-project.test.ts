// delete_project の正常系と異常系を実ファイルで検証する。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMcpServer } from "../server.js";
import { projectExists } from "../service/project-store.js";

describe("delete_project MCP handler", () => {
  let directory: string;
  let client: Client;
  let server: ReturnType<typeof createMcpServer>;

  const callTool = (tool: string, arguments_: Record<string, unknown>) =>
    client.callTool({ name: tool, arguments: arguments_ });

  const textOf = (response: Awaited<ReturnType<typeof callTool>>): string => {
    const block = response.content;
    if (!Array.isArray(block)) throw new Error("Missing content");
    const text = block.find((entry) => entry.type === "text")?.text;
    if (typeof text !== "string") throw new Error("Missing text content");
    return text;
  };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "figdiff-delete-project-"));
    vi.stubEnv("FIGDIFF_PROJECTS_DIR", join(directory, "projects"));
    server = createMcpServer();
    client = new Client({ name: "delete-project-test", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(a), server.connect(b)]);
  });

  afterEach(async () => {
    await client?.close();
    await server?.close();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("存在しないプロジェクトの削除はエラーを返す", async () => {
    const response = await callTool("delete_project", { project_id: "missing" });
    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain("not found");
  });

  it("既存プロジェクトを設定ごと削除する", async () => {
    await callTool("create_project", {
      name: "to-delete",
      implementation_url: "https://example.com",
      id: "proj-1",
    });
    const response = await callTool("delete_project", { project_id: "proj-1" });
    expect(response.isError).toBeFalsy();
    expect(JSON.parse(textOf(response))).toMatchObject({
      success: true,
      deleted_project_id: "proj-1",
    });
    await expect(projectExists("proj-1")).resolves.toBe(false);
  });

  it("パストラバーサルを含むIDを拒否する", async () => {
    const response = await callTool("delete_project", { project_id: "../escape" });
    expect(response.isError).toBe(true);
  });
});

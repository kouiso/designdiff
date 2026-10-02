// create_project の正常系と異常系を実ファイルで検証する。
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMcpServer } from "../server.js";

describe("create_project MCP handler", () => {
  let directory: string;
  let client: Client;
  let server: ReturnType<typeof createMcpServer>;

  const callTool = (arguments_: Record<string, unknown>) =>
    client.callTool({ name: "create_project", arguments: arguments_ });

  const textOf = (response: Awaited<ReturnType<typeof callTool>>): string => {
    const block = response.content;
    if (!Array.isArray(block)) throw new Error("Missing content");
    const text = block.find((entry) => entry.type === "text")?.text;
    if (typeof text !== "string") throw new Error("Missing text content");
    return text;
  };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "figdiff-create-project-"));
    vi.stubEnv("FIGDIFF_PROJECTS_DIR", join(directory, "projects"));
    server = createMcpServer();
    client = new Client({ name: "create-project-test", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(a), server.connect(b)]);
  });

  afterEach(async () => {
    await client?.close();
    await server?.close();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("プロジェクトを作成し、project.json を保存する", async () => {
    const response = await callTool({
      name: "sample",
      implementation_url: "https://example.com",
      id: "proj-1",
    });
    expect(response.isError).toBeFalsy();
    expect(JSON.parse(textOf(response))).toMatchObject({
      project_id: "proj-1",
      name: "sample",
    });
    const saved = JSON.parse(
      await readFile(join(directory, "projects", "proj-1", "project.json"), "utf-8"),
    );
    expect(saved).toMatchObject({ id: "proj-1", name: "sample", pages: [] });
  });

  it("id を省略すると自動生成する", async () => {
    const response = await callTool({
      name: "auto-id",
      implementation_url: "https://example.com",
    });
    expect(response.isError).toBeFalsy();
    expect(JSON.parse(textOf(response)).project_id).toMatch(/^[\w-]+$/);
  });

  it("既存IDと重複したらエラーを返し、既存ファイルを上書きしない", async () => {
    await callTool({ name: "first", implementation_url: "https://example.com", id: "dup" });
    const response = await callTool({
      name: "second",
      implementation_url: "https://example.com",
      id: "dup",
    });
    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain("already exists");
    const saved = JSON.parse(
      await readFile(join(directory, "projects", "dup", "project.json"), "utf-8"),
    );
    expect(saved.name).toBe("first");
  });

  it("パストラバーサルを含むIDを拒否する", async () => {
    const response = await callTool({
      name: "escape",
      implementation_url: "https://example.com",
      id: "../escape",
    });
    expect(response.isError).toBe(true);
  });

  it("URL でない implementation_url を拒否する", async () => {
    const response = await callTool({ name: "bad-url", implementation_url: "not-a-url" });
    expect(response.isError).toBe(true);
  });
});

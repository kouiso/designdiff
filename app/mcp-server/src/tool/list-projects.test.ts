import { randomInt, randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { listProjects, registerListProjects } from "./list-projects.js";

vi.mock("node:os", async () => {
  const actual = (await vi.importActual("node:os")) as { homedir: () => string };
  return {
    ...actual,
    homedir: vi.fn(() => actual.homedir()),
  };
});

const VALID_PROJECT = {
  id: "proj-abc",
  name: "Sample Project LP",
  implementationUrl: "http://localhost:3000",
  pages: [
    {
      id: "page-1",
      name: "Top",
      path: "/",
      designSources: [],
    },
    {
      id: "page-2",
      name: "Contact",
      path: "/contact",
      designSources: [],
    },
  ],
  createdAt: "2026-01-01T00:00:00+09:00",
  updatedAt: "2026-05-28T12:00:00+09:00",
};

const VALID_PROJECT_2 = {
  ...VALID_PROJECT,
  id: "proj-xyz",
  name: "Sample Corporate",
  implementationUrl: "https://example.com",
  pages: [],
  updatedAt: "2026-05-29T08:00:00+09:00",
};

// この検体は homedir から ~/.figdiff を解決する経路そのものを見る。
// vitest.setup.ts が全体へ入れとる FIGDIFF_HOME はここでは外す。
beforeEach(() => {
  vi.stubEnv("FIGDIFF_HOME", undefined);
  vi.stubEnv("FIGDIFF_PROJECTS_DIR", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("listProjects", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `figdiff-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    const { homedir } = await import("node:os");
    (homedir as Mock).mockReturnValue(testDir);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("プロジェクトディレクトリが空なら空配列を返す", () => {
    mkdirSync(join(testDir, ".figdiff", "projects"), { recursive: true });
    const result = listProjects();
    expect(result).toEqual([]);
  });

  it("有効なproject.jsonを持つプロジェクトをリストアップする", () => {
    const projectsDir = join(testDir, ".figdiff", "projects", VALID_PROJECT.id);
    mkdirSync(projectsDir, { recursive: true });
    writeFileSync(join(projectsDir, "project.json"), JSON.stringify(VALID_PROJECT));

    const result = listProjects();
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: "proj-abc",
      name: "Sample Project LP",
      implementationUrl: "http://localhost:3000",
      pageCount: 2,
      updatedAt: "2026-05-28T12:00:00+09:00",
      pages: VALID_PROJECT.pages,
    });
  });

  it("複数プロジェクトを updatedAt 降順で返す", () => {
    for (const project of [VALID_PROJECT, VALID_PROJECT_2]) {
      const dir = join(testDir, ".figdiff", "projects", project.id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "project.json"), JSON.stringify(project));
    }

    const result = listProjects();
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("proj-xyz");
    expect(result[1].id).toBe("proj-abc");
  });

  it("壊れたproject.jsonはスキップされる", () => {
    const goodDir = join(testDir, ".figdiff", "projects", VALID_PROJECT.id);
    mkdirSync(goodDir, { recursive: true });
    writeFileSync(join(goodDir, "project.json"), JSON.stringify(VALID_PROJECT));

    const badDir = join(testDir, ".figdiff", "projects", "corrupt-proj");
    mkdirSync(badDir, { recursive: true });
    writeFileSync(join(badDir, "project.json"), "{ invalid json ]]]");

    const result = listProjects();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(VALID_PROJECT.id);
  });

  it("Zodバリデーションが通らないproject.jsonはスキップされる", () => {
    const dir = join(testDir, ".figdiff", "projects", "invalid-schema");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "project.json"),
      JSON.stringify({ id: "x", name: "Missing required fields" }),
    );

    const result = listProjects();
    expect(result).toEqual([]);
  });

  it("project.jsonを持たないディレクトリはスキップされる", () => {
    const emptyDir = join(testDir, ".figdiff", "projects", "no-json");
    mkdirSync(emptyDir, { recursive: true });

    const result = listProjects();
    expect(result).toEqual([]);
  });

  it("前回ノードのキャッシュだけがあるディレクトリを登録済みプロジェクトに数えない", () => {
    const cacheDirectory = join(testDir, ".figdiff", "projects", "comparison-cache-only");
    mkdirSync(cacheDirectory, { recursive: true });
    writeFileSync(join(cacheDirectory, "last-used-node.json"), JSON.stringify({ entries: [] }));

    expect(listProjects()).toEqual([]);
  });

  it("MCP 応答だけで保存済みのページと比較対象を取得でき、未知の保存項目は含めない", async () => {
    const fileKey = randomUUID().replaceAll("-", "");
    const nodeId = `${randomInt(1, 1000)}:${randomInt(1, 1000)}`;
    const figmaUrl = `https://www.figma.com/design/${fileKey}/fixture?node-id=${nodeId.replace(":", "-")}`;
    const source = {
      type: "figma",
      id: "design-source",
      label: "Saved design",
      figmaUrl,
      fileKey,
      nodeId,
      frameName: "Saved frame",
    };
    const localSource = {
      type: "local_image",
      id: "local-source",
      label: "Reference image",
      filePath: join(testDir, "reference.png"),
    };
    const page = {
      ...VALID_PROJECT.pages[0],
      designSources: [source, localSource],
    };
    const projectDirectory = join(testDir, ".figdiff", "projects", VALID_PROJECT.id);
    mkdirSync(projectDirectory, { recursive: true });
    writeFileSync(
      join(projectDirectory, "project.json"),
      JSON.stringify({
        ...VALID_PROJECT,
        credentials: { accessToken: "test-only-private-field" },
        pages: [
          {
            ...page,
            designSources: [{ ...source, accessToken: "test-only-private-field" }, localSource],
          },
        ],
      }),
    );

    const server = new McpServer({ name: "saved-project-discovery", version: "1.0.0" });
    const client = new Client({ name: "saved-project-client", version: "1.0.0" });
    registerListProjects(server);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const result = await client.callTool({ name: "list_projects", arguments: {} });
      expect(result.isError).not.toBe(true);
      expect(result.content).toEqual([
        {
          type: "text",
          text: JSON.stringify(
            {
              projectCount: 1,
              projects: [
                {
                  id: VALID_PROJECT.id,
                  name: VALID_PROJECT.name,
                  implementationUrl: VALID_PROJECT.implementationUrl,
                  pageCount: 1,
                  updatedAt: VALID_PROJECT.updatedAt,
                  pages: [page],
                },
              ],
            },
            null,
            2,
          ),
        },
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it(".figdiff/projectsが存在しない場合はディレクトリを作成して空配列を返す", () => {
    const result = listProjects();
    expect(result).toEqual([]);
  });
});

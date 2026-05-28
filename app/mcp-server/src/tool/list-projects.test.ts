import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { listProjects } from "./list-projects.js";

vi.mock("node:os", async () => {
  const actual = await vi.importActual("node:os") as { homedir: () => string };
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

  it(".figdiff/projectsが存在しない場合はディレクトリを作成して空配列を返す", () => {
    const result = listProjects();
    expect(result).toEqual([]);
  });
});

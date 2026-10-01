// project-store の永続化まわりの異常系を実ファイルで検証する。
// 本物の FS に対して FIGDIFF_PROJECTS_DIR を向け替えて行う。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertProjectExists,
  deleteProjectDir,
  getProjectDir,
  projectExists,
  readProject,
  validateProjectId,
} from "./project-store.js";

const VALID_PROJECT = {
  id: "proj-1",
  name: "Sample",
  implementationUrl: "https://example.com",
  pages: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("project-store", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "figdiff-project-store-"));
    vi.stubEnv("FIGDIFF_PROJECTS_DIR", join(directory, "projects"));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  const writeProject = async (id: string, body: unknown = { ...VALID_PROJECT, id }) => {
    const dir = join(directory, "projects", id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "project.json"), JSON.stringify(body));
  };

  describe("validateProjectId", () => {
    it("英数字・ハイフン・アンダースコアのIDを受け入れる", () => {
      expect(() => validateProjectId("proj-1_ABC")).not.toThrow();
    });

    it("パストラバーサルや空白を含むIDを拒否する", () => {
      for (const id of ["../escape", "..", "a/b", "a b", ""]) {
        expect(() => validateProjectId(id)).toThrow("Invalid project ID");
      }
    });
  });

  describe("projectExists", () => {
    it("project.json が無いプロジェクトは false を返す", async () => {
      await expect(projectExists("missing")).resolves.toBe(false);
    });

    it("project.json があれば true を返す", async () => {
      await writeProject("proj-1");
      await expect(projectExists("proj-1")).resolves.toBe(true);
    });

    it("不正なIDは false ではなく例外にする (黙って見逃さない)", async () => {
      await expect(projectExists("../escape")).rejects.toThrow("Invalid project ID");
    });
  });

  describe("readProject", () => {
    it("保存したプロジェクトをスキーマ検証つきで読み戻す", async () => {
      await writeProject("proj-1");
      await expect(readProject("proj-1")).resolves.toMatchObject({
        id: "proj-1",
        name: "Sample",
      });
    });

    it("壊れた JSON は例外にする", async () => {
      const dir = join(directory, "projects", "broken");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "project.json"), "{ not json");
      await expect(readProject("broken")).rejects.toThrow();
    });

    it("スキーマに合わない JSON は例外にする", async () => {
      await writeProject("wrong-shape", { id: "wrong-shape" });
      await expect(readProject("wrong-shape")).rejects.toThrow();
    });

    it("存在しないプロジェクトは例外にする", async () => {
      await expect(readProject("missing")).rejects.toThrow();
    });
  });

  describe("assertProjectExists", () => {
    it("存在しないプロジェクトには作成を促すメッセージで失敗する", async () => {
      await expect(assertProjectExists("missing")).rejects.toThrow('project not found: "missing"');
    });

    it("存在するプロジェクトでは何もしない", async () => {
      await writeProject("proj-1");
      await expect(assertProjectExists("proj-1")).resolves.toBeUndefined();
    });
  });

  describe("deleteProjectDir", () => {
    it("プロジェクトディレクトリを中身ごと削除する", async () => {
      await writeProject("proj-1");
      await writeFile(join(getProjectDir("proj-1"), "crop-regions.json"), "{}");
      await deleteProjectDir("proj-1");
      await expect(projectExists("proj-1")).resolves.toBe(false);
    });

    it("存在しないディレクトリでも例外にしない", async () => {
      await expect(deleteProjectDir("missing")).resolves.toBeUndefined();
    });
  });

  describe("getProjectDir", () => {
    it("プロジェクトIDをプロジェクト置き場の配下に解決する", async () => {
      await writeProject("proj-1");
      await expect(readProject("proj-1")).resolves.toMatchObject({ id: "proj-1" });
      expect(getProjectDir("proj-1")).toBe(join(directory, "projects", "proj-1"));
    });
  });
});

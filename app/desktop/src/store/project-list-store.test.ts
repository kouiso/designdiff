import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Project } from "@figdiff/shared";

const { mockList, mockLoad, mockSave, mockDelete } = vi.hoisted(() => ({
  mockList: vi.fn().mockResolvedValue([]),
  mockLoad: vi.fn(),
  mockSave: vi.fn(),
  mockDelete: vi.fn(),
}));

vi.mock("@/lib/platform", () => ({
  getPlatform: vi.fn().mockResolvedValue({
    project: {
      list: mockList,
      load: mockLoad,
      save: mockSave,
      delete: mockDelete,
    },
  }),
}));

import { useProjectListStore } from "./project-list-store";

beforeEach(() => {
  vi.clearAllMocks();
  useProjectListStore.setState({
    projects: [],
    isLoading: false,
    error: null,
    currentProject: null,
    selectedPageId: null,
    selectedSourceId: null,
  });
});

describe("useProjectListStore", () => {
  describe("loadProjects", () => {
    it("プロジェクト一覧をロードできる", async () => {
      mockList.mockResolvedValueOnce([
        {
          id: "p1",
          name: "Test",
          implementationUrl: "http://localhost:3000",
          pageCount: 2,
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ]);
      await useProjectListStore.getState().loadProjects();
      expect(useProjectListStore.getState().projects).toHaveLength(1);
      expect(useProjectListStore.getState().projects[0]?.name).toBe("Test");
    });

    it("ロード失敗時にエラーをセットする", async () => {
      mockList.mockRejectedValueOnce(new Error("Network error"));
      await useProjectListStore.getState().loadProjects();
      expect(useProjectListStore.getState().error).toContain("Network error");
    });
  });

  describe("createProject", () => {
    it("プロジェクトを作成できる", async () => {
      mockSave.mockResolvedValueOnce(undefined);
      mockList.mockResolvedValueOnce([]);

      const project = await useProjectListStore
        .getState()
        .createProject("New", "http://localhost:3000");
      expect(project.name).toBe("New");
      expect(project.implementationUrl).toBe("http://localhost:3000");
      expect(project.pages).toEqual([]);
      expect(useProjectListStore.getState().currentProject?.name).toBe("New");
    });
  });

  describe("openProject", () => {
    it("プロジェクトを開ける", async () => {
      mockLoad.mockResolvedValueOnce({
        id: "p1",
        name: "Test",
        implementationUrl: "http://localhost:3000",
        pages: [{ id: "pg1", name: "Home", path: "/", designSources: [] }],
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      });
      await useProjectListStore.getState().openProject("p1");
      expect(useProjectListStore.getState().currentProject?.name).toBe("Test");
      expect(useProjectListStore.getState().selectedPageId).toBe("pg1");
    });

    it("古いopenProjectの完了結果でcurrentProjectを上書きしない", async () => {
      const projectA: Project = {
        id: "p1",
        name: "Project A",
        implementationUrl: "http://localhost:3000/a",
        pages: [{ id: "pg-a", name: "A", path: "/a", designSources: [] }],
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      };
      const projectB: Project = {
        id: "p2",
        name: "Project B",
        implementationUrl: "http://localhost:3000/b",
        pages: [{ id: "pg-b", name: "B", path: "/b", designSources: [] }],
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      };
      const resolvers = new Map<string, (project: Project) => void>();
      mockLoad.mockImplementation(
        (projectId: string) =>
          new Promise<Project>((resolve) => {
            resolvers.set(projectId, resolve);
          }),
      );

      const firstOpen = useProjectListStore.getState().openProject(projectA.id);
      const secondOpen = useProjectListStore.getState().openProject(projectB.id);
      await Promise.resolve();
      await Promise.resolve();

      expect(resolvers.has(projectA.id)).toBe(true);
      expect(resolvers.has(projectB.id)).toBe(true);

      resolvers.get(projectB.id)?.(projectB);
      await secondOpen;
      expect(useProjectListStore.getState().currentProject?.id).toBe(projectB.id);
      expect(useProjectListStore.getState().selectedPageId).toBe("pg-b");

      resolvers.get(projectA.id)?.(projectA);
      await firstOpen;
      expect(useProjectListStore.getState().currentProject?.id).toBe(projectB.id);
      expect(useProjectListStore.getState().selectedPageId).toBe("pg-b");
    });
  });

  describe("deleteProject", () => {
    it("プロジェクトを削除できる", async () => {
      mockDelete.mockResolvedValueOnce(undefined);
      mockList.mockResolvedValueOnce([]);
      useProjectListStore.setState({
        currentProject: {
          id: "p1",
          name: "Test",
          implementationUrl: "http://localhost:3000",
          pages: [],
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      });
      await useProjectListStore.getState().deleteProject("p1");
      expect(useProjectListStore.getState().currentProject).toBeNull();
    });

    it("別のプロジェクトを削除してもcurrentProjectは残る", async () => {
      mockDelete.mockResolvedValueOnce(undefined);
      mockList.mockResolvedValueOnce([]);
      useProjectListStore.setState({
        currentProject: {
          id: "p1",
          name: "Test",
          implementationUrl: "http://localhost:3000",
          pages: [],
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      });
      await useProjectListStore.getState().deleteProject("p2");
      expect(useProjectListStore.getState().currentProject?.id).toBe("p1");
    });
  });

  describe("saveCurrentProject", () => {
    it("現在のプロジェクトを保存できる", async () => {
      mockSave.mockResolvedValueOnce(undefined);
      useProjectListStore.setState({
        currentProject: {
          id: "p1",
          name: "Test",
          implementationUrl: "http://localhost:3000",
          pages: [],
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      });
      await useProjectListStore.getState().saveCurrentProject();
      expect(mockSave).toHaveBeenCalled();
    });

    it("currentProjectがnullなら何もしない", async () => {
      await useProjectListStore.getState().saveCurrentProject();
      expect(mockSave).not.toHaveBeenCalled();
    });
  });

  describe("selectPage / selectSource", () => {
    it("ページを選択できる", () => {
      useProjectListStore.getState().selectPage("pg-1");
      expect(useProjectListStore.getState().selectedPageId).toBe("pg-1");
      expect(useProjectListStore.getState().selectedSourceId).toBeNull();
    });

    it("ソースを選択できる", () => {
      useProjectListStore.getState().selectSource("src-1");
      expect(useProjectListStore.getState().selectedSourceId).toBe("src-1");
    });
  });

  describe("addPage", () => {
    it("currentProjectがnullなら何もしない", () => {
      useProjectListStore.getState().addPage("Home", "/home");
      expect(useProjectListStore.getState().currentProject).toBeNull();
    });
    it("ページを追加できる", () => {
      useProjectListStore.setState({
        currentProject: {
          id: "p1",
          name: "Test",
          implementationUrl: "http://localhost:3000",
          pages: [],
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      });
      useProjectListStore.getState().addPage("Home", "/home");
      const project = useProjectListStore.getState().currentProject;
      expect(project?.pages).toHaveLength(1);
      expect(project?.pages[0]?.name).toBe("Home");
      expect(project?.pages[0]?.path).toBe("/home");
    });
  });

  describe("removePage", () => {
    it("ページを削除できる", () => {
      useProjectListStore.setState({
        currentProject: {
          id: "p1",
          name: "Test",
          implementationUrl: "http://localhost:3000",
          pages: [{ id: "pg1", name: "Home", path: "/", designSources: [] }],
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
        selectedPageId: "pg1",
      });
      useProjectListStore.getState().removePage("pg1");
      expect(useProjectListStore.getState().currentProject?.pages).toHaveLength(0);
    });
  });

  describe("addDesignSource / removeDesignSource", () => {
    it("デザインソースを追加・削除できる", () => {
      useProjectListStore.setState({
        currentProject: {
          id: "p1",
          name: "Test",
          implementationUrl: "http://localhost:3000",
          pages: [{ id: "pg1", name: "Home", path: "/", designSources: [] }],
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      });

      useProjectListStore.getState().addDesignSource("pg1", {
        type: "figma",
        id: "src-1",
        label: "PC",
        figmaUrl: "https://figma.com/design/ABC/File",
        fileKey: "ABC",
      });

      const page = useProjectListStore.getState().currentProject?.pages.find((p) => p.id === "pg1");
      expect(page?.designSources).toHaveLength(1);

      useProjectListStore.getState().removeDesignSource("pg1", "src-1");
      const pageAfter = useProjectListStore
        .getState()
        .currentProject?.pages.find((p) => p.id === "pg1");
      expect(pageAfter?.designSources).toHaveLength(0);
    });
  });

  describe("clearError / resetCurrent", () => {
    it("エラーをクリアできる", () => {
      useProjectListStore.setState({ error: "test error" });
      useProjectListStore.getState().clearError();
      expect(useProjectListStore.getState().error).toBeNull();
    });

    it("現在のプロジェクトをリセットできる", () => {
      useProjectListStore.setState({
        currentProject: {
          id: "p1",
          name: "Test",
          implementationUrl: "http://localhost:3000",
          pages: [],
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
        selectedPageId: "pg1",
        selectedSourceId: "src-1",
      });
      useProjectListStore.getState().resetCurrent();
      expect(useProjectListStore.getState().currentProject).toBeNull();
      expect(useProjectListStore.getState().selectedPageId).toBeNull();
    });
  });
});

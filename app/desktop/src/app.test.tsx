import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Project } from "@figdiff/shared";

import { App } from "./app";
import { useOverlayStore } from "./store/overlay-store";
import { useProjectListStore } from "./store/project-list-store";
import { useTabStore } from "./store/tab-store";

const projectA: Project = {
  id: "project-a",
  name: "Project A",
  implementationUrl: "http://localhost:3000/a",
  pages: [],
  createdAt: "2026-05-04T00:00:00.000Z",
  updatedAt: "2026-05-04T00:00:00.000Z",
};

const projectB: Project = {
  id: "project-b",
  name: "Project B",
  implementationUrl: "http://localhost:3000/b",
  pages: [],
  createdAt: "2026-05-04T00:00:00.000Z",
  updatedAt: "2026-05-04T00:00:00.000Z",
};

const projectsById = new Map([
  [projectA.id, projectA],
  [projectB.id, projectB],
]);

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();

  Object.assign(window.electronAPI, {
    getFigmaToken: vi.fn().mockResolvedValue(null),
    project: {
      list: vi.fn().mockResolvedValue([
        {
          id: projectA.id,
          name: projectA.name,
          implementationUrl: projectA.implementationUrl,
          pageCount: projectA.pages.length,
          updatedAt: projectA.updatedAt,
        },
        {
          id: projectB.id,
          name: projectB.name,
          implementationUrl: projectB.implementationUrl,
          pageCount: projectB.pages.length,
          updatedAt: projectB.updatedAt,
        },
      ]),
      load: vi.fn().mockImplementation(async (projectId: string) => {
        const project = projectsById.get(projectId);
        if (!project) throw new Error(`Project not found: ${projectId}`);
        return project;
      }),
      save: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
  });

  useProjectListStore.setState({
    projects: [],
    isLoading: false,
    error: null,
    currentProject: projectA,
    selectedPageId: null,
    selectedSourceId: null,
  });
  useTabStore.setState({
    tabs: [
      { id: "tab-a", projectId: projectA.id, label: projectA.name, page: "project_view" },
      { id: "tab-b", projectId: projectB.id, label: projectB.name, page: "project_view" },
    ],
    activeTabId: "tab-a",
  });
});

describe("App", () => {
  it("プロジェクトタブの切り替えに currentProject が追従する", async () => {
    render(<App />);

    expect(screen.getAllByText("Project A").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText("Project B"));

    await waitFor(() => {
      expect(useProjectListStore.getState().currentProject?.id).toBe(projectB.id);
    });
    expect(screen.getAllByText("Project B").length).toBeGreaterThan(0);
    expect(window.electronAPI.project.load).toHaveBeenCalledWith(projectB.id);
  });

  it("設定へ遷移するとタブ選択が外れて設定画面だけが残る", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "設定" }));

    await waitFor(() => {
      expect(useTabStore.getState().activeTabId).toBeNull();
    });
    expect(screen.queryByTestId("project-view")).not.toBeInTheDocument();
  });

  it("ライブオーバーレイへ遷移した後ホームへ戻ると開いていたサイトを閉じる", async () => {
    const closeSite = vi.fn();
    useOverlayStore.setState({ closeSite });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "ライブオーバーレイ" }));
    await waitFor(() => {
      expect(useTabStore.getState().activeTabId).toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "ホーム" }));

    await waitFor(() => {
      expect(closeSite).toHaveBeenCalled();
    });
  });

  it("タブがある状態で比較へ遷移すると、そのタブのページが切り替わる", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "比較" }));

    await waitFor(() => {
      const tab = useTabStore.getState().tabs.find((t) => t.id === "tab-a");
      expect(tab?.page).toBe("compare");
    });
  });

  it("フレーム選択へ遷移すると、そのタブのページが project になる", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "フレーム選択" }));

    await waitFor(() => {
      const tab = useTabStore.getState().tabs.find((t) => t.id === "tab-a");
      expect(tab?.page).toBe("project");
    });
  });

  it("タブが無ければホームを選択状態にする", async () => {
    useTabStore.setState({ tabs: [], activeTabId: null });

    render(<App />);

    await waitFor(() => {
      expect(window.electronAPI.project.list).toHaveBeenCalled();
    });
    expect(screen.getByRole("button", { name: "ホーム" })).toHaveAttribute("aria-current", "page");
  });

  it("設定表示中にタブが選択されたら設定を閉じてタブ内容へ戻る", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "設定" }));
    await waitFor(() => {
      expect(useTabStore.getState().activeTabId).toBeNull();
    });

    fireEvent.click(screen.getByText("Project B"));

    await waitFor(() => {
      expect(useTabStore.getState().activeTabId).toBe("tab-b");
    });
    expect(screen.getAllByText("Project B").length).toBeGreaterThan(0);
  });
});

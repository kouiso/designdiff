import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useProjectListStore } from "@/store/project-list-store";

import { ProjectView } from "./project-view";

vi.mock("@/lib/platform", () => ({
  getPlatform: vi.fn().mockResolvedValue({
    project: { list: vi.fn(), load: vi.fn(), save: vi.fn(), delete: vi.fn() },
    figma: { getFrames: vi.fn(), getFrameImage: vi.fn(), getNodeDetail: vi.fn() },
    token: { get: vi.fn(), save: vi.fn(), delete: vi.fn() },
    file: { readLocalImage: vi.fn(), captureUrlScreenshot: vi.fn() },
  }),
}));

afterEach(cleanup);

beforeEach(() => {
  useProjectListStore.setState({
    projects: [],
    isLoading: false,
    error: null,
    currentProject: null,
    selectedPageId: null,
    selectedSourceId: null,
  });
});

describe("ProjectView", () => {
  it("currentProjectがnullなら空メッセージが表示される", () => {
    render(<ProjectView onNavigate={vi.fn()} />);
    expect(screen.getByText("No project loaded")).toBeInTheDocument();
  });

  it("プロジェクト名と実装URLが表示される", () => {
    useProjectListStore.setState({
      currentProject: {
        id: "p1",
        name: "テストプロジェクト",
        implementationUrl: "http://localhost:3000",
        pages: [],
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    });
    render(<ProjectView onNavigate={vi.fn()} />);
    expect(screen.getByText("テストプロジェクト")).toBeInTheDocument();
    expect(screen.getByText("http://localhost:3000")).toBeInTheDocument();
  });

  it("ページがない場合に追加促すメッセージが表示される", () => {
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
    render(<ProjectView onNavigate={vi.fn()} />);
    expect(screen.getByText("Add a page to start")).toBeInTheDocument();
  });

  it("ページ一覧が表示される", () => {
    useProjectListStore.setState({
      currentProject: {
        id: "p1",
        name: "Test",
        implementationUrl: "http://localhost:3000",
        pages: [
          { id: "pg1", name: "Home", path: "/home", designSources: [] },
          { id: "pg2", name: "About", path: "/about", designSources: [] },
        ],
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
      selectedPageId: "pg1",
    });
    render(<ProjectView onNavigate={vi.fn()} />);
    expect(screen.getByText("/home")).toBeInTheDocument();
    expect(screen.getByText("/about")).toBeInTheDocument();
  });

  it("選択中ページのデザインソースが表示される", () => {
    useProjectListStore.setState({
      currentProject: {
        id: "p1",
        name: "Test",
        implementationUrl: "http://localhost:3000",
        pages: [
          {
            id: "pg1",
            name: "Home",
            path: "/home",
            designSources: [
              {
                type: "figma",
                id: "src1",
                label: "PC版デザイン",
                figmaUrl: "https://figma.com/design/ABC/File",
                fileKey: "ABC",
              },
            ],
          },
        ],
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
      selectedPageId: "pg1",
    });
    render(<ProjectView onNavigate={vi.fn()} />);
    expect(screen.getByText("PC版デザイン")).toBeInTheDocument();
    expect(screen.getByText("Figma")).toBeInTheDocument();
  });

  it("ページが選択されていない場合にガイダンスが表示される", () => {
    useProjectListStore.setState({
      currentProject: {
        id: "p1",
        name: "Test",
        implementationUrl: "http://localhost:3000",
        pages: [{ id: "pg1", name: "Home", path: "/home", designSources: [] }],
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
      selectedPageId: null,
    });
    render(<ProjectView onNavigate={vi.fn()} />);
    expect(screen.getByText("Getting Started")).toBeInTheDocument();
  });
});

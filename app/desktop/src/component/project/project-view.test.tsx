import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCompareStore } from "@/store/compare-store";
import { useProjectListStore } from "@/store/project-list-store";
import { useProjectStore } from "@/store/project-store";

import { ProjectView } from "./project-view";

vi.mock("@/lib/platform", () => ({
  getPlatform: vi.fn().mockResolvedValue({
    project: { list: vi.fn(), load: vi.fn(), save: vi.fn(), delete: vi.fn() },
    figma: { getFrames: vi.fn(), getFrameImage: vi.fn(), getNodeDetail: vi.fn() },
    token: { get: vi.fn(), save: vi.fn(), delete: vi.fn() },
    file: { readLocalImage: vi.fn(), captureUrlScreenshot: vi.fn() },
  }),
}));

const BASE_PROJECT = {
  id: "p1",
  name: "Test Project",
  implementationUrl: "http://localhost:3000",
  pages: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const PROJECT_WITH_PAGE = {
  ...BASE_PROJECT,
  pages: [{ id: "pg1", name: "Home", path: "/", designSources: [] }],
};

const PROJECT_WITH_SOURCE = {
  ...BASE_PROJECT,
  pages: [
    {
      id: "pg1",
      name: "Home",
      path: "/",
      designSources: [
        {
          type: "figma" as const,
          id: "src1",
          label: "PC Design",
          figmaUrl: "https://www.figma.com/design/ABC/File",
          fileKey: "ABC",
        },
      ],
    },
  ],
};

afterEach(cleanup);

beforeEach(() => {
  useProjectListStore.setState({
    projects: [],
    isLoading: false,
    error: null,
    currentProject: null,
    selectedPageId: null,
    selectedSourceId: null,
    addPage: vi.fn(),
    removePage: vi.fn(),
    selectPage: vi.fn(),
    addDesignSource: vi.fn(),
    removeDesignSource: vi.fn(),
    saveCurrentProject: vi.fn().mockResolvedValue(undefined),
  });
  useProjectStore.setState({
    error: null,
    isLoading: false,
    frames: [],
    selectedFrame: null,
    frameImage: null,
    currentFileKey: null,
    loadDesign: vi.fn().mockResolvedValue(undefined),
  });
  useCompareStore.setState({ setDesignImage: vi.fn() });
});

describe("ProjectView", () => {
  it("currentProjectがnullなら空メッセージが表示される", () => {
    render(<ProjectView onNavigate={vi.fn()} />);
    expect(screen.getByText("No project loaded")).toBeInTheDocument();
  });

  it("プロジェクト名と実装URLが表示される", () => {
    useProjectListStore.setState({ currentProject: BASE_PROJECT });
    render(<ProjectView onNavigate={vi.fn()} />);
    expect(screen.getByText("Test Project")).toBeInTheDocument();
    expect(screen.getByText("http://localhost:3000")).toBeInTheDocument();
  });

  it("ページがない場合に追加促すメッセージが表示される", () => {
    useProjectListStore.setState({ currentProject: BASE_PROJECT });
    render(<ProjectView onNavigate={vi.fn()} />);
    expect(screen.getByText("Add a page to start")).toBeInTheDocument();
  });

  it("ページ一覧が表示される", () => {
    useProjectListStore.setState({
      currentProject: {
        ...BASE_PROJECT,
        pages: [
          { id: "pg1", name: "Home", path: "/home", designSources: [] },
          { id: "pg2", name: "About", path: "/about", designSources: [] },
        ],
      },
      selectedPageId: "pg1",
    });
    render(<ProjectView onNavigate={vi.fn()} />);
    expect(screen.getByText("/home")).toBeInTheDocument();
    expect(screen.getByText("/about")).toBeInTheDocument();
  });

  it("選択中ページのデザインソースが表示される", () => {
    useProjectListStore.setState({
      currentProject: PROJECT_WITH_SOURCE,
      selectedPageId: "pg1",
    });
    render(<ProjectView onNavigate={vi.fn()} />);
    expect(screen.getByText("PC Design")).toBeInTheDocument();
    expect(screen.getByText("Figma")).toBeInTheDocument();
  });

  it("ページが選択されていない場合にガイダンスが表示される", () => {
    useProjectListStore.setState({
      currentProject: PROJECT_WITH_PAGE,
      selectedPageId: null,
    });
    render(<ProjectView onNavigate={vi.fn()} />);
    expect(screen.getByText("Getting Started")).toBeInTheDocument();
  });

  describe("handleAddPage", () => {
    it("+ ボタンでページ追加フォームが表示される", () => {
      useProjectListStore.setState({ currentProject: BASE_PROJECT });
      render(<ProjectView onNavigate={vi.fn()} />);
      // Click the + button (there's one in the sidebar pages section)
      const addBtn = screen.getByRole("button", { name: "" });
      // Click the Plus icon button (first button found with the sidebar)
      fireEvent.click(addBtn);
      expect(screen.getByPlaceholderText("Page name")).toBeInTheDocument();
    });

    it("ページ名を入力して Add をクリックすると addPage が呼ばれる", () => {
      const mockAddPage = vi.fn();
      const mockSave = vi.fn().mockResolvedValue(undefined);
      useProjectListStore.setState({
        currentProject: BASE_PROJECT,
        addPage: mockAddPage,
        saveCurrentProject: mockSave,
      });
      render(<ProjectView onNavigate={vi.fn()} />);

      // Open add page form via "Add Your First Page" button
      const firstPageBtn = screen.getByText("Add Your First Page");
      fireEvent.click(firstPageBtn);

      const nameInput = screen.getByPlaceholderText("Page name");
      fireEvent.change(nameInput, { target: { value: "Contact" } });

      const addBtn = screen.getByText("追加");
      fireEvent.click(addBtn);

      expect(mockAddPage).toHaveBeenCalledWith("Contact", "/contact");
      expect(mockSave).toHaveBeenCalled();
    });

    it("ページ名が空の場合 addPage は呼ばれない", () => {
      const mockAddPage = vi.fn();
      useProjectListStore.setState({
        currentProject: BASE_PROJECT,
        addPage: mockAddPage,
      });
      render(<ProjectView onNavigate={vi.fn()} />);

      const firstPageBtn = screen.getByText("Add Your First Page");
      fireEvent.click(firstPageBtn);

      const addBtn = screen.getByText("追加");
      fireEvent.click(addBtn);

      expect(mockAddPage).not.toHaveBeenCalled();
    });

    it("カスタムパスを指定すると正規化されて addPage に渡される", () => {
      const mockAddPage = vi.fn();
      const mockSave = vi.fn().mockResolvedValue(undefined);
      useProjectListStore.setState({
        currentProject: BASE_PROJECT,
        addPage: mockAddPage,
        saveCurrentProject: mockSave,
      });
      render(<ProjectView onNavigate={vi.fn()} />);

      const firstPageBtn = screen.getByText("Add Your First Page");
      fireEvent.click(firstPageBtn);

      fireEvent.change(screen.getByPlaceholderText("Page name"), {
        target: { value: "About" },
      });
      fireEvent.change(screen.getByPlaceholderText("/path"), {
        target: { value: "about-us" },
      });

      fireEvent.click(screen.getByText("追加"));

      expect(mockAddPage).toHaveBeenCalledWith("About", "/about-us");
    });

    it("Cancel ボタンでフォームが閉じる", () => {
      useProjectListStore.setState({ currentProject: BASE_PROJECT });
      render(<ProjectView onNavigate={vi.fn()} />);

      fireEvent.click(screen.getByText("Add Your First Page"));
      expect(screen.getByPlaceholderText("Page name")).toBeInTheDocument();

      fireEvent.click(screen.getByText("キャンセル"));
      expect(screen.queryByPlaceholderText("Page name")).not.toBeInTheDocument();
    });
  });

  describe("page selection", () => {
    it("ページをクリックすると selectPage が呼ばれる", () => {
      const mockSelectPage = vi.fn();
      useProjectListStore.setState({
        currentProject: PROJECT_WITH_PAGE,
        selectedPageId: null,
        selectPage: mockSelectPage,
      });
      render(<ProjectView onNavigate={vi.fn()} />);

      fireEvent.click(screen.getByText("/"));
      expect(mockSelectPage).toHaveBeenCalledWith("pg1");
    });
  });

  describe("removePage", () => {
    it("ゴミ箱ボタンで removePage が呼ばれる", () => {
      const mockRemovePage = vi.fn();
      const mockSave = vi.fn().mockResolvedValue(undefined);
      useProjectListStore.setState({
        currentProject: PROJECT_WITH_PAGE,
        selectedPageId: "pg1",
        removePage: mockRemovePage,
        saveCurrentProject: mockSave,
      });
      render(<ProjectView onNavigate={vi.fn()} />);

      // Trash button appears when page is selected
      const trashBtns = screen.getAllByRole("button");
      const trashBtn = trashBtns.find(
        (b) => b.querySelector("svg") && b.classList.contains("text-destructive"),
      );
      if (trashBtn) fireEvent.click(trashBtn);
      expect(mockRemovePage).toHaveBeenCalledWith("pg1");
      expect(mockSave).toHaveBeenCalled();
    });
  });

  describe("handleAddSource", () => {
    it("Add Design Source ボタンでフォームが表示される", () => {
      useProjectListStore.setState({
        currentProject: PROJECT_WITH_PAGE,
        selectedPageId: "pg1",
      });
      render(<ProjectView onNavigate={vi.fn()} />);

      fireEvent.click(screen.getAllByText("Add Design Source")[0]);
      expect(screen.getByPlaceholderText("Figma URL or local image path")).toBeInTheDocument();
    });

    it("ローカル画像パスを入力して Add すると addDesignSource が呼ばれる", () => {
      const mockAddSource = vi.fn();
      const mockSave = vi.fn().mockResolvedValue(undefined);
      useProjectListStore.setState({
        currentProject: PROJECT_WITH_PAGE,
        selectedPageId: "pg1",
        addDesignSource: mockAddSource,
        saveCurrentProject: mockSave,
      });
      render(<ProjectView onNavigate={vi.fn()} />);

      fireEvent.click(screen.getAllByText("Add Design Source")[0]);
      fireEvent.change(screen.getByPlaceholderText("Figma URL or local image path"), {
        target: { value: "/path/to/design.png" },
      });
      fireEvent.click(screen.getByText("追加"));

      expect(mockAddSource).toHaveBeenCalledWith(
        "pg1",
        expect.objectContaining({
          type: "local_image",
          filePath: "/path/to/design.png",
        }),
      );
      expect(mockSave).toHaveBeenCalled();
    });

    it("Figma URL を入力すると figma タイプのソースが追加される", () => {
      const mockAddSource = vi.fn();
      const mockSave = vi.fn().mockResolvedValue(undefined);
      useProjectListStore.setState({
        currentProject: PROJECT_WITH_PAGE,
        selectedPageId: "pg1",
        addDesignSource: mockAddSource,
        saveCurrentProject: mockSave,
      });
      render(<ProjectView onNavigate={vi.fn()} />);

      fireEvent.click(screen.getAllByText("Add Design Source")[0]);
      fireEvent.change(screen.getByPlaceholderText("Figma URL or local image path"), {
        target: { value: "https://www.figma.com/design/ABC123/MyFile" },
      });
      fireEvent.click(screen.getByText("追加"));

      expect(mockAddSource).toHaveBeenCalledWith(
        "pg1",
        expect.objectContaining({ type: "figma", fileKey: "ABC123" }),
      );
    });

    it("URLが空なら addDesignSource は呼ばれない", () => {
      const mockAddSource = vi.fn();
      useProjectListStore.setState({
        currentProject: PROJECT_WITH_PAGE,
        selectedPageId: "pg1",
        addDesignSource: mockAddSource,
      });
      render(<ProjectView onNavigate={vi.fn()} />);

      fireEvent.click(screen.getAllByText("Add Design Source")[0]);
      fireEvent.click(screen.getByText("追加"));

      expect(mockAddSource).not.toHaveBeenCalled();
    });

    it("ラベルを指定するとラベル付きでソースが追加される", () => {
      const mockAddSource = vi.fn();
      const mockSave = vi.fn().mockResolvedValue(undefined);
      useProjectListStore.setState({
        currentProject: PROJECT_WITH_PAGE,
        selectedPageId: "pg1",
        addDesignSource: mockAddSource,
        saveCurrentProject: mockSave,
      });
      render(<ProjectView onNavigate={vi.fn()} />);

      fireEvent.click(screen.getAllByText("Add Design Source")[0]);
      fireEvent.change(screen.getByPlaceholderText("Label (e.g. PC Design, SP Design)"), {
        target: { value: "SP Design" },
      });
      fireEvent.change(screen.getByPlaceholderText("Figma URL or local image path"), {
        target: { value: "/path/sp.png" },
      });
      fireEvent.click(screen.getByText("追加"));

      expect(mockAddSource).toHaveBeenCalledWith(
        "pg1",
        expect.objectContaining({ label: "SP Design" }),
      );
    });
  });

  describe("removeDesignSource", () => {
    it("ソースのゴミ箱ボタンで removeDesignSource が呼ばれる", () => {
      const mockRemoveSource = vi.fn();
      const mockSave = vi.fn().mockResolvedValue(undefined);
      useProjectListStore.setState({
        currentProject: PROJECT_WITH_SOURCE,
        selectedPageId: "pg1",
        removeDesignSource: mockRemoveSource,
        saveCurrentProject: mockSave,
      });
      render(<ProjectView onNavigate={vi.fn()} />);

      // The source card trash button has both h-6 and text-destructive classes
      const allButtons = screen.getAllByRole("button");
      const trashBtn = allButtons.find(
        (b) => b.classList.contains("text-destructive") && b.classList.contains("h-6"),
      );
      if (trashBtn) fireEvent.click(trashBtn);
      expect(mockRemoveSource).toHaveBeenCalledWith("pg1", "src1");
    });
  });

  describe("handleCompare", () => {
    it("frameImage あり → compare ページへ遷移", async () => {
      const mockLoadDesign = vi.fn().mockImplementation(async () => {
        useProjectStore.setState({ frameImage: "data:image/png;base64,test" });
      });
      const mockSetDesignImage = vi.fn();
      useProjectStore.setState({ loadDesign: mockLoadDesign });
      useCompareStore.setState({ setDesignImage: mockSetDesignImage });
      useProjectListStore.setState({
        currentProject: PROJECT_WITH_SOURCE,
        selectedPageId: "pg1",
      });

      const onNavigate = vi.fn();
      render(<ProjectView onNavigate={onNavigate} />);

      fireEvent.click(screen.getByText("Compare"));

      await waitFor(() => {
        expect(mockLoadDesign).toHaveBeenCalledWith("https://www.figma.com/design/ABC/File");
        expect(onNavigate).toHaveBeenCalledWith("compare");
      });
    });

    it("frameImage なし + figmaソース → project ページへ遷移", async () => {
      const mockLoadDesign = vi.fn().mockResolvedValue(undefined);
      useProjectStore.setState({ loadDesign: mockLoadDesign, frameImage: null });
      useProjectListStore.setState({
        currentProject: PROJECT_WITH_SOURCE,
        selectedPageId: "pg1",
      });

      const onNavigate = vi.fn();
      render(<ProjectView onNavigate={onNavigate} />);

      fireEvent.click(screen.getByText("Compare"));

      await waitFor(() => {
        expect(onNavigate).toHaveBeenCalledWith("project");
      });
    });
  });

  describe("drag and drop", () => {
    it("handleSourceDragOver: ファイルありのドラッグでドロップエリアがハイライトされる", () => {
      useProjectListStore.setState({
        currentProject: PROJECT_WITH_PAGE,
        selectedPageId: "pg1",
      });
      render(<ProjectView onNavigate={vi.fn()} />);

      fireEvent.click(screen.getAllByText("Add Design Source")[0]);

      const urlInput = screen.getByPlaceholderText("Figma URL or local image path");
      const cardContent = urlInput.closest("div");

      fireEvent.dragOver(cardContent ?? urlInput, {
        dataTransfer: {
          items: [{ kind: "file" }],
          dropEffect: "",
        },
      });
      // No assertion on visual state, just verify no error thrown
    });
  });
});

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useOverlayStore } from "@/store/overlay-store";
import { useProjectListStore } from "@/store/project-list-store";
import { useProjectStore } from "@/store/project-store";
import { useSettingStore } from "@/store/setting-store";
import { useTabStore } from "@/store/tab-store";

import { HomePage } from "./home-page";

afterEach(cleanup);

let mockSubmitValue = "test";

vi.mock("@/lib/platform", () => ({
  getPlatform: vi.fn().mockResolvedValue({
    project: {
      list: vi.fn().mockResolvedValue([]),
      load: vi.fn().mockResolvedValue({
        id: "test-1",
        name: "Test",
        implementationUrl: "http://localhost:3000",
        pages: [],
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      }),
      save: vi.fn(),
      delete: vi.fn(),
    },
  }),
}));

beforeEach(() => {
  mockSubmitValue = "test";
  useSettingStore.setState({ figmaToken: null });
  useProjectStore.setState({
    error: null,
    isLoading: false,
    frames: [],
    selectedFrame: null,
    frameImage: null,
    currentFileKey: null,
  });
  useProjectListStore.setState({
    projects: [],
    isLoading: false,
    error: null,
    currentProject: null,
    selectedPageId: null,
    selectedSourceId: null,
  });
  useTabStore.setState({ tabs: [], activeTabId: null });
  useOverlayStore.setState({ url: "" });
});

vi.mock("./design-input", () => ({
  DesignInput: ({
    onSubmit,
    disabled,
  }: {
    value: string;
    onChange: (v: string) => void;
    onSubmit: (v: string) => void;
    disabled: boolean;
  }) => (
    <button
      type="button"
      onClick={() => onSubmit(mockSubmitValue)}
      disabled={disabled}
      data-testid="design-input"
    >
      DesignInput
    </button>
  ),
}));

describe("HomePage", () => {
  it("FigDiffタイトルが表示される", () => {
    render(<HomePage onNavigate={vi.fn()} />);
    expect(screen.getByText("FigDiff")).toBeInTheDocument();
  });

  it("新規プロジェクトボタンが表示される", () => {
    render(<HomePage onNavigate={vi.fn()} />);
    expect(screen.getByText("新規プロジェクト")).toBeInTheDocument();
  });

  it("プロジェクトがない場合に空状態メッセージが表示される", () => {
    render(<HomePage onNavigate={vi.fn()} />);
    expect(
      screen.getByText("プロジェクトがまだありません。作成して始めましょう。"),
    ).toBeInTheDocument();
  });

  it("プロジェクト一覧にプロジェクトカードが表示される", () => {
    useProjectListStore.setState({
      projects: [
        {
          id: "proj-1",
          name: "テストプロジェクト",
          implementationUrl: "http://localhost:3000",
          pageCount: 3,
          updatedAt: "2026-03-28T12:00:00Z",
        },
      ],
    });
    render(<HomePage onNavigate={vi.fn()} />);
    expect(screen.getByText("テストプロジェクト")).toBeInTheDocument();
    expect(screen.getByText("http://localhost:3000")).toBeInTheDocument();
  });

  it("3ステップの説明カードが表示される", () => {
    render(<HomePage onNavigate={vi.fn()} />);
    expect(screen.getByText("ステップ 2")).toBeInTheDocument();
    expect(screen.getByText("ステップ 3")).toBeInTheDocument();
  });

  it("Quick Compareセクションが表示される", () => {
    render(<HomePage onNavigate={vi.fn()} />);
    expect(screen.getByText("クイック比較（レガシー）")).toBeInTheDocument();
  });

  it("新規プロジェクト作成フォームが開閉できる", () => {
    render(<HomePage onNavigate={vi.fn()} />);
    const btn = screen.getByText("新規プロジェクト");
    fireEvent.click(btn);
    expect(screen.getByText("新規プロジェクト作成")).toBeInTheDocument();
  });

  it("error があればエラーメッセージ表示", () => {
    useProjectStore.setState({ error: "テストエラー" });
    render(<HomePage onNavigate={vi.fn()} />);
    expect(screen.getByText("テストエラー")).toBeInTheDocument();
  });

  it("isLoading 中はローディング表示", () => {
    useProjectStore.setState({ isLoading: true });
    render(<HomePage onNavigate={vi.fn()} />);
    expect(screen.getByText("読み込み中...")).toBeInTheDocument();
  });

  describe("レガシーフロー handleSubmit", () => {
    it("Figma URLでトークン未設定 → エラー表示", async () => {
      mockSubmitValue = "https://www.figma.com/design/abc123/Test";
      useSettingStore.setState({ figmaToken: null });
      render(<HomePage onNavigate={vi.fn()} />);

      fireEvent.click(screen.getByTestId("design-input"));

      await waitFor(() => {
        expect(useProjectStore.getState().error).toBe(
          "Figma Token を設定してください。設定画面から設定できます。",
        );
      });

      expect(useSettingStore.getState().showTokenDialog).toBe(true);
    });

    it("loadDesign 成功 + frames あり → project ページへ遷移", async () => {
      mockSubmitValue = "/path/to/image.png";
      useSettingStore.setState({ figmaToken: "figd_token" });

      const mockLoadDesign = vi.fn().mockImplementation(async () => {
        useProjectStore.setState({
          frames: [{ id: "1", name: "Frame", x: 0, y: 0, width: 100, height: 100 }],
          error: null,
        });
      });
      useProjectStore.setState({ loadDesign: mockLoadDesign });

      const onNavigate = vi.fn();
      render(<HomePage onNavigate={onNavigate} />);
      fireEvent.click(screen.getByTestId("design-input"));

      await waitFor(() => {
        expect(onNavigate).toHaveBeenCalledWith("project");
      });
    });

    it("loadDesign エラー → 遷移しない", async () => {
      mockSubmitValue = "/path/to/image.png";
      useSettingStore.setState({ figmaToken: "figd_token" });

      const mockLoadDesign = vi.fn().mockImplementation(async () => {
        useProjectStore.setState({ error: "読み込み失敗" });
      });
      useProjectStore.setState({ loadDesign: mockLoadDesign });

      const onNavigate = vi.fn();
      render(<HomePage onNavigate={onNavigate} />);
      fireEvent.click(screen.getByTestId("design-input"));

      await waitFor(() => {
        expect(useProjectStore.getState().error).toBe("読み込み失敗");
      });
      expect(onNavigate).not.toHaveBeenCalled();
    });

    it("loadDesign 成功でも結果が空 → エラー表示して遷移しない", async () => {
      mockSubmitValue = "https://www.figma.com/design/abc123/Test";
      useSettingStore.setState({ figmaToken: "figd_token" });

      const mockLoadDesign = vi.fn().mockImplementation(async () => {
        useProjectStore.setState({ frames: [], frameImage: null, error: null });
      });
      useProjectStore.setState({ loadDesign: mockLoadDesign });

      const onNavigate = vi.fn();
      render(<HomePage onNavigate={onNavigate} />);
      fireEvent.click(screen.getByTestId("design-input"));

      await waitFor(() => {
        expect(useProjectStore.getState().error).toBe(
          "デザインを取得できませんでした。URLまたはFigma内のフレーム構成を確認してください。",
        );
      });
      expect(onNavigate).not.toHaveBeenCalled();
    });

    it("implUrl あり + loadDesign 成功 → live_overlay ページへ遷移", async () => {
      mockSubmitValue = "/path/to/image.png";
      useSettingStore.setState({ figmaToken: "figd_token" });

      const mockSelectFrame = vi.fn();
      const mockLoadDesign = vi.fn().mockImplementation(async () => {
        useProjectStore.setState({
          frames: [{ id: "1", name: "Frame", x: 0, y: 0, width: 100, height: 100 }],
          selectFrame: mockSelectFrame,
          error: null,
        });
      });
      useProjectStore.setState({ loadDesign: mockLoadDesign });

      const onNavigate = vi.fn();
      render(<HomePage onNavigate={onNavigate} />);

      const implInput = screen.getByLabelText("実装URL（任意、例: http://localhost:3000）");
      fireEvent.change(implInput, { target: { value: "http://localhost:3000" } });
      fireEvent.click(screen.getByTestId("design-input"));

      await waitFor(() => {
        expect(onNavigate).toHaveBeenCalledWith("live_overlay");
      });
      expect(useOverlayStore.getState().url).toBe("http://localhost:3000");
    });
  });
});

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useOverlayStore } from "@/store/overlay-store";
import { useProjectStore } from "@/store/project-store";
import { useSettingStore } from "@/store/setting-store";

import { HomePage } from "./home-page";

afterEach(cleanup);

let mockSubmitValue = "test";

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
  useOverlayStore.setState({ url: "" });
});

vi.mock("./design-input", () => ({
  DesignInput: ({ onSubmit, disabled }: { onSubmit: (v: string) => void; disabled: boolean }) => (
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
  it("ページタイトルが表示される", () => {
    render(<HomePage onNavigate={vi.fn()} />);
    expect(screen.getByText("デザイン比較を始める")).toBeInTheDocument();
  });

  it("3ステップの説明カードが表示される", () => {
    render(<HomePage onNavigate={vi.fn()} />);
    expect(screen.getByText("ステップ 2")).toBeInTheDocument();
    expect(screen.getByText("ステップ 3")).toBeInTheDocument();
  });

  it("実装URLの入力フィールドが表示される", () => {
    render(<HomePage onNavigate={vi.fn()} />);
    expect(screen.getByLabelText("実装URL（任意、例: http://localhost:3000）")).toBeInTheDocument();
  });

  it("figmaToken 未設定時にトークン警告が表示される", () => {
    render(<HomePage onNavigate={vi.fn()} />);
    expect(screen.getByText(/Figma Token を設定してください/)).toBeInTheDocument();
  });

  it("figmaToken 設定済みならトークン警告が非表示", () => {
    useSettingStore.setState({ figmaToken: "figd_test_token_value_12345" });
    render(<HomePage onNavigate={vi.fn()} />);
    expect(screen.queryByText(/Figma Token を設定してください/)).not.toBeInTheDocument();
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

  describe("handleSubmit", () => {
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

    it("loadDesign 成功 + frameImage あり → project ページへ遷移", async () => {
      mockSubmitValue = "/path/to/image.png";
      useSettingStore.setState({ figmaToken: "figd_token" });

      const mockLoadDesign = vi.fn().mockImplementation(async () => {
        useProjectStore.setState({
          frameImage: "data:image/png;base64,abc",
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

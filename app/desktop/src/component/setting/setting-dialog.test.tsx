import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSettingStore } from "@/store/setting-store";

import { SettingDialog } from "./setting-dialog";

afterEach(cleanup);

describe("SettingDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingStore.setState({
      figmaToken: null,
      oauthState: { mode: "none" },
      theme: "dark",
      defaultThreshold: 0.1,
      loadOAuthStatus: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("open=true の場合ダイアログ表示", () => {
    render(<SettingDialog open={true} onOpenChange={vi.fn()} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("設定")).toBeInTheDocument();
  });

  it("open=false の場合ダイアログ非表示", () => {
    render(<SettingDialog open={false} onOpenChange={vi.fn()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("figmaToken なしの場合パスワード入力フィールド + 保存ボタン表示", () => {
    render(<SettingDialog open={true} onOpenChange={vi.fn()} />);
    const input = screen.getByPlaceholderText("figd_...");
    expect(input).toBeInTheDocument();
    // PAT section save button — scoped to the container holding the PAT input
    const patSection = input.closest(".flex.items-center.gap-2")!;
    expect(within(patSection).getByText("保存")).toBeInTheDocument();
  });

  it("figmaToken ありの場合マスク表示 + 削除ボタン表示", () => {
    useSettingStore.setState({ figmaToken: "figd_xxx" });
    render(<SettingDialog open={true} onOpenChange={vi.fn()} />);
    expect(screen.getByText("削除")).toBeInTheDocument();
  });

  it("空トークンで保存ボタン disabled", () => {
    render(<SettingDialog open={true} onOpenChange={vi.fn()} />);
    const input = screen.getByPlaceholderText("figd_...");
    const patSection = input.closest(".flex.items-center.gap-2")!;
    const saveButton = within(patSection).getByText("保存");
    expect(saveButton).toBeDisabled();
  });

  it("テーマボタン light/dark が表示される", () => {
    render(<SettingDialog open={true} onOpenChange={vi.fn()} />);
    expect(screen.getByText("ライト")).toBeInTheDocument();
    expect(screen.getByText("ダーク")).toBeInTheDocument();
  });

  it("dark ボタンクリックで setTheme が dark で呼ばれる", () => {
    useSettingStore.setState({ theme: "light" });
    render(<SettingDialog open={true} onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByText("ダーク"));
    expect(useSettingStore.getState().theme).toBe("dark");
  });

  describe("handleSaveToken", () => {
    it("トークン入力 → 保存ボタンクリック → setFigmaToken 呼ばれる", async () => {
      const mockSetFigmaToken = vi.fn().mockResolvedValue(undefined);
      useSettingStore.setState({ setFigmaToken: mockSetFigmaToken });

      render(<SettingDialog open={true} onOpenChange={vi.fn()} />);

      const input = screen.getByPlaceholderText("figd_...");
      await userEvent.type(input, "figd_test_token_123");

      const patSection = input.closest(".flex.items-center.gap-2")!;
      const saveButton = within(patSection).getByText("保存");
      expect(saveButton).toBeEnabled();
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockSetFigmaToken).toHaveBeenCalledWith("figd_test_token_123");
      });
    });

    it("保存成功 → 保存済みメッセージ表示", async () => {
      const mockSetFigmaToken = vi.fn().mockResolvedValue(undefined);
      useSettingStore.setState({ setFigmaToken: mockSetFigmaToken });

      render(<SettingDialog open={true} onOpenChange={vi.fn()} />);

      const input = screen.getByPlaceholderText("figd_...");
      await userEvent.type(input, "figd_abc");
      const patSection = input.closest(".flex.items-center.gap-2")!;
      fireEvent.click(within(patSection).getByText("保存"));

      await waitFor(() => {
        expect(screen.getByText("OS Keychainに保存しました")).toBeInTheDocument();
      });
    });

    it("保存失敗 → エラーメッセージ表示", async () => {
      const mockSetFigmaToken = vi.fn().mockRejectedValue(new Error("保存エラー"));
      useSettingStore.setState({ setFigmaToken: mockSetFigmaToken });

      render(<SettingDialog open={true} onOpenChange={vi.fn()} />);

      const input = screen.getByPlaceholderText("figd_...");
      await userEvent.type(input, "figd_abc");
      const patSection = input.closest(".flex.items-center.gap-2")!;
      fireEvent.click(within(patSection).getByText("保存"));

      await waitFor(() => {
        expect(screen.getByText(/保存に失敗しました/)).toBeInTheDocument();
        expect(screen.getByText(/保存エラー/)).toBeInTheDocument();
      });
    });

    it("Enter キーで保存", async () => {
      const mockSetFigmaToken = vi.fn().mockResolvedValue(undefined);
      useSettingStore.setState({ setFigmaToken: mockSetFigmaToken });

      render(<SettingDialog open={true} onOpenChange={vi.fn()} />);

      const input = screen.getByPlaceholderText("figd_...");
      fireEvent.change(input, { target: { value: "figdabctest123" } });
      fireEvent.keyDown(input, { key: "Enter" });

      await waitFor(() => {
        expect(mockSetFigmaToken).toHaveBeenCalledWith("figdabctest123");
      });
    });
  });

  describe("handleDeleteToken", () => {
    it("削除ボタンクリック → removeFigmaToken 呼ばれる", async () => {
      const mockRemoveFigmaToken = vi.fn().mockResolvedValue(undefined);
      useSettingStore.setState({
        figmaToken: "figd_existing",
        removeFigmaToken: mockRemoveFigmaToken,
      });

      render(<SettingDialog open={true} onOpenChange={vi.fn()} />);

      fireEvent.click(screen.getByText("削除"));

      await waitFor(() => {
        expect(mockRemoveFigmaToken).toHaveBeenCalled();
      });
    });

    it("削除失敗 → エラーメッセージ表示", async () => {
      const mockRemoveFigmaToken = vi.fn().mockRejectedValue(new Error("削除失敗"));
      useSettingStore.setState({
        figmaToken: "figd_existing",
        removeFigmaToken: mockRemoveFigmaToken,
      });

      render(<SettingDialog open={true} onOpenChange={vi.fn()} />);
      fireEvent.click(screen.getByText("削除"));

      await waitFor(() => {
        expect(screen.getByText(/保存に失敗しました/)).toBeInTheDocument();
      });
    });
  });

  describe("light テーマ切替", () => {
    it("light ボタンクリックで setTheme('light') が呼ばれる", () => {
      useSettingStore.setState({ theme: "dark" });
      render(<SettingDialog open={true} onOpenChange={vi.fn()} />);
      fireEvent.click(screen.getByText("ライト"));
      expect(useSettingStore.getState().theme).toBe("light");
    });
  });
});

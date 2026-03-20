import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useProjectStore } from "@/store/project-store";
import { useSettingStore } from "@/store/setting-store";

import { HomePage } from "./home-page";

afterEach(cleanup);

beforeEach(() => {
  useSettingStore.setState({ figmaToken: null });
  useProjectStore.setState({ error: null, isLoading: false });
});

vi.mock("./design-input", () => ({
  DesignInput: ({ onSubmit, disabled }: { onSubmit: (v: string) => void; disabled: boolean }) => (
    <button
      type="button"
      onClick={() => onSubmit("test")}
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
    const stepTexts = screen.getAllByText(/ステップ/);
    expect(stepTexts.length).toBeGreaterThanOrEqual(3);
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
});

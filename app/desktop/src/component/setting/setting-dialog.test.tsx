import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSettingStore } from "@/store/setting-store";

import { SettingDialog } from "./setting-dialog";

afterEach(cleanup);

describe("SettingDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    useSettingStore.setState({ figmaToken: null });
    render(<SettingDialog open={true} onOpenChange={vi.fn()} />);
    expect(screen.getByPlaceholderText("figd_...")).toBeInTheDocument();
    expect(screen.getByText("保存")).toBeInTheDocument();
  });

  it("figmaToken ありの場合マスク表示 + 削除ボタン表示", () => {
    useSettingStore.setState({ figmaToken: "figd_xxx" });
    render(<SettingDialog open={true} onOpenChange={vi.fn()} />);
    expect(screen.getByText("削除")).toBeInTheDocument();
  });

  it("空トークンで保存ボタン disabled", () => {
    useSettingStore.setState({ figmaToken: null });
    render(<SettingDialog open={true} onOpenChange={vi.fn()} />);
    const saveButton = screen.getByText("保存");
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
});

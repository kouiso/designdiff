import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSettingStore } from "@/store/setting-store";

import { TokenRequiredDialog } from "./token-required-dialog";

afterEach(cleanup);

describe("TokenRequiredDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("showTokenDialog=true の場合ダイアログ表示", () => {
    useSettingStore.setState({ showTokenDialog: true });
    render(<TokenRequiredDialog />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Figma Tokenが必要です")).toBeInTheDocument();
  });

  it("showTokenDialog=false の場合非表示", () => {
    useSettingStore.setState({ showTokenDialog: false });
    render(<TokenRequiredDialog />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("空入力で Enter すると required エラー表示", () => {
    useSettingStore.setState({ showTokenDialog: true });
    render(<TokenRequiredDialog />);
    const input = screen.getByPlaceholderText("figd_...");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("Tokenを入力してください")).toBeInTheDocument();
  });

  it("不正フォーマットトークンで invalid エラー表示", () => {
    useSettingStore.setState({ showTokenDialog: true });
    render(<TokenRequiredDialog />);
    const input = screen.getByPlaceholderText("figd_...");
    fireEvent.change(input, { target: { value: "short" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText(/有効なFigma Personal Access Token/)).toBeInTheDocument();
  });

  it("キャンセルボタンで closeTokenDialog 呼び出し", () => {
    useSettingStore.setState({ showTokenDialog: true });
    render(<TokenRequiredDialog />);
    fireEvent.click(screen.getByText("キャンセル"));
    expect(useSettingStore.getState().showTokenDialog).toBe(false);
  });

  it("Submit ボタンはトークン空の場合 disabled", () => {
    useSettingStore.setState({ showTokenDialog: true });
    render(<TokenRequiredDialog />);
    const saveButton = screen.getByText("保存");
    expect(saveButton).toBeDisabled();
  });
});

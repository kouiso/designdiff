import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCompareStore } from "@/store/compare-store";
import { useOverlayStore } from "@/store/overlay-store";

import { OverlayViewModeToggle } from "./overlay-view-mode-toggle";

afterEach(cleanup);

beforeEach(() => {
  useOverlayStore.setState({
    overlayViewMode: "transparent_overlay",
    overlayImageBase64: "mockBase64",
  });
});

describe("OverlayViewModeToggle", () => {
  it("overlayImageBase64=null → null レンダリング", () => {
    useOverlayStore.setState({ overlayImageBase64: null });
    const { container } = render(<OverlayViewModeToggle />);
    expect(container.innerHTML).toBe("");
  });

  it("8つのモードボタンが表示される", () => {
    render(<OverlayViewModeToggle />);
    expect(screen.getByLabelText("デザインのみ")).toBeInTheDocument();
    expect(screen.getByLabelText("実装のみ")).toBeInTheDocument();
    expect(screen.getByLabelText("透過オーバーレイ")).toBeInTheDocument();
    expect(screen.getByLabelText("分割画面")).toBeInTheDocument();
    expect(screen.getByLabelText("ブレンド差分")).toBeInTheDocument();
    expect(screen.getByLabelText("ドラッグオーバーレイ")).toBeInTheDocument();
    expect(screen.getByLabelText("ピクセル差分")).toBeInTheDocument();
    expect(screen.getByLabelText("トグル")).toBeInTheDocument();
  });

  it("2up比較ボタンが表示される", () => {
    render(<OverlayViewModeToggle />);
    expect(screen.getByText("2up比較")).toBeInTheDocument();
  });

  it("active モードの variant が default", () => {
    useOverlayStore.setState({ overlayViewMode: "pixel_diff" });
    render(<OverlayViewModeToggle />);
    const activeButton = screen.getByLabelText("ピクセル差分");
    expect(activeButton.className).toContain("shadow-sm");
  });

  it("モードボタンクリックで setOverlayViewMode が呼ばれる", async () => {
    const user = userEvent.setup();
    const mockSetMode = vi.fn();
    useOverlayStore.setState({ setOverlayViewMode: mockSetMode });

    render(<OverlayViewModeToggle />);
    await user.click(screen.getByLabelText("ブレンド差分"));

    expect(mockSetMode).toHaveBeenCalledWith("blended_diff");
  });

  it("2up ボタンクリックでキャプチャ → compare 遷移", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const mockCapture = vi.fn().mockResolvedValue("capturedBase64");
    useOverlayStore.setState({ captureForComparison: mockCapture });

    render(<OverlayViewModeToggle onNavigate={onNavigate} />);
    await user.click(screen.getByText("2up比較"));

    expect(mockCapture).toHaveBeenCalled();
    expect(useCompareStore.getState().screenshotImage).toBe("data:image/png;base64,capturedBase64");
    expect(onNavigate).toHaveBeenCalledWith("compare");
  });

  it("2up キャプチャ失敗時に error がセットされる", async () => {
    const user = userEvent.setup();
    const mockCapture = vi.fn().mockRejectedValue(new Error("capture failed"));
    useOverlayStore.setState({ captureForComparison: mockCapture, error: null });

    render(<OverlayViewModeToggle />);
    await user.click(screen.getByText("2up比較"));

    expect(useOverlayStore.getState().error).toContain("capture failed");
  });
});

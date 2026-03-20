import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
});

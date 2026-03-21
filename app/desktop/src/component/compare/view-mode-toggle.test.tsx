import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useCompareStore } from "@/store/compare-store";

import { ViewModeToggle } from "./view-mode-toggle";

afterEach(cleanup);

describe("ViewModeToggle", () => {
  it("7つのボタンがレンダリングされる", () => {
    render(<ViewModeToggle />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(7);
  });

  it("viewModeLabel テキストが表示される", () => {
    render(<ViewModeToggle />);
    expect(screen.getByText(/表示モード/)).toBeInTheDocument();
  });

  it("各ボタンに aria-label が設定されている", () => {
    render(<ViewModeToggle />);
    const buttons = screen.getAllByRole("button");
    for (const button of buttons) {
      expect(button).toHaveAttribute("aria-label");
    }
  });

  it("ボタンクリックで setViewMode が呼ばれる", () => {
    render(<ViewModeToggle />);
    const pixelDiffButton = screen.getByLabelText("ピクセル差分");
    fireEvent.click(pixelDiffButton);
    expect(useCompareStore.getState().viewMode).toBe("pixel_diff");
  });

  it("viewMode 変更後に active ボタンが切り替わる", () => {
    useCompareStore.setState({ viewMode: "split_screen" });
    render(<ViewModeToggle />);
    const splitButton = screen.getByLabelText("分割画面");
    expect(splitButton.className).toContain("shadow");
  });
});

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCompareStore } from "@/store/compare-store";

import { CompareCanvas } from "./compare-canvas";

vi.mock("@/hook/use-canvas-zoom-pan", () => ({
  useCanvasZoomPan: () => ({
    scale: 1,
    containerRef: { current: null },
    transformStyle: { transform: "translate(0px, 0px) scale(1)", transformOrigin: "0 0" },
    resetZoom: vi.fn(),
  }),
}));

afterEach(cleanup);

beforeEach(() => {
  useCompareStore.setState({
    designImage: null,
    screenshotImage: null,
    compareResult: null,
    viewMode: "transparent_overlay",
    overlayOpacity: 0.5,
    error: null,
  });
});

describe("CompareCanvas", () => {
  it("canvas 要素がレンダリングされる", () => {
    render(<CompareCanvas />);
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("リセットボタンが表示される", () => {
    render(<CompareCanvas />);
    expect(screen.getByRole("button", { name: /リセット/ })).toBeInTheDocument();
  });

  it("スケール表示が 100% で表示される", () => {
    render(<CompareCanvas />);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("ヒントテキストが表示される", () => {
    render(<CompareCanvas />);
    expect(screen.getByText(/Ctrl\+ホイール/)).toBeInTheDocument();
  });

  it("draggable_overlay モード → cursor-move クラス", () => {
    useCompareStore.setState({
      designImage: "d",
      screenshotImage: "s",
      viewMode: "draggable_overlay",
    });
    render(<CompareCanvas />);
    const canvas = screen.getByRole("img");
    expect(canvas.className).toContain("cursor-move");
  });

  it("split_screen モード → cursor-ew-resize クラス", () => {
    useCompareStore.setState({
      designImage: "d",
      screenshotImage: "s",
      viewMode: "split_screen",
    });
    render(<CompareCanvas />);
    const canvas = screen.getByRole("img");
    expect(canvas.className).toContain("cursor-ew-resize");
  });

  it("デフォルトモード → cursor-default クラス", () => {
    useCompareStore.setState({
      designImage: "d",
      screenshotImage: "s",
      viewMode: "transparent_overlay",
    });
    render(<CompareCanvas />);
    const canvas = screen.getByRole("img");
    expect(canvas.className).toContain("cursor-default");
  });

  it("container に data-testid がある", () => {
    render(<CompareCanvas />);
    expect(screen.getByTestId("compare-canvas-container")).toBeInTheDocument();
  });
});

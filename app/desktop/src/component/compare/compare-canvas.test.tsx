import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCompareStore } from "@/store/compare-store";

import { CompareCanvas } from "./compare-canvas";

const resetZoomMock = vi.hoisted(() => vi.fn());
const scaleMock = vi.hoisted(() => ({ value: 1 }));

vi.mock("@/hook/use-canvas-zoom-pan", () => ({
  useCanvasZoomPan: () => ({
    scale: scaleMock.value,
    containerRef: { current: null },
    transformStyle: { transform: "translate(0px, 0px) scale(1)", transformOrigin: "0 0" },
    resetZoom: resetZoomMock,
  }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  scaleMock.value = 1;
});

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

  it("リセットボタンはzoom状態をリセットする", () => {
    render(<CompareCanvas />);

    fireEvent.click(screen.getByRole("button", { name: /リセット/ }));

    expect(resetZoomMock).toHaveBeenCalledOnce();
  });

  it("draggable overlayの移動イベントを処理する", async () => {
    class TestImage {
      width = 100;
      height = 60;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        this.onload?.();
      }
    }
    vi.stubGlobal("Image", TestImage);
    scaleMock.value = 2;
    useCompareStore.setState({ designImage: "d", screenshotImage: null });
    useCompareStore.setState({ viewMode: "draggable_overlay" });
    const { rerender } = render(<CompareCanvas />);
    const canvas = screen.getByRole("img");
    const context = canvas.getContext("2d");
    expect(context).not.toBeNull();

    await waitFor(() => expect(context?.drawImage).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    context?.drawImage.mockClear();

    fireEvent.mouseDown(canvas);
    rerender(<CompareCanvas />);
    const moveEvent = new MouseEvent("mousemove", { bubbles: true });
    Object.defineProperties(moveEvent, {
      movementX: { value: 12 },
      movementY: { value: -6 },
    });
    fireEvent(canvas, moveEvent);
    await waitFor(() => {
      expect(context?.drawImage.mock.calls).toEqual([[expect.any(TestImage), 6, -3]]);
    });

    fireEvent.mouseUp(canvas);
    const drawCallsAfterMouseUp = context?.drawImage.mock.calls.length;
    fireEvent.mouseMove(canvas, { movementX: 100, movementY: 100 });
    await new Promise((resolve) => queueMicrotask(resolve));
    expect(context?.drawImage.mock.calls.length).toBe(drawCallsAfterMouseUp);
  });

  it("split screenの移動イベントを処理する", async () => {
    class TestImage {
      width = 100;
      height = 60;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        this.onload?.();
      }
    }
    vi.stubGlobal("Image", TestImage);
    useCompareStore.setState({
      designImage: "d",
      screenshotImage: null,
      viewMode: "split_screen",
    });
    const { rerender } = render(<CompareCanvas />);
    const canvas = screen.getByRole("img");
    const context = canvas.getContext("2d");
    expect(context).not.toBeNull();
    context?.drawImage.mockImplementation(() => undefined);
    Object.defineProperty(canvas, "getBoundingClientRect", {
      value: () => ({ left: 10, width: 100 }),
    });

    await waitFor(() => expect(context?.drawImage).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    context?.rect.mockClear();
    context?.moveTo.mockClear();
    context?.lineTo.mockClear();
    context?.stroke.mockClear();
    context?.__clearEvents();

    fireEvent.mouseDown(canvas);
    rerender(<CompareCanvas />);
    const leftMoveEvent = new MouseEvent("mousemove", { bubbles: true });
    Object.defineProperties(leftMoveEvent, {
      clientX: { value: -90 },
      clientY: { value: 10 },
    });
    fireEvent(canvas, leftMoveEvent);
    await waitFor(() => {
      const events = context?.__getEvents() ?? [];
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "rect", props: { x: 0, y: 0, width: 0, height: 60 } }),
          expect.objectContaining({ type: "moveTo", props: { x: 0, y: 0 } }),
          expect.objectContaining({ type: "lineTo", props: { x: 0, y: 60 } }),
          expect.objectContaining({ type: "stroke" }),
        ]),
      );
    });

    context?.rect.mockClear();
    context?.moveTo.mockClear();
    context?.lineTo.mockClear();
    context?.stroke.mockClear();
    context?.__clearEvents();
    const rightMoveEvent = new MouseEvent("mousemove", { bubbles: true });
    Object.defineProperties(rightMoveEvent, {
      clientX: { value: 210 },
      clientY: { value: 10 },
    });
    fireEvent(canvas, rightMoveEvent);
    await waitFor(() => {
      const events = context?.__getEvents() ?? [];
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "rect", props: { x: 0, y: 0, width: 100, height: 60 } }),
          expect.objectContaining({ type: "moveTo", props: { x: 100, y: 0 } }),
          expect.objectContaining({ type: "lineTo", props: { x: 100, y: 60 } }),
          expect.objectContaining({ type: "stroke" }),
        ]),
      );
    });
    fireEvent.mouseUp(canvas);
  });

  it.each([
    { viewMode: "design_only", sources: ["design"], alphas: [1], operations: ["source-over"] },
    {
      viewMode: "implementation",
      sources: ["screenshot"],
      alphas: [1],
      operations: ["source-over"],
    },
    {
      viewMode: "transparent_overlay",
      sources: ["screenshot", "design"],
      alphas: [1, 0.5],
      operations: ["source-over", "source-over"],
    },
    {
      viewMode: "split_screen",
      sources: ["design", "screenshot"],
      alphas: [1, 1],
      operations: ["source-over", "source-over"],
    },
    {
      viewMode: "blended_diff",
      sources: ["design", "screenshot"],
      alphas: [0.5, 0.5],
      operations: ["source-over", "difference"],
    },
    {
      viewMode: "draggable_overlay",
      sources: ["screenshot", "design"],
      alphas: [1, 0.5],
      operations: ["source-over", "source-over"],
    },
    {
      viewMode: "pixel_diff",
      sources: ["data:image/png;base64,diff"],
      alphas: [1],
      operations: ["source-over"],
    },
  ] as const)("$viewMode は指定された画像と合成方法で描画する", async ({
    viewMode,
    sources,
    alphas,
    operations,
  }) => {
    class TestImage {
      width = 100;
      height = 60;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      private source = "";
      get src() {
        return this.source;
      }
      set src(value: string) {
        this.source = value;
        this.onload?.();
      }
    }
    vi.stubGlobal("Image", TestImage);
    useCompareStore.setState({
      designImage: "design",
      screenshotImage: "screenshot",
      viewMode,
      compareResult: {
        comparisonId: "cmp-canvas-mode",
        matchRate: 50,
        diffPixelCount: 3000,
        totalPixelCount: 6000,
        diffRegions: [],
        suggestion: "fixture",
        diffImageBase64: "diff",
      },
    });
    render(<CompareCanvas />);
    const canvas = screen.getByRole("img");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Canvas element missing");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas context missing");
    const draws: { source: string; x: number; y: number; alpha: number; operation: string }[] = [];
    const drawSpy = vi.spyOn(context, "drawImage").mockImplementation((image, x, y) => {
      if (!(image instanceof TestImage)) throw new Error("Unexpected image source");
      draws.push({
        source: image.src,
        x,
        y,
        alpha: context.globalAlpha,
        operation: context.globalCompositeOperation,
      });
    });
    const rectSpy = vi.spyOn(context, "rect");

    try {
      await waitFor(() => expect(draws.map((draw) => draw.source)).toEqual(sources));
      expect(draws.map((draw) => draw.alpha)).toEqual(alphas);
      expect(draws.map((draw) => draw.operation)).toEqual(operations);
      expect(draws.every((draw) => draw.x === 0 && draw.y === 0)).toBe(true);
      expect(canvas.width).toBe(100);
      expect(canvas.height).toBe(60);
      if (viewMode === "split_screen") {
        expect(rectSpy).toHaveBeenNthCalledWith(1, 0, 0, 50, 60);
        expect(rectSpy).toHaveBeenNthCalledWith(2, 50, 0, 50, 60);
      }
    } finally {
      drawSpy.mockRestore();
      rectSpy.mockRestore();
    }
  });
});

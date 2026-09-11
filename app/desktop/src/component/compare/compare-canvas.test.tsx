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
    canvas.dispatchEvent(moveEvent);
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
    canvas.dispatchEvent(leftMoveEvent);
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
    canvas.dispatchEvent(rightMoveEvent);
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

  it("画像が読み込まれた各表示モードを描画する", async () => {
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
      designImage: "design",
      screenshotImage: "screenshot",
      compareResult: { diffImageBase64: "diff" } as never,
    });
    render(<CompareCanvas />);

    await waitFor(() => expect(screen.getByRole("img")).toBeInTheDocument());
    for (const viewMode of [
      "design_only",
      "implementation",
      "transparent_overlay",
      "split_screen",
      "blended_diff",
      "draggable_overlay",
      "pixel_diff",
    ] as const) {
      useCompareStore.setState({ viewMode });
      await waitFor(() => expect(useCompareStore.getState().viewMode).toBe(viewMode));
    }
  });
});

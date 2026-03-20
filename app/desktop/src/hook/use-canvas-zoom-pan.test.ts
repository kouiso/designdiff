import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useCanvasZoomPan } from "./use-canvas-zoom-pan";

describe("useCanvasZoomPan", () => {
  it("初期値 scale=1, offset=(0,0)", () => {
    const { result } = renderHook(() => useCanvasZoomPan());
    expect(result.current.scale).toBe(1);
    expect(result.current.offset).toEqual({ x: 0, y: 0 });
  });

  it("initialScale を指定可能", () => {
    const { result } = renderHook(() => useCanvasZoomPan({ initialScale: 2 }));
    expect(result.current.scale).toBe(2);
  });

  it("transformStyle に transform プロパティを含む", () => {
    const { result } = renderHook(() => useCanvasZoomPan());
    expect(result.current.transformStyle).toHaveProperty("transform");
    expect(result.current.transformStyle.transform).toContain("scale(1)");
    expect(result.current.transformStyle).toHaveProperty("transformOrigin", "0 0");
  });

  it("containerRef が null 初期値", () => {
    const { result } = renderHook(() => useCanvasZoomPan());
    expect(result.current.containerRef.current).toBeNull();
  });

  it("resetZoom で scale=1, offset=(0,0) に戻る", () => {
    const { result } = renderHook(() => useCanvasZoomPan({ initialScale: 2 }));
    act(() => {
      result.current.resetZoom();
    });
    expect(result.current.scale).toBe(1);
    expect(result.current.offset).toEqual({ x: 0, y: 0 });
  });

  it("transformStyle が useMemo で安定参照", () => {
    const { result, rerender } = renderHook(() => useCanvasZoomPan());
    const style1 = result.current.transformStyle;
    rerender();
    const style2 = result.current.transformStyle;
    expect(style1).toBe(style2);
  });
});

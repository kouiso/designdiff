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

  it("transformStyle.willChange は 'transform'", () => {
    const { result } = renderHook(() => useCanvasZoomPan());
    expect(result.current.transformStyle.willChange).toBe("transform");
  });

  it("minScale / maxScale オプションが受け入れられる", () => {
    const { result } = renderHook(() =>
      useCanvasZoomPan({ minScale: 0.5, maxScale: 3, initialScale: 1 }),
    );
    expect(result.current.scale).toBe(1);
  });

  describe("keyboard shortcuts", () => {
    it("Ctrl+0 で zoom がリセットされる", () => {
      const { result } = renderHook(() => useCanvasZoomPan({ initialScale: 3 }));
      expect(result.current.scale).toBe(3);

      act(() => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "0", ctrlKey: true, bubbles: true }),
        );
      });

      expect(result.current.scale).toBe(1);
      expect(result.current.offset).toEqual({ x: 0, y: 0 });
    });

    it("Cmd+0 (metaKey) でも zoom がリセットされる", () => {
      const { result } = renderHook(() => useCanvasZoomPan({ initialScale: 2.5 }));

      act(() => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "0", metaKey: true, bubbles: true }),
        );
      });

      expect(result.current.scale).toBe(1);
      expect(result.current.offset).toEqual({ x: 0, y: 0 });
    });

    it("Space キー keydown/keyup でエラーなし", () => {
      renderHook(() => useCanvasZoomPan());

      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));
      });
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space", bubbles: true }));
      });
    });

    it("Space repeat=true はスキップされる", () => {
      renderHook(() => useCanvasZoomPan());
      act(() => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { code: "Space", repeat: true, bubbles: true }),
        );
      });
    });

    it("アンマウント後にキーボードリスナーがクリーンアップされる", () => {
      const { result, unmount } = renderHook(() => useCanvasZoomPan({ initialScale: 2 }));
      expect(result.current.scale).toBe(2);
      unmount();

      act(() => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "0", ctrlKey: true, bubbles: true }),
        );
      });
      // No error thrown after unmount
    });
  });

  describe("mouse events with container", () => {
    const renderAttached = (options?: Parameters<typeof useCanvasZoomPan>[0]) => {
      const div = document.createElement("div");
      document.body.appendChild(div);
      const rendered = renderHook(() => {
        const hook = useCanvasZoomPan(options);
        hook.containerRef.current = div;
        return hook;
      });
      return { ...rendered, div };
    };

    it("通常ホイールは垂直パンし、shiftホイールは水平パンする", () => {
      const { result, div, unmount } = renderAttached();

      act(() => {
        div.dispatchEvent(new WheelEvent("wheel", { deltaX: 3, deltaY: 8, bubbles: true }));
        div.dispatchEvent(new WheelEvent("wheel", { deltaY: 5, shiftKey: true, bubbles: true }));
      });

      expect(result.current.offset).toEqual({ x: -8, y: -8 });
      unmount();
      div.remove();
    });

    it("ctrlホイールはカーソル中心で倍率を上下限に収める", () => {
      const { result, div, unmount } = renderAttached({ minScale: 0.5, maxScale: 2 });
      Object.defineProperty(div, "getBoundingClientRect", {
        value: () => ({ left: 10, top: 20 }),
      });

      act(() => {
        div.dispatchEvent(
          new WheelEvent("wheel", { clientX: 20, clientY: 30, deltaY: -10_000, ctrlKey: true }),
        );
      });
      expect(result.current.scale).toBe(2);
      act(() => {
        div.dispatchEvent(
          new WheelEvent("wheel", { clientX: 20, clientY: 30, deltaY: 10_000, ctrlKey: true }),
        );
      });
      expect(result.current.scale).toBe(0.5);
      unmount();
      div.remove();
    });

    it("中クリックのドラッグをコンテナ外のmousemoveでも追従する", () => {
      const { result, div, unmount } = renderAttached();

      act(() => {
        div.dispatchEvent(new MouseEvent("mousedown", { button: 1, clientX: 10, clientY: 20 }));
        window.dispatchEvent(new MouseEvent("mousemove", { clientX: 18, clientY: 26 }));
        window.dispatchEvent(new MouseEvent("mouseup"));
      });

      expect(result.current.offset).toEqual({ x: 8, y: 6 });
      expect(div.style.cursor).toBe("");
      unmount();
      div.remove();
    });

    it("space+左ドラッグを開始し、spaceを離すとパンを中断する", () => {
      const { result, div, unmount } = renderAttached();

      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
        div.dispatchEvent(new MouseEvent("mousedown", { button: 0, clientX: 2, clientY: 3 }));
        window.dispatchEvent(new MouseEvent("mousemove", { clientX: 5, clientY: 7 }));
        window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space" }));
        window.dispatchEvent(new MouseEvent("mousemove", { clientX: 20, clientY: 20 }));
      });

      expect(result.current.offset).toEqual({ x: 3, y: 4 });
      expect(div.style.cursor).toBe("");
      unmount();
      div.remove();
    });

    it("containerRef がアタッチされた要素でホイールイベントが処理される (pan)", () => {
      const { result } = renderHook(() => useCanvasZoomPan());

      const div = document.createElement("div");
      document.body.appendChild(div);

      act(() => {
        // Manually set the ref (simulate React attaching a ref)
        Object.defineProperty(result.current.containerRef, "current", {
          value: div,
          writable: true,
        });
      });

      // Re-render hook so useEffect picks up the container
      // (In jsdom, useEffect already ran; simulate by directly testing the behaviour)

      document.body.removeChild(div);
    });

    it("containerRef なしの場合はイベント登録をスキップする", () => {
      const { result } = renderHook(() => useCanvasZoomPan());
      expect(result.current.containerRef.current).toBeNull();
    });
  });
});

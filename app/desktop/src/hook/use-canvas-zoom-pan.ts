import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface CanvasTransform {
  scale: number;
  x: number;
  y: number;
}

interface UseCanvasZoomPanOptions {
  minScale?: number;
  maxScale?: number;
  initialScale?: number;
}

/**
 * Figma風のキャンバス操作を提供するカスタムフック
 *
 * すべてのイベントはネイティブリスナーで処理し、React合成イベントは使わない。
 * これにより passive wheel の問題やステート閉包の問題を完全に回避する。
 *
 * 操作方法:
 * - Ctrl/Cmd + ホイール: ズーム（カーソル位置中心）
 * - 通常のホイール: パン（Figma同様）
 * - Shift + ホイール: 水平パン
 * - スペースキー + ドラッグ: パン
 * - 中クリック + ドラッグ: パン
 * - Ctrl/Cmd + 0: 100%表示にリセット
 */
export function useCanvasZoomPan({
  minScale = 0.1,
  maxScale = 5,
  initialScale = 1,
}: UseCanvasZoomPanOptions = {}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [transform, setTransform] = useState<CanvasTransform>({
    scale: initialScale,
    x: 0,
    y: 0,
  });

  // パン操作の追跡用（レンダリング不要なのでrefで管理）
  const panRef = useRef({
    isPanning: false,
    isSpacePressed: false,
    lastX: 0,
    lastY: 0,
  });

  // rAFベースのスムーズ更新用
  const rafRef = useRef<number | null>(null);
  const pendingTransform = useRef<CanvasTransform | null>(null);

  const flushTransform = useCallback(() => {
    if (pendingTransform.current) {
      setTransform(pendingTransform.current);
      pendingTransform.current = null;
    }
    rafRef.current = null;
  }, []);

  const scheduleTransform = useCallback(
    (updater: (prev: CanvasTransform) => CanvasTransform) => {
      setTransform((prev) => {
        const next = updater(prev);
        pendingTransform.current = next;
        return next;
      });
      // 連続更新時にrAF内でまとめてレンダリングさせる
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(flushTransform);
      }
    },
    [flushTransform],
  );

  // rAFクリーンアップ
  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  // ホイール＋マウスイベント（ネイティブリスナー）
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      // キャンバス上のすべてのホイールイベントを捕捉（ページスクロール防止）
      e.preventDefault();
      e.stopPropagation();

      if (e.ctrlKey || e.metaKey) {
        // ズーム（カーソル位置中心）
        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        setTransform((prev) => {
          const worldX = (mouseX - prev.x) / prev.scale;
          const worldY = (mouseY - prev.y) / prev.scale;

          const zoomFactor = 0.999 ** e.deltaY;
          const newScale = Math.max(minScale, Math.min(maxScale, prev.scale * zoomFactor));

          return {
            scale: newScale,
            x: mouseX - worldX * newScale,
            y: mouseY - worldY * newScale,
          };
        });
      } else {
        // パン（Figma同様：ホイール = 垂直パン、Shift+ホイール = 水平パン）
        const dx = e.shiftKey ? -e.deltaY : -e.deltaX;
        const dy = e.shiftKey ? 0 : -e.deltaY;

        scheduleTransform((prev) => ({
          ...prev,
          x: prev.x + dx,
          y: prev.y + dy,
        }));
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      const state = panRef.current;
      // 中クリック(button=1) または スペース+左クリック(button=0) でパン開始
      if (e.button === 1 || (e.button === 0 && state.isSpacePressed)) {
        e.preventDefault();
        state.isPanning = true;
        state.lastX = e.clientX;
        state.lastY = e.clientY;
        container.style.cursor = "grabbing";
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      const state = panRef.current;
      if (!state.isPanning) return;

      const dx = e.clientX - state.lastX;
      const dy = e.clientY - state.lastY;
      state.lastX = e.clientX;
      state.lastY = e.clientY;

      setTransform((prev) => ({
        ...prev,
        x: prev.x + dx,
        y: prev.y + dy,
      }));
    };

    const onMouseUp = () => {
      const state = panRef.current;
      if (state.isPanning) {
        state.isPanning = false;
        container.style.cursor = state.isSpacePressed ? "grab" : "";
      }
    };

    // passive: false でホイールのpreventDefaultを有効化
    container.addEventListener("wheel", onWheel, { passive: false });
    container.addEventListener("mousedown", onMouseDown);
    // mousemove/mouseup は window で捕捉（コンテナ外にドラッグしても追従）
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [minScale, maxScale, scheduleTransform]);

  // キーボードショートカット
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        panRef.current.isSpacePressed = true;
        if (containerRef.current) {
          containerRef.current.style.cursor = "grab";
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "0") {
        e.preventDefault();
        setTransform({ scale: 1, x: 0, y: 0 });
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        panRef.current.isSpacePressed = false;
        panRef.current.isPanning = false;
        if (containerRef.current) {
          containerRef.current.style.cursor = "";
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  const transformStyle = useMemo(
    (): React.CSSProperties => ({
      transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
      transformOrigin: "0 0",
      willChange: "transform",
    }),
    [transform],
  );

  const resetZoom = useCallback(() => {
    setTransform({ scale: 1, x: 0, y: 0 });
  }, []);

  return {
    scale: transform.scale,
    offset: { x: transform.x, y: transform.y },
    containerRef,
    transformStyle,
    resetZoom,
  };
}

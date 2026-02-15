import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useCanvasZoomPan } from "@/hook/use-canvas-zoom-pan";
import { useCompareStore } from "@/store/compare-store";

export function CompareCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [splitPosition, setSplitPosition] = useState(0.5);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDraggingMode, setIsDraggingMode] = useState(false);

  const { t } = useTranslation();
  const { designImage, screenshotImage, compareResult, viewMode, overlayOpacity } =
    useCompareStore();

  const { scale, containerRef, transformStyle, resetZoom } = useCanvasZoomPan({
    initialScale: 1,
  });

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const drawImage = async () => {
      if (viewMode === "pixel_diff" && compareResult?.diffImageBase64) {
        const img = await loadImage(`data:image/png;base64,${compareResult.diffImageBase64}`);
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        return;
      }

      if (!designImage && !screenshotImage) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }

      const design = designImage ? await loadImage(designImage) : null;
      const screenshot = screenshotImage ? await loadImage(screenshotImage) : null;

      if (!design && !screenshot) return;

      const img = design || screenshot!;
      canvas.width = img.width;
      canvas.height = img.height;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      switch (viewMode) {
        case "design_only":
          if (design) ctx.drawImage(design, 0, 0);
          break;

        case "implementation":
          if (screenshot) ctx.drawImage(screenshot, 0, 0);
          break;

        case "transparent_overlay":
          if (screenshot) ctx.drawImage(screenshot, 0, 0);
          if (design) {
            ctx.globalAlpha = overlayOpacity;
            ctx.drawImage(design, 0, 0);
            ctx.globalAlpha = 1.0;
          }
          break;

        case "split_screen": {
          const splitX = canvas.width * splitPosition;
          if (design) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, 0, splitX, canvas.height);
            ctx.clip();
            ctx.drawImage(design, 0, 0);
            ctx.restore();
          }
          if (screenshot) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(splitX, 0, canvas.width - splitX, canvas.height);
            ctx.clip();
            ctx.drawImage(screenshot, 0, 0);
            ctx.restore();
          }
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(splitX, 0);
          ctx.lineTo(splitX, canvas.height);
          ctx.stroke();
          break;
        }

        case "blended_diff":
          if (design && screenshot) {
            ctx.globalAlpha = 0.5;
            ctx.drawImage(design, 0, 0);
            ctx.globalCompositeOperation = "difference";
            ctx.drawImage(screenshot, 0, 0);
            ctx.globalCompositeOperation = "source-over";
            ctx.globalAlpha = 1.0;
          }
          break;

        case "draggable_overlay":
          if (screenshot) ctx.drawImage(screenshot, 0, 0);
          if (design) {
            ctx.globalAlpha = overlayOpacity;
            ctx.drawImage(design, dragOffset.x, dragOffset.y);
            ctx.globalAlpha = 1.0;
          }
          break;

        case "pixel_diff":
          if (compareResult?.diffImageBase64) {
            const diffImg = await loadImage(
              `data:image/png;base64,${compareResult.diffImageBase64}`,
            );
            ctx.drawImage(diffImg, 0, 0);
          } else if (screenshot) {
            ctx.drawImage(screenshot, 0, 0);
          }
          break;
      }
    };

    drawImage().catch(console.error);
  }, [
    designImage,
    screenshotImage,
    compareResult,
    viewMode,
    overlayOpacity,
    splitPosition,
    dragOffset,
  ]);

  const handleMouseDown = (_e: React.MouseEvent<HTMLCanvasElement>) => {
    if (viewMode === "draggable_overlay" || viewMode === "split_screen") {
      setIsDraggingMode(true);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (viewMode === "draggable_overlay" && isDraggingMode) {
      setDragOffset((prev) => ({
        x: prev.x + e.movementX / scale,
        y: prev.y + e.movementY / scale,
      }));
    }
    if (viewMode === "split_screen" && isDraggingMode && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      setSplitPosition(Math.max(0, Math.min(1, x / rect.width)));
    }
  };

  const handleMouseUp = () => {
    setIsDraggingMode(false);
  };

  const getCursor = () => {
    if (viewMode === "draggable_overlay") return "move";
    if (viewMode === "split_screen") return "ew-resize";
    return "default";
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-muted"
      data-testid="compare-canvas-container"
    >
      <div style={transformStyle}>
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          className="border bg-background"
          style={{ cursor: getCursor() }}
        />
      </div>
      <div className="absolute bottom-2 right-2 rounded bg-background/80 px-2 py-1 text-xs text-muted-foreground">
        {Math.round(scale * 100)}%
      </div>
      <div className="absolute bottom-2 left-2 rounded bg-background/80 px-2 py-1 text-xs text-muted-foreground">
        {t("canvas.hint")}
      </div>
      <button
        type="button"
        className="absolute top-2 right-2 rounded bg-background/80 px-2 py-1 text-xs text-muted-foreground hover:bg-background"
        onClick={resetZoom}
      >
        {t("canvas.reset")}
      </button>
    </div>
  );
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

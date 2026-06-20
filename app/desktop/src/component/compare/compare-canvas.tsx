import { useEffect, useRef, useState } from "react";

import { useTranslation } from "react-i18next";

import { Button } from "@/component/ui/button";
import { useCanvasZoomPan } from "@/hook/use-canvas-zoom-pan";
import { cn } from "@/lib/util";
import { useCompareStore, type ViewMode } from "@/store/compare-store";

// --- Drawing functions per view mode ---

function drawDesignOnly(ctx: CanvasRenderingContext2D, design: HTMLImageElement | null) {
  if (design) ctx.drawImage(design, 0, 0);
}

function drawImplementation(ctx: CanvasRenderingContext2D, screenshot: HTMLImageElement | null) {
  if (screenshot) ctx.drawImage(screenshot, 0, 0);
}

function drawTransparentOverlay(
  ctx: CanvasRenderingContext2D,
  design: HTMLImageElement | null,
  screenshot: HTMLImageElement | null,
  opacity: number,
) {
  if (screenshot) ctx.drawImage(screenshot, 0, 0);
  if (design) {
    ctx.globalAlpha = opacity;
    ctx.drawImage(design, 0, 0);
    ctx.globalAlpha = 1.0;
  }
}

function drawSplitScreen(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  design: HTMLImageElement | null,
  screenshot: HTMLImageElement | null,
  splitPosition: number,
) {
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
  // 分割線は重なった画像上で常に判別できるコントラストを優先するため。
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(splitX, 0);
  ctx.lineTo(splitX, canvas.height);
  ctx.stroke();
}

function drawBlendedDiff(
  ctx: CanvasRenderingContext2D,
  design: HTMLImageElement | null,
  screenshot: HTMLImageElement | null,
) {
  if (design && screenshot) {
    ctx.globalAlpha = 0.5;
    ctx.drawImage(design, 0, 0);
    ctx.globalCompositeOperation = "difference";
    ctx.drawImage(screenshot, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1.0;
  }
}

function drawDraggableOverlay(
  ctx: CanvasRenderingContext2D,
  design: HTMLImageElement | null,
  screenshot: HTMLImageElement | null,
  opacity: number,
  offset: { x: number; y: number },
) {
  if (screenshot) ctx.drawImage(screenshot, 0, 0);
  if (design) {
    ctx.globalAlpha = opacity;
    ctx.drawImage(design, offset.x, offset.y);
    ctx.globalAlpha = 1.0;
  }
}

async function drawPixelDiff(
  ctx: CanvasRenderingContext2D,
  screenshot: HTMLImageElement | null,
  diffBase64: string | undefined,
) {
  if (diffBase64) {
    const diffImg = await loadImage(`data:image/png;base64,${diffBase64}`);
    ctx.drawImage(diffImg, 0, 0);
  } else if (screenshot) {
    ctx.drawImage(screenshot, 0, 0);
  }
}

interface DrawParams {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  viewMode: ViewMode;
  design: HTMLImageElement | null;
  screenshot: HTMLImageElement | null;
  overlayOpacity: number;
  splitPosition: number;
  dragOffset: { x: number; y: number };
  diffBase64: string | undefined;
}

async function drawByViewMode(params: DrawParams) {
  const { canvas, ctx, design, screenshot } = params;
  const img = design || screenshot;
  if (!img) return;

  canvas.width = img.width;
  canvas.height = img.height;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  switch (params.viewMode) {
    case "design_only":
      drawDesignOnly(ctx, design);
      break;
    case "implementation":
      drawImplementation(ctx, screenshot);
      break;
    case "transparent_overlay":
      drawTransparentOverlay(ctx, design, screenshot, params.overlayOpacity);
      break;
    case "split_screen":
      drawSplitScreen(ctx, canvas, design, screenshot, params.splitPosition);
      break;
    case "blended_diff":
      drawBlendedDiff(ctx, design, screenshot);
      break;
    case "draggable_overlay":
      drawDraggableOverlay(ctx, design, screenshot, params.overlayOpacity, params.dragOffset);
      break;
    case "pixel_diff":
      await drawPixelDiff(ctx, screenshot, params.diffBase64);
      break;
  }
}

// --- Main component ---

export function CompareCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [splitPosition, setSplitPosition] = useState(0.5);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDraggingMode, setIsDraggingMode] = useState(false);

  // Cache loaded images to avoid re-decoding on every opacity/split change
  const imageCacheRef = useRef<{
    designSrc: string | null;
    screenshotSrc: string | null;
    design: HTMLImageElement | null;
    screenshot: HTMLImageElement | null;
  }>({ designSrc: null, screenshotSrc: null, design: null, screenshot: null });

  const { t } = useTranslation();
  const designImage = useCompareStore((s) => s.designImage);
  const screenshotImage = useCompareStore((s) => s.screenshotImage);
  const compareResult = useCompareStore((s) => s.compareResult);
  const diffImageBase64 = compareResult?.diffImageBase64;
  const viewMode = useCompareStore((s) => s.viewMode);
  const overlayOpacity = useCompareStore((s) => s.overlayOpacity);
  const setError = useCompareStore((s) => s.setError);

  const { scale, containerRef, transformStyle, resetZoom } = useCanvasZoomPan({
    initialScale: 1,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = async () => {
      if (!designImage && !screenshotImage) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }

      // Use cached images when source hasn't changed
      const cache = imageCacheRef.current;
      let design: HTMLImageElement | null;
      let screenshot: HTMLImageElement | null;

      if (cache.designSrc === designImage) {
        design = cache.design;
      } else {
        design = designImage ? await loadImage(designImage) : null;
        cache.designSrc = designImage;
        cache.design = design;
      }

      if (cache.screenshotSrc === screenshotImage) {
        screenshot = cache.screenshot;
      } else {
        screenshot = screenshotImage ? await loadImage(screenshotImage) : null;
        cache.screenshotSrc = screenshotImage;
        cache.screenshot = screenshot;
      }

      await drawByViewMode({
        canvas,
        ctx,
        viewMode,
        design,
        screenshot,
        overlayOpacity,
        splitPosition,
        dragOffset,
        diffBase64: diffImageBase64,
      });
    };

    draw().catch((e) => setError(String(e)));
  }, [
    designImage,
    screenshotImage,
    diffImageBase64,
    viewMode,
    overlayOpacity,
    splitPosition,
    dragOffset,
    setError,
  ]);

  const handleMouseDown = () => {
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

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-muted/30"
      data-testid="compare-canvas-container"
    >
      <div style={transformStyle}>
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          className={cn(
            "border bg-background",
            viewMode === "draggable_overlay"
              ? "cursor-move"
              : viewMode === "split_screen"
                ? "cursor-ew-resize"
                : "cursor-default",
          )}
          role="img"
          aria-label={t("compare.canvasLabel")}
        />
      </div>
      <div className="absolute right-2 bottom-2 rounded-md bg-card/90 px-2 py-1 text-muted-foreground text-xs shadow-sm backdrop-blur-sm">
        {Math.round(scale * 100)}%
      </div>
      <div className="absolute bottom-2 left-2 rounded-md bg-card/90 px-2 py-1 text-muted-foreground text-xs shadow-sm backdrop-blur-sm">
        {t("canvas.hint")}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="absolute top-2 right-2 bg-card/90 text-muted-foreground text-xs shadow-sm backdrop-blur-sm hover:bg-card"
        onClick={resetZoom}
      >
        {t("canvas.reset")}
      </Button>
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

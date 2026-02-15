import type { CropRegion } from "@figdiff/shared";
import { useRef, useState } from "react";

import { Button } from "@/component/ui/button";
import { useCompareStore } from "@/store/compare-store";

export function CropRegionSelector() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [currentPos, setCurrentPos] = useState({ x: 0, y: 0 });

  const { cropRegion, setCropRegion, designImage, screenshotImage } = useCompareStore();

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setStartPos({ x, y });
    setCurrentPos({ x, y });
    setIsSelecting(true);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isSelecting) return;

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setCurrentPos({ x, y });
    drawSelection();
  };

  const handleMouseUp = () => {
    if (!isSelecting) return;

    const x = Math.min(startPos.x, currentPos.x);
    const y = Math.min(startPos.y, currentPos.y);
    const width = Math.abs(currentPos.x - startPos.x);
    const height = Math.abs(currentPos.y - startPos.y);

    if (width > 10 && height > 10) {
      const region: CropRegion = {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height),
      };
      setCropRegion(region);
    }

    setIsSelecting(false);
  };

  const drawSelection = () => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      const x = Math.min(startPos.x, currentPos.x);
      const y = Math.min(startPos.y, currentPos.y);
      const width = Math.abs(currentPos.x - startPos.x);
      const height = Math.abs(currentPos.y - startPos.y);

      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(x, y, width, height);

      ctx.fillStyle = "rgba(59, 130, 246, 0.1)";
      ctx.fillRect(x, y, width, height);
    };
    img.src = designImage || screenshotImage || "";
  };

  const handleClearRegion = () => {
    setCropRegion(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button size="sm" variant={isSelecting ? "default" : "outline"}>
          {isSelecting ? "選択中..." : "範囲指定"}
        </Button>
        {cropRegion && (
          <>
            <span className="text-sm text-muted-foreground">
              x: {cropRegion.x}, y: {cropRegion.y}, w: {cropRegion.width}, h: {cropRegion.height}
            </span>
            <Button size="sm" variant="ghost" onClick={handleClearRegion}>
              クリア
            </Button>
          </>
        )}
      </div>

      <div className="relative">
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          className="border cursor-crosshair bg-muted"
        />
      </div>
    </div>
  );
}

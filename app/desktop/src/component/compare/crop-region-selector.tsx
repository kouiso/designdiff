import { useEffect, useRef, useState } from "react";

import { useTranslation } from "react-i18next";

import type { CropRegion } from "@figdiff/shared";

import { Button } from "@/component/ui/button";
import { useCompareStore } from "@/store/compare-store";
import { readCssToken } from "@/util/css-token";

export function CropRegionSelector() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [currentPos, setCurrentPos] = useState({ x: 0, y: 0 });

  const { t } = useTranslation();
  const { cropRegion, setCropRegion, designImage, screenshotImage } = useCompareStore();

  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const src = designImage || screenshotImage || "";
    if (!src) {
      imgRef.current = null;
      return;
    }
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
    };
    img.src = src;
  }, [designImage, screenshotImage]);

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

  // 選択矩形を描画する。非選択中も毎回画像を描き直すのは、
  // 前フレームの破線が残ったままクリア後も消えない stale 描画を
  // 防ぐため。確定済み領域は登録領域として描き続ける。
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = img.width;
    canvas.height = img.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

    const region = isSelecting
      ? {
          x: Math.min(startPos.x, currentPos.x),
          y: Math.min(startPos.y, currentPos.y),
          width: Math.abs(currentPos.x - startPos.x),
          height: Math.abs(currentPos.y - startPos.y),
        }
      : cropRegion;
    if (!region) return;

    ctx.strokeStyle = readCssToken("--cobalt", "#3b82f6");
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(region.x, region.y, region.width, region.height);

    ctx.fillStyle = readCssToken("--cobalt-soft", "rgba(59,130,246,0.1)");
    ctx.fillRect(region.x, region.y, region.width, region.height);
  }, [isSelecting, startPos, currentPos, cropRegion]);

  const handleClearRegion = () => {
    setCropRegion(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button size="sm" variant={isSelecting ? "default" : "outline"}>
          {isSelecting ? t("crop.selecting") : t("crop.selectRegion")}
        </Button>
        {cropRegion && (
          <>
            <span className="text-muted-foreground text-sm">
              x: {cropRegion.x}, y: {cropRegion.y}, w: {cropRegion.width}, h: {cropRegion.height}
            </span>
            <Button size="sm" variant="ghost" onClick={handleClearRegion}>
              {t("crop.clear")}
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
          className="cursor-crosshair border bg-muted"
          role="img"
          aria-label={t("crop.canvasLabel")}
        />
      </div>
    </div>
  );
}

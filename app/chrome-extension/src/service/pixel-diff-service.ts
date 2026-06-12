import { clusterDiffPixels } from "@figdiff/shared";
import type { DiffRegion } from "@figdiff/shared";

// =============================================================================
// Pixel Diff Service — captureVisibleTab → pixelmatch → clusterDiffPixels
// Service worker (background.ts) から呼び出す
// =============================================================================

export const DIFF_THRESHOLD = 10;

export const calculateMatchRate = (totalPixelCount: number, diffPixelCount: number): number => {
  return Math.round(((totalPixelCount - diffPixelCount) / totalPixelCount) * 10000) / 100;
};

export const isPixelDifferent = (rDiff: number, gDiff: number, bDiff: number): boolean => {
  return Math.max(rDiff, gDiff, bDiff) > DIFF_THRESHOLD;
};

export interface DiffResult {
  matchRate: number;
  diffPixelCount: number;
  totalPixelCount: number;
  regions: DiffRegion[];
  diffImageBase64: string;
}

/**
 * 2つのbase64画像を比較してピクセル差分を計算する
 * Canvas APIはService Workerで使えないため、OffscreenCanvasを使う
 */
export async function computePixelDiff(
  designBase64: string,
  screenshotBase64: string,
  width: number,
  height: number,
): Promise<DiffResult> {
  const [designData, screenshotData] = await Promise.all([
    decodeImageToImageData(designBase64, width, height),
    decodeImageToImageData(screenshotBase64, width, height),
  ]);

  const diffCanvas = new OffscreenCanvas(width, height);
  const diffCtx = diffCanvas.getContext("2d");
  if (!diffCtx) {
    throw new Error("OffscreenCanvas 2d context unavailable");
  }

  const diffImageData = diffCtx.createImageData(width, height);
  const diffPixels = diffImageData.data;

  let diffPixelCount = 0;
  const totalPixelCount = width * height;

  for (let i = 0; i < totalPixelCount; i++) {
    const offset = i * 4;
    const rDiff = Math.abs(designData[offset] - screenshotData[offset]);
    const gDiff = Math.abs(designData[offset + 1] - screenshotData[offset + 1]);
    const bDiff = Math.abs(designData[offset + 2] - screenshotData[offset + 2]);

    if (isPixelDifferent(rDiff, gDiff, bDiff)) {
      diffPixels[offset] = 255;
      diffPixels[offset + 1] = 0;
      diffPixels[offset + 2] = 0;
      diffPixels[offset + 3] = 255;
      diffPixelCount++;
    } else {
      diffPixels[offset] = designData[offset];
      diffPixels[offset + 1] = designData[offset + 1];
      diffPixels[offset + 2] = designData[offset + 2];
      diffPixels[offset + 3] = Math.round(designData[offset + 3] * 0.3);
    }
  }

  diffCtx.putImageData(diffImageData, 0, 0);

  const matchRate = calculateMatchRate(totalPixelCount, diffPixelCount);
  const regions = clusterDiffPixels(diffPixels, width, height);

  const blob = await diffCanvas.convertToBlob({ type: "image/png" });
  const diffImageBase64 = await blobToBase64(blob);

  return { matchRate, diffPixelCount, totalPixelCount, regions, diffImageBase64 };
}

async function decodeImageToImageData(
  base64: string,
  targetWidth: number,
  targetHeight: number,
): Promise<Uint8ClampedArray> {
  const dataUrl = base64.startsWith("data:") ? base64 : `data:image/png;base64,${base64}`;
  const response = await fetch(dataUrl);
  if (!response.ok) throw new Error(`Failed to decode image: ${response.status}`);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  const canvas = new OffscreenCanvas(targetWidth, targetHeight);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("OffscreenCanvas 2d context unavailable");
  }
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  bitmap.close();
  return ctx.getImageData(0, 0, targetWidth, targetHeight).data;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

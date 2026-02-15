import type { CompareDesignResult, CropRegion, DiffRegion } from "@figdiff/shared";
import pixelmatch from "pixelmatch";

import { cropImage, getImageDimensions, resizeImageToMatch } from "@/lib/tauri-command";

interface CompareImagesOptions {
  designImage: string;
  screenshotImage: string;
  threshold?: number;
  cropRegion?: CropRegion;
}

export async function compareImages(options: CompareImagesOptions): Promise<CompareDesignResult> {
  const { designImage, screenshotImage, threshold = 0.1, cropRegion } = options;

  let designBase64 = designImage.replace(/^data:image\/\w+;base64,/, "");
  let screenshotBase64 = screenshotImage.replace(/^data:image\/\w+;base64,/, "");

  if (cropRegion) {
    designBase64 = await cropImage(
      designBase64,
      cropRegion.x,
      cropRegion.y,
      cropRegion.width,
      cropRegion.height,
    );
    screenshotBase64 = await cropImage(
      screenshotBase64,
      cropRegion.x,
      cropRegion.y,
      cropRegion.width,
      cropRegion.height,
    );
  }

  const designDim = await getImageDimensions(designBase64);
  const screenshotDim = await getImageDimensions(screenshotBase64);

  if (designDim.width !== screenshotDim.width || designDim.height !== screenshotDim.height) {
    designBase64 = await resizeImageToMatch(
      designBase64,
      screenshotDim.width,
      screenshotDim.height,
    );
  }

  const design = await base64ToImageData(designBase64);
  const screenshot = await base64ToImageData(screenshotBase64);

  const { width, height } = design;
  const diff = new Uint8ClampedArray(width * height * 4);

  const diffPixelCount = pixelmatch(design.data, screenshot.data, diff, width, height, {
    threshold,
  });

  const totalPixelCount = width * height;
  const matchRate = ((totalPixelCount - diffPixelCount) / totalPixelCount) * 100;

  const diffImageBase64 = await imageToBas64(diff, width, height);

  const diffRegions = clusterDiffRegions(diff, width, height);

  const comparisonId = `cmp-${Date.now()}`;
  const suggestion = generateSuggestion(matchRate, diffRegions.length);

  return {
    comparisonId,
    matchRate: Math.round(matchRate * 100) / 100,
    diffPixelCount,
    totalPixelCount,
    diffRegions,
    suggestion,
    diffImageBase64,
  } as CompareDesignResult & { diffImageBase64: string };
}

function clusterDiffRegions(
  diffData: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
): DiffRegion[] {
  const visited = new Set<number>();
  const regions: DiffRegion[] = [];
  let regionId = 0;

  for (let y = 0; y < imageHeight; y++) {
    for (let x = 0; x < imageWidth; x++) {
      const idx = (y * imageWidth + x) * 4;
      if (diffData[idx] > 0 && !visited.has(idx)) {
        const region = floodFill(diffData, imageWidth, imageHeight, x, y, visited);
        if (region.pixelCount >= 10) {
          regions.push({
            id: regionId++,
            bounds: region.bounds,
            diffPixelCount: region.pixelCount,
            nearbyNodeIds: [],
            nearbyNodeNames: [],
          });
        }
      }
    }
  }

  return regions;
}

function floodFill(
  diffData: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  startX: number,
  startY: number,
  visited: Set<number>,
): { bounds: { x: number; y: number; width: number; height: number }; pixelCount: number } {
  const stack: [number, number][] = [[startX, startY]];
  let minX = startX;
  let maxX = startX;
  let minY = startY;
  let maxY = startY;
  let pixelCount = 0;

  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    const idx = (y * imageWidth + x) * 4;

    if (
      x < 0 ||
      x >= imageWidth ||
      y < 0 ||
      y >= imageHeight ||
      visited.has(idx) ||
      diffData[idx] === 0
    ) {
      continue;
    }

    visited.add(idx);
    pixelCount++;

    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);

    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }

  return {
    bounds: {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    },
    pixelCount,
  };
}

function generateSuggestion(matchRate: number, diffRegionCount: number): string {
  if (matchRate === 100) {
    return "一致率100%です。差分はありません。";
  }
  if (matchRate >= 95) {
    return `軽微な差分が${diffRegionCount}箇所あります。inspect_nodeで差分領域のノードを確認してください。`;
  }
  return `大きな差分が${diffRegionCount}箇所あります。inspect_nodeで各差分領域を確認し、修正してください。`;
}

async function base64ToImageData(base64: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Failed to get canvas context"));
        return;
      }
      ctx.drawImage(img, 0, 0);
      resolve(ctx.getImageData(0, 0, img.width, img.height));
    };
    img.onerror = reject;
    img.src = `data:image/png;base64,${base64}`;
  });
}

async function imageToBas64(
  pixelData: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = imageWidth;
    canvas.height = imageHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new Error("Failed to get canvas context"));
      return;
    }
    const imageData = ctx.createImageData(imageWidth, imageHeight);
    for (let i = 0; i < pixelData.length; i++) {
      imageData.data[i] = pixelData[i];
    }
    ctx.putImageData(imageData, 0, 0);
    resolve(canvas.toDataURL("image/png").split(",")[1]);
  });
}

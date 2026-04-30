import pixelmatch from "pixelmatch";
import { z } from "zod";

import {
  type CompareDesignResult,
  CompareDesignResultSchema,
  type CropRegion,
  CropRegionSchema,
  type DiffRegion,
  DiffRegionSchema,
} from "@figdiff/shared";

import { buildDiffReport } from "@/service/diff-report";
import {
  cropImageSource,
  imageDataToBase64,
  imageDataToCanvas,
  imageElementToData,
  loadImageElement,
  resizeImageData,
  resizeImageDataContainTop,
} from "@/util/canvas-image";

interface CompareImagesOptions {
  designImage: string;
  screenshotImage: string;
  threshold?: number;
  cropRegion?: CropRegion;
}

const CompareImagesOptionsSchema = z.object({
  designImage: z.string().min(1),
  screenshotImage: z.string().min(1),
  threshold: z.number().min(0).max(1).optional(),
  cropRegion: CropRegionSchema.optional(),
});

export async function compareImages(options: CompareImagesOptions): Promise<CompareDesignResult> {
  const validated = CompareImagesOptionsSchema.parse(options);
  const { designImage, screenshotImage, threshold = 0.1, cropRegion } = validated;

  const designBase64 = designImage.replace(/^data:image\/\w+;base64,/, "");
  const screenshotBase64 = screenshotImage.replace(/^data:image\/\w+;base64,/, "");

  const [designImg, screenshotImg] = await Promise.all([
    loadImageElement(designBase64),
    loadImageElement(screenshotBase64),
  ]);

  let designData: ImageData;
  let screenshotData: ImageData;

  designData = imageElementToData(designImg);
  screenshotData = imageElementToData(screenshotImg);

  if (
    cropRegion &&
    (designData.width !== screenshotData.width || designData.height !== screenshotData.height)
  ) {
    // クロップ座標を両画像で同じ座標系として扱えるよう、クロップ前に幅・高さを揃える。
    designData = resizeImageDataContainTop(
      imageDataToCanvas(designData),
      screenshotData.width,
      screenshotData.height,
    );
  } else if (designData.width !== screenshotData.width) {
    // クロップがない場合は既存方針どおり、スクリーンショット幅に合わせてデザイン画像を同比率でリサイズする。
    const resizeHeight = Math.round(designData.height * (screenshotData.width / designData.width));
    designData = resizeImageData(imageDataToCanvas(designData), screenshotData.width, resizeHeight);
  }

  if (cropRegion) {
    designData = cropImageSource(
      imageDataToCanvas(designData),
      cropRegion.x,
      cropRegion.y,
      cropRegion.width,
      cropRegion.height,
    );
    screenshotData = cropImageSource(
      imageDataToCanvas(screenshotData),
      cropRegion.x,
      cropRegion.y,
      cropRegion.width,
      cropRegion.height,
    );
  }

  if (designData.width !== screenshotData.width || designData.height !== screenshotData.height) {
    designData = resizeImageDataContainTop(
      imageDataToCanvas(designData),
      screenshotData.width,
      screenshotData.height,
    );
  }

  const { width, height } = screenshotData;
  const diff = new Uint8ClampedArray(width * height * 4);

  const diffPixelCount = pixelmatch(designData.data, screenshotData.data, diff, width, height, {
    threshold,
  });

  const totalPixelCount = width * height;
  const matchRate = ((totalPixelCount - diffPixelCount) / totalPixelCount) * 100;

  const diffImageData = new ImageData(diff, width, height);
  const diffImageBase64 = imageDataToBase64(diffImageData);

  const diffRegions = clusterDiffRegions(diff, width, height);

  const comparisonId = `cmp-${Date.now()}`;
  const suggestion = generateSuggestion(matchRate);
  const diffReport = buildDiffReport({
    designPixels: designData.data,
    screenshotPixels: screenshotData.data,
    width,
    height,
  });

  const result: CompareDesignResult & { diffImageBase64: string } = {
    comparisonId,
    matchRate: Math.round(matchRate * 100) / 100,
    diffPixelCount,
    totalPixelCount,
    diffRegions,
    suggestion,
    diffReport,
    diffImageBase64,
  };

  return CompareDesignResultSchema.extend({ diffImageBase64: z.string() }).parse(result);
}

export function clusterDiffRegions(
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
          const diffRegion = {
            id: regionId++,
            bounds: region.bounds,
            diffPixelCount: region.pixelCount,
            nearbyNodeIds: [],
            nearbyNodeNames: [],
          };
          regions.push(DiffRegionSchema.parse(diffRegion));
        }
      }
    }
  }

  return regions;
}

export function floodFill(
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
    const item = stack.pop();
    if (!item) break;
    const [x, y] = item;
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

export function generateSuggestion(matchRate: number): string {
  if (matchRate === 100) {
    return "compare.suggestionPerfect";
  }
  if (matchRate >= 95) {
    return "compare.suggestionMinor";
  }
  return "compare.suggestionMajor";
}

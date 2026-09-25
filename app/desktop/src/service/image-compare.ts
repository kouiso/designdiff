import { z } from "zod";

import {
  applyIgnoreRegions,
  classifyIgnoreRegionEntries,
  comparePixels,
  type CompareDesignResult,
  CompareDesignResultSchema,
  type CropRegion,
  CropRegionSchema,
  type DiffRegion,
  DiffRegionSchema,
  FigmaGeometryBoxSchema,
  type IgnoreRegionConfigEntry,
  IgnoreRegionConfigEntrySchema,
  type IgnoreRegionCoordinateContext,
  IgnoreRegionCoordinateContextSchema,
  mapFigmaGeometryToImage,
} from "@figdiff/shared";

import { buildDesktopDiffAnalysis, type FixTargetRegionMeasurement } from "@/service/diff-report";
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
  ignoreRegionEntries?: IgnoreRegionConfigEntry[];
  fileKey?: string;
  nodeId?: string;
  fixTarget?: {
    sourceVersion: string;
    rootNodeId: string;
    targetNodeId: string;
    targetNodeName: string;
    rootBox: { x: number; y: number; width: number; height: number };
    targetBox: { x: number; y: number; width: number; height: number };
  };
}

const CompareImagesOptionsSchema = z.object({
  designImage: z.string().min(1),
  screenshotImage: z.string().min(1),
  threshold: z.number().min(0).max(1).optional(),
  cropRegion: CropRegionSchema.optional(),
  ignoreRegionEntries: z.array(IgnoreRegionConfigEntrySchema).optional(),
  fileKey: z.string().min(1).optional(),
  nodeId: z.string().min(1).optional(),
  fixTarget: z
    .object({
      sourceVersion: z.string().min(1),
      rootNodeId: z.string().min(1),
      targetNodeId: z.string().min(1),
      targetNodeName: z.string(),
      rootBox: FigmaGeometryBoxSchema,
      targetBox: FigmaGeometryBoxSchema,
    })
    .optional(),
});

export interface DesktopCompareResult extends CompareDesignResult {
  diffImageBase64: string;
  comparisonGeometry: IgnoreRegionCoordinateContext;
  ignoredRegionIds: string[];
  incompatibleIgnoreRegionIds: string[];
  legacyIgnoreRegionIds: string[];
  fixTargetRegion?: FixTargetRegionMeasurement;
}

export async function compareImages(options: CompareImagesOptions): Promise<DesktopCompareResult> {
  const validated = CompareImagesOptionsSchema.parse(options);
  const {
    designImage,
    screenshotImage,
    threshold = 0.1,
    cropRegion,
    ignoreRegionEntries = [],
    fileKey,
    nodeId,
    fixTarget,
  } = validated;

  const designBase64 = designImage.replace(/^data:image\/\w+;base64,/, "");
  const screenshotBase64 = screenshotImage.replace(/^data:image\/\w+;base64,/, "");

  const [designImg, screenshotImg] = await Promise.all([
    loadImageElement(designBase64),
    loadImageElement(screenshotBase64),
  ]);
  const designOriginalWidth = designImg.naturalWidth;
  const designOriginalHeight = designImg.naturalHeight;
  const screenshotOriginalWidth = screenshotImg.naturalWidth;
  const screenshotOriginalHeight = screenshotImg.naturalHeight;

  let designData: ImageData;
  let screenshotData: ImageData;

  designData = imageElementToData(designImg);
  screenshotData = imageElementToData(screenshotImg);
  const preCropScale = { x: 1, y: 1 };
  const cropOrigin = { x: 0, y: 0 };

  if (!cropRegion && designData.width !== screenshotData.width) {
    // クロップがない場合は既存方針どおり、スクリーンショット幅に合わせてデザイン画像を同比率でリサイズする。
    const resizeHeight = Math.round(designData.height * (screenshotData.width / designData.width));
    preCropScale.x = screenshotData.width / designData.width;
    preCropScale.y = resizeHeight / designData.height;
    designData = resizeImageData(imageDataToCanvas(designData), screenshotData.width, resizeHeight);
  }

  if (cropRegion) {
    const screenshotCropRegion = scaleCropRegion(
      cropRegion,
      screenshotData.width / designData.width,
      screenshotData.height / designData.height,
    );
    cropOrigin.x = Math.floor(cropRegion.x);
    cropOrigin.y = Math.floor(cropRegion.y);
    designData = cropImageSource(
      imageDataToCanvas(designData),
      cropRegion.x,
      cropRegion.y,
      cropRegion.width,
      cropRegion.height,
    );
    screenshotData = cropImageSource(
      imageDataToCanvas(screenshotData),
      screenshotCropRegion.x,
      screenshotCropRegion.y,
      screenshotCropRegion.width,
      screenshotCropRegion.height,
    );
  }

  const outputScale = { x: 1, y: 1 };
  const outputOffset = { x: 0, y: 0 };
  if (designData.width !== screenshotData.width || designData.height !== screenshotData.height) {
    const scale = Math.min(
      screenshotData.width / designData.width,
      screenshotData.height / designData.height,
    );
    const renderedWidth = Math.round(designData.width * scale);
    const renderedHeight = Math.round(designData.height * scale);
    outputScale.x = renderedWidth / designData.width;
    outputScale.y = renderedHeight / designData.height;
    outputOffset.x = Math.round((screenshotData.width - renderedWidth) / 2);
    designData = resizeImageDataContainTop(
      imageDataToCanvas(designData),
      screenshotData.width,
      screenshotData.height,
    );
  }

  // ignore領域を同じ値へ塗る処理はpixel diff専用にする。塗った穴を含むdesignだけを
  // 後で平行移動すると、穴がmaskの外へ移って人工的な差分になるため、信号採点には
  // mask適用前の画素とmask自体を渡す。
  const reportDesignPixels = designData.data.slice();
  const reportScreenshotPixels = screenshotData.data.slice();

  const { width, height } = screenshotData;
  const comparisonGeometry = IgnoreRegionCoordinateContextSchema.parse({
    canvas_width: width,
    canvas_height: height,
    design_original_width: designOriginalWidth,
    design_original_height: designOriginalHeight,
    screenshot_original_width: screenshotOriginalWidth,
    screenshot_original_height: screenshotOriginalHeight,
    file_key: fileKey,
    node_id: nodeId,
    crop_region: cropRegion,
  });
  const classifiedEntries = classifyIgnoreRegionEntries(ignoreRegionEntries, comparisonGeometry);
  const ignoreRegions = classifiedEntries.applicable.map(({ x, y, width, height, label }) => ({
    x,
    y,
    width,
    height,
    label,
  }));
  const ignoreMaskResult = applyIgnoreRegions(
    designData.data,
    screenshotData.data,
    width,
    height,
    ignoreRegions,
  );
  const { maskedPixelCount } = ignoreMaskResult;
  const diff = new Uint8ClampedArray(width * height * 4);

  const diffPixelCount = comparePixels(designData.data, screenshotData.data, diff, width, height, {
    threshold,
  });

  const totalPixelCount = width * height - maskedPixelCount;
  if (totalPixelCount === 0) {
    throw new Error(
      "Ignore regions cover the entire comparison canvas; no pixels remain to compare.",
    );
  }
  const matchRate = ((totalPixelCount - diffPixelCount) / totalPixelCount) * 100;

  const diffImageData = new ImageData(diff, width, height);
  const diffImageBase64 = imageDataToBase64(diffImageData);

  const diffRegions = clusterDiffRegions(diff, width, height);

  const comparisonId = `cmp-${Date.now()}`;
  const suggestion = generateSuggestion(matchRate);
  const mappedTarget = fixTarget
    ? mapFigmaGeometryToImage(fixTarget.rootBox, fixTarget.targetBox, {
        sourceSize: { width: designOriginalWidth, height: designOriginalHeight },
        preCropScale,
        cropOrigin,
        outputScale,
        outputOffset,
        outputSize: { width, height },
      })
    : null;
  const analysis = buildDesktopDiffAnalysis({
    designPixels: reportDesignPixels,
    screenshotPixels: reportScreenshotPixels,
    width,
    height,
    ignoreMask: ignoreMaskResult.mask,
    targetRegion:
      fixTarget && mappedTarget
        ? {
            nodeId: fixTarget.targetNodeId,
            nodeName: fixTarget.targetNodeName,
            bbox: mappedTarget,
          }
        : undefined,
  });
  const diffReport = analysis.report;
  const fixTargetRegion: FixTargetRegionMeasurement | undefined = fixTarget
    ? (analysis.targetRegion ?? {
        status: "unmeasured",
        nodeId: fixTarget.targetNodeId,
        nodeName: fixTarget.targetNodeName,
        reason: "outside-canvas",
      })
    : undefined;

  const result: DesktopCompareResult = {
    comparisonId,
    matchRate: Math.round(matchRate * 100) / 100,
    diffPixelCount,
    totalPixelCount,
    diffRegions,
    suggestion,
    diffReport,
    diffImageBase64,
    comparisonGeometry,
    ignoredRegionIds: classifiedEntries.applicable.map((entry) => entry.id),
    incompatibleIgnoreRegionIds: classifiedEntries.incompatible.map((entry) => entry.id),
    legacyIgnoreRegionIds: classifiedEntries.legacy.map((entry) => entry.id),
    fixTargetRegion,
  };

  // 元のスキーマは「分割できなかったなら領域は空」という決まりを持つ。
  // extend では決まりごと落ちるので、それを保ったまま項目を足す方を使う。
  const parsed = CompareDesignResultSchema.safeExtend({
    diffImageBase64: z.string(),
    comparisonGeometry: IgnoreRegionCoordinateContextSchema,
    ignoredRegionIds: z.array(z.string()),
    incompatibleIgnoreRegionIds: z.array(z.string()),
    legacyIgnoreRegionIds: z.array(z.string()),
  }).parse(result);
  return fixTargetRegion ? { ...parsed, fixTargetRegion } : parsed;
}

function scaleCropRegion(region: CropRegion, scaleX: number, scaleY: number): CropRegion {
  return {
    x: Math.round(region.x * scaleX),
    y: Math.round(region.y * scaleY),
    width: Math.round(region.width * scaleX),
    height: Math.round(region.height * scaleY),
  };
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
      if (isDiffPixel(diffData, idx) && !visited.has(idx)) {
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
      !isDiffPixel(diffData, idx)
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

function isDiffPixel(diffData: Uint8ClampedArray, idx: number): boolean {
  const red = diffData[idx];
  const green = diffData[idx + 1];
  const blue = diffData[idx + 2];
  const alpha = diffData[idx + 3];

  if (alpha === 0 && red === 0 && green === 0 && blue === 0) {
    return false;
  }

  // pixelmatch は一致ピクセルを白/グレー、不一致ピクセルを赤/黄で描く。
  return red !== green || green !== blue;
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

/**
 * Image Comparison Service for MCP Server
 * Uses sharp for image processing, pixelmatch for diff detection
 * Node.js native (no Canvas API)
 */

import pixelmatch from "pixelmatch";
import sharp from "sharp";

import {
  clusterDiffPixels,
  clusterDiffPixelsGridDetailed,
  generateMatchSuggestion,
  matchDiffRegionsToNodes,
  type CompareDesignResult,
  type ClusterTelemetry,
  type CropRegion,
  type FigmaNode,
  type GridClusterOptions,
  type IgnoreRegion,
} from "@figdiff/shared";

import { buildDiffReport } from "./diff-report-builder.js";

type ClusterMode = "auto" | "grid" | "flood";

interface CompareImagesOptions {
  designBase64: string;
  screenshotBase64: string;
  threshold?: number;
  cropRegion?: CropRegion;
  clusterMode?: ClusterMode;
  gridOptions?: GridClusterOptions;
  // 既知の意図的差分マスク。各矩形内の差分ピクセルは matchRate / clustering から除外。
  // 矩形は cropRegion 適用後の座標系 (= screenshot ピクセル座標) で指定する。
  ignoreRegions?: IgnoreRegion[];
}

// Above this total pixel count, "auto" picks grid clustering. Full-page PC
// screenshots (1512×900+ ≈ 1.36M) clear the bar; SP-only or small component
// crops stay on flood-fill, where the legacy behaviour works well.
const AUTO_GRID_PIXEL_THRESHOLD = 1_000_000;
const DEFAULT_GRID_BUDGET_OPTIONS = {
  maxWallMs: 5000,
  maxRegions: 100,
  maxHotCellRatio: 0.5,
  fallbackToFlood: true,
} satisfies GridClusterOptions;

interface PaddingMask {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ClusterDiffResult {
  diffRegions: CompareDesignResult["diffRegions"];
  clusterTelemetry: ClusterTelemetry;
}

function clusterDiffRegions(args: {
  clusterMode: ClusterMode;
  totalPixelCount: number;
  diffPixelCount: number;
  diffPixelData: Uint8ClampedArray;
  width: number;
  height: number;
  gridOptions?: GridClusterOptions;
}): ClusterDiffResult {
  const { clusterMode, totalPixelCount, diffPixelCount, diffPixelData, width, height } = args;
  const gridOptions = { ...DEFAULT_GRID_BUDGET_OPTIONS, ...args.gridOptions };
  const useGrid =
    clusterMode === "grid" ||
    (clusterMode === "auto" && totalPixelCount >= AUTO_GRID_PIXEL_THRESHOLD);
  const clusterStartedAt = performance.now();
  let usedMode: "grid" | "flood" = useGrid ? "grid" : "flood";
  let fallbackReason: ClusterTelemetry["fallbackReason"];
  let diffRegions = useGrid ? [] : clusterDiffPixels(diffPixelData, width, height);
  let gridBudgetMs: number | undefined;

  if (useGrid) {
    const gridResult = clusterDiffPixelsGridDetailed(diffPixelData, width, height, gridOptions);
    diffRegions = gridResult.regions;
    gridBudgetMs = gridResult.budgetMs;
    if (gridResult.aborted) {
      fallbackReason = gridResult.abortReason;
    }
  }

  if (
    useGrid &&
    gridOptions.fallbackToFlood !== false &&
    diffRegions.length === 0 &&
    diffPixelCount > 0
  ) {
    usedMode = "flood";
    fallbackReason = fallbackReason ?? "grid-empty-with-diff";
    diffRegions = clusterDiffPixels(diffPixelData, width, height);
  }

  return {
    diffRegions,
    clusterTelemetry: {
      requestedMode: clusterMode,
      usedMode,
      fallbackUsed: fallbackReason !== undefined,
      fallbackReason,
      wallMs: Math.max(0, Math.round((performance.now() - clusterStartedAt) * 100) / 100),
      budgetMs: gridBudgetMs,
      regionCount: diffRegions.length,
    },
  };
}

/**
 * Compare two images and return diff analysis
 */
export async function compareImages(
  options: CompareImagesOptions,
  figmaRootNode?: FigmaNode,
  comparisonId?: string,
): Promise<CompareDesignResult> {
  const {
    designBase64,
    screenshotBase64,
    threshold = 0.1,
    cropRegion,
    clusterMode = "auto",
    gridOptions,
    ignoreRegions,
  } = options;

  // Decode base64 to buffers
  let designBuffer: Buffer = Buffer.from(designBase64, "base64");
  let screenshotBuffer: Buffer = Buffer.from(screenshotBase64, "base64");

  // Get original dimensions
  const designMeta = await sharp(designBuffer).metadata();
  const screenshotMeta = await sharp(screenshotBuffer).metadata();

  const designWidth = designMeta.width ?? 0;
  const designHeight = designMeta.height ?? 0;
  const screenshotWidth = screenshotMeta.width ?? 0;
  const screenshotHeight = screenshotMeta.height ?? 0;

  if (designWidth === 0 || designHeight === 0 || screenshotWidth === 0 || screenshotHeight === 0) {
    throw new Error("Invalid image dimensions");
  }

  // Resize design to match screenshot WIDTH first (maintaining aspect ratio)
  // This normalizes coordinate spaces before crop
  if (designWidth !== screenshotWidth) {
    const resizeHeight = Math.round(designHeight * (screenshotWidth / designWidth));
    designBuffer = await sharp(designBuffer)
      .resize(screenshotWidth, resizeHeight)
      .ensureAlpha()
      .toBuffer();
  }

  // Apply crop region if provided (now both images are in the same coordinate space)
  if (cropRegion) {
    designBuffer = await cropImageBuffer(designBuffer, cropRegion);
    screenshotBuffer = await cropImageBuffer(screenshotBuffer, cropRegion);
  }

  // Get final dimensions after crop
  const finalDesignMeta = await sharp(designBuffer).metadata();
  const finalScreenshotMeta = await sharp(screenshotBuffer).metadata();
  const finalDesignWidth = finalDesignMeta.width ?? 0;
  const finalDesignHeight = finalDesignMeta.height ?? 0;
  const finalScreenshotWidth = finalScreenshotMeta.width ?? 0;
  const finalScreenshotHeight = finalScreenshotMeta.height ?? 0;

  // Resize design to match screenshot if still different (e.g., height mismatch after crop)
  let finalDesignBuffer: Buffer = designBuffer;
  let paddingMask: PaddingMask | null = null;
  if (finalDesignWidth !== finalScreenshotWidth || finalDesignHeight !== finalScreenshotHeight) {
    const scale = Math.min(
      finalScreenshotWidth / finalDesignWidth,
      finalScreenshotHeight / finalDesignHeight,
    );
    const contentWidth = Math.round(finalDesignWidth * scale);
    const contentHeight = Math.round(finalDesignHeight * scale);
    paddingMask = {
      left: Math.floor((finalScreenshotWidth - contentWidth) / 2),
      top: 0,
      width: contentWidth,
      height: contentHeight,
    };
    finalDesignBuffer = await sharp(designBuffer)
      .resize(finalScreenshotWidth, finalScreenshotHeight, {
        fit: "contain",
        position: "top",
        // contain で作られる余白だけを後段で無視できるよう透明にする。
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .ensureAlpha()
      .toBuffer();
  }

  // Extract raw pixel data
  const designRaw = await sharp(finalDesignBuffer).ensureAlpha().raw().toBuffer();
  const screenshotRaw = await sharp(screenshotBuffer).ensureAlpha().raw().toBuffer();

  const width = finalScreenshotWidth;
  const height = finalScreenshotHeight;
  const screenshotPixels = Uint8ClampedArray.from(screenshotRaw);
  const pixelmatchDesignPixels = Uint8ClampedArray.from(designRaw);
  const reportDesignPixels = paddingMask
    ? Uint8ClampedArray.from(designRaw)
    : pixelmatchDesignPixels;

  if (paddingMask) {
    // contain の余白は比較対象ではないため、その領域だけをスクリーンショット側に合わせて差分から除外する。
    maskTransparentPaddingPixels(
      pixelmatchDesignPixels,
      screenshotPixels,
      width,
      height,
      paddingMask,
    );
    preserveLegacyWhitePaddingForReport(reportDesignPixels, width, height, paddingMask);
  }

  // ignoreRegions 前処理: matchRate 算出の分母から引く mask ピクセル数を計算し、
  // 同じ範囲を design / screenshot 両方の入力ピクセルで同一色 (0,0,0,0) に
  // 揃えておく。こうすると pixelmatch がその範囲を「一致」として扱い、
  // 戻り値 diffPixelCount にも diff 可視化マークにも mask 範囲が含まれなくなる。
  const maskedPixelCount = zeroIgnoreRegions(
    pixelmatchDesignPixels,
    screenshotPixels,
    width,
    height,
    ignoreRegions,
  );
  // paddingMask がある (= design / screenshot 寸法不一致で contain resize した) 場合、
  // reportDesignPixels は pixelmatchDesignPixels と別実体のため、buildDiffReport
  // で意図的差分が再出現する。同じ mask を当てて足並みを揃える。
  // 戻り値のカウントはここでは使わない (元 zeroIgnoreRegions で既に集計済)。
  if (reportDesignPixels !== pixelmatchDesignPixels) {
    zeroIgnoreRegions(reportDesignPixels, screenshotPixels, width, height, ignoreRegions);
  }

  // Run pixelmatch
  const diffPixelData = new Uint8ClampedArray(width * height * 4);
  const diffPixelCount = pixelmatch(
    pixelmatchDesignPixels,
    screenshotPixels,
    diffPixelData,
    width,
    height,
    {
      threshold,
    },
  );

  const totalPixelCount = width * height - maskedPixelCount;
  const matchRate =
    totalPixelCount === 0
      ? 100
      : Math.round(((totalPixelCount - diffPixelCount) / totalPixelCount) * 100 * 100) / 100;

  // Cluster diff regions
  // - "grid": grid-based clustering (recommended for full-page screenshots)
  // - "flood": legacy 8-connectivity flood fill
  // - "auto" (default): grid for totalPixelCount ≥ AUTO_GRID_PIXEL_THRESHOLD,
  //   flood otherwise (preserves prior behaviour for component-level tests).
  // Fallback: in "auto" or "grid" mode, when the grid yields 0 regions but
  //   real diff pixels exist (e.g. thin 1-4px lines/text strokes diluted
  //   below cellDensityThreshold), fall through to flood-fill so downstream
  //   region-to-node matching and reporting still has something to attach to.
  const clustered = clusterDiffRegions({
    clusterMode,
    totalPixelCount,
    diffPixelCount,
    diffPixelData,
    width,
    height,
    gridOptions,
  });
  let { diffRegions } = clustered;
  const { clusterTelemetry } = clustered;

  // Match diff regions to Figma nodes if available
  if (figmaRootNode) {
    diffRegions = matchDiffRegionsToNodes(diffRegions, figmaRootNode);
    clusterTelemetry.regionCount = diffRegions.length;
  }

  // Generate diff image visualization
  const diffImageBase64 = await generateDiffImage(diffPixelData, width, height);
  const diffReport = buildDiffReport({
    designPixels: reportDesignPixels,
    screenshotPixels,
    width,
    height,
    figmaRootNode,
  });

  const suggestion = generateMatchSuggestion(matchRate);

  return {
    comparisonId: comparisonId ?? `cmp-${Date.now()}`,
    matchRate,
    diffPixelCount,
    totalPixelCount,
    diffRegions,
    suggestion,
    clusterTelemetry,
    diffReport,
    diffImageBase64,
  };
}

/**
 * Crop image buffer using sharp
 */
async function cropImageBuffer(buffer: Buffer, cropRegion: CropRegion): Promise<Buffer> {
  const metadata = await sharp(buffer).metadata();
  const imageWidth = metadata.width ?? 0;
  const imageHeight = metadata.height ?? 0;

  if (imageWidth <= 0 || imageHeight <= 0) {
    return buffer;
  }

  if (
    !Number.isFinite(cropRegion.x) ||
    !Number.isFinite(cropRegion.y) ||
    !Number.isFinite(cropRegion.width) ||
    !Number.isFinite(cropRegion.height) ||
    cropRegion.width <= 0 ||
    cropRegion.height <= 0
  ) {
    console.warn("Crop region is invalid; returning original image buffer.");
    return buffer;
  }

  const requestedLeft = Math.floor(cropRegion.x);
  const requestedTop = Math.floor(cropRegion.y);
  const requestedRight = Math.floor(cropRegion.x + cropRegion.width);
  const requestedBottom = Math.floor(cropRegion.y + cropRegion.height);

  const left = Math.max(0, requestedLeft);
  const top = Math.max(0, requestedTop);
  const right = Math.min(imageWidth, requestedRight);
  const bottom = Math.min(imageHeight, requestedBottom);

  if (left >= right || top >= bottom) {
    console.warn("Crop region is outside image bounds; returning original image buffer.");
    return buffer;
  }

  const width = right - left;
  const height = bottom - top;

  return sharp(buffer)
    .extract({
      left,
      top,
      width,
      height,
    })
    .toBuffer();
}

// ignoreRegions 前処理。各矩形を画像境界にクリップし、矩形内の
// design / screenshot ピクセルを同一色 (0,0,0,0) で上書きする。
// これで後段の pixelmatch は mask 範囲を「一致」として扱い、
// 戻り値の diffPixelCount にも diff 可視化マークにも mask 範囲が
// 含まれなくなる。OR 結合 (重なるピクセルは 1 度のみカウント)。
// 戻り値は mask が覆ったユニークピクセル数 — matchRate 分母から引く。
function zeroIgnoreRegions(
  designPixels: Uint8ClampedArray,
  screenshotPixels: Uint8ClampedArray,
  width: number,
  height: number,
  ignoreRegions: readonly IgnoreRegion[] | undefined,
): number {
  if (!ignoreRegions || ignoreRegions.length === 0) return 0;

  // 矩形を反復しながら、未処理ピクセル (mask[i]===0) のみ上書き + カウント。
  // 計算量は O(画像面積) ではなく O(Σ mask 矩形面積) に下がる。
  // 矩形重複でも mask bitmap で一意化されるので二重カウントしない。
  const total = width * height;
  const mask = new Uint8Array(total);
  let maskedCount = 0;
  for (const region of ignoreRegions) {
    const left = Math.max(0, Math.floor(region.x));
    const top = Math.max(0, Math.floor(region.y));
    const right = Math.min(width, Math.floor(region.x + region.width));
    const bottom = Math.min(height, Math.floor(region.y + region.height));
    if (right <= left || bottom <= top) continue;
    for (let y = top; y < bottom; y += 1) {
      const rowBase = y * width;
      for (let x = left; x < right; x += 1) {
        const i = rowBase + x;
        if (mask[i] === 0) {
          mask[i] = 1;
          maskedCount += 1;
          const offset = i * 4;
          designPixels[offset] = 0;
          designPixels[offset + 1] = 0;
          designPixels[offset + 2] = 0;
          designPixels[offset + 3] = 0;
          screenshotPixels[offset] = 0;
          screenshotPixels[offset + 1] = 0;
          screenshotPixels[offset + 2] = 0;
          screenshotPixels[offset + 3] = 0;
        }
      }
    }
  }
  return maskedCount;
}

function maskTransparentPaddingPixels(
  designPixels: Uint8ClampedArray,
  screenshotPixels: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  content: PaddingMask,
): void {
  const contentRight = content.left + content.width;
  const contentBottom = content.top + content.height;

  for (let y = 0; y < imageHeight; y++) {
    for (let x = 0; x < imageWidth; x++) {
      if (x < content.left || x >= contentRight || y < content.top || y >= contentBottom) {
        const i = (y * imageWidth + x) * 4;
        if (designPixels[i + 3] === 0) {
          designPixels[i] = screenshotPixels[i];
          designPixels[i + 1] = screenshotPixels[i + 1];
          designPixels[i + 2] = screenshotPixels[i + 2];
          designPixels[i + 3] = screenshotPixels[i + 3];
        }
      }
    }
  }
}

function preserveLegacyWhitePaddingForReport(
  designPixels: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  content: PaddingMask,
): void {
  const contentRight = content.left + content.width;
  const contentBottom = content.top + content.height;

  for (let y = 0; y < imageHeight; y++) {
    for (let x = 0; x < imageWidth; x++) {
      if (x < content.left || x >= contentRight || y < content.top || y >= contentBottom) {
        const i = (y * imageWidth + x) * 4;
        if (designPixels[i + 3] === 0) {
          designPixels[i] = 255;
          designPixels[i + 1] = 255;
          designPixels[i + 2] = 255;
          designPixels[i + 3] = 255;
        }
      }
    }
  }
}

/**
 * Generate diff visualization image as base64 PNG
 * Highlights diff regions in red
 */
async function generateDiffImage(
  diffPixelData: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<string> {
  // Create visualization: highlight diff pixels in red
  const visualBuffer = Buffer.alloc(width * height * 4);

  for (let i = 0; i < diffPixelData.length; i += 4) {
    if (diffPixelData[i] > 128) {
      visualBuffer[i] = 255;
      visualBuffer[i + 1] = 0;
      visualBuffer[i + 2] = 0;
      visualBuffer[i + 3] = 200;
    } else {
      visualBuffer[i] = 0;
      visualBuffer[i + 1] = 0;
      visualBuffer[i + 2] = 0;
      visualBuffer[i + 3] = 0;
    }
  }

  const pngBuffer = await sharp(visualBuffer, {
    raw: {
      width,
      height,
      channels: 4,
    },
  })
    .png()
    .toBuffer();

  return pngBuffer.toString("base64");
}

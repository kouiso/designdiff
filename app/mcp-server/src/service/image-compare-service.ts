/**
 * Image Comparison Service for MCP Server
 * Uses sharp for image processing, pixelmatch for diff detection
 * Node.js native (no Canvas API)
 */

import pixelmatch from "pixelmatch";
import sharp, { type Sharp } from "sharp";

import {
  PERCEPTIBLE_DIFF_CONTRADICTION_RATIO,
  clusterDiffPixels,
  clusterDiffPixelsGridDetailed,
  generateMatchSuggestion,
  matchDiffRegionsToNodes,
  type CompareDesignResult,
  type ClusterCollapse,
  type ClusterTelemetry,
  type CropRegion,
  type FigmaNode,
  type GridClusterOptions,
  type GridSummary,
  type IgnoreRegion,
} from "@figdiff/shared";

import { buildDiffReport } from "./diff-report-builder.js";

// 巨大画像のデコードでプロセスを OOM させないための上限。
const MAX_INPUT_PIXELS = 40_000_000;

// 比較パイプラインが扱う作業解像度の上限。これを超える入力は
// アスペクト比を保ったまま縮小し、design / screenshot 双方を
// 同じ比率で揃えてから pixelmatch にかける。
const MAX_COMPARE_PIXELS = 24_000_000;

type SharpBufferInput = Parameters<typeof sharp>[0];
type SharpOptions = NonNullable<Parameters<typeof sharp>[1]>;
interface SharpCreateOptions extends SharpOptions {
  create: NonNullable<SharpOptions["create"]>;
}
type SharpInput = SharpBufferInput | SharpCreateOptions;

// 全 sharp() 呼び出しで OOM ガードを必ず有効にする。
function createSharp(input?: SharpInput, options?: SharpOptions): Sharp {
  const guardedOptions = { ...options, limitInputPixels: MAX_INPUT_PIXELS };
  if (input === undefined) {
    return sharp(guardedOptions);
  }
  if (typeof input === "object" && "create" in input) {
    return sharp({ ...input, limitInputPixels: MAX_INPUT_PIXELS });
  }
  return sharp(input, guardedOptions);
}

type ClusterMode = "auto" | "grid" | "flood";

interface CompareImagesOptions {
  designBase64: string;
  screenshotBase64: string;
  threshold?: number;
  cropRegion?: CropRegion;
  clusterMode?: ClusterMode;
  gridOptions?: GridClusterOptions;
  // whole-frame fallback の regionScore を元の Figma node に紐付けるための node id。
  figmaNodeId?: string;
  // 既知の意図的差分マスク。各矩形内の差分ピクセルは matchRate / clustering から除外。
  // 矩形は cropRegion 適用後の座標系 (= screenshot ピクセル座標) で指定する。
  ignoreRegions?: IgnoreRegion[];
  // 背景の塗りが無いノードを、どの色の上に置いて評価するか (#RRGGBB)。既定は白。
  designBackground?: string;
}

// Above this total pixel count, "auto" picks grid clustering. Full-page PC
// screenshots (1512×900+ ≈ 1.36M) clear the bar; SP-only or small component
// crops stay on flood-fill, where the legacy behaviour works well.
const AUTO_GRID_PIXEL_THRESHOLD = 1_000_000;
const GRID_SUMMARY_TARGET_CELL_SIZE = 320;
const GRID_SUMMARY_MAX_ROWS = 24;
const GRID_SUMMARY_MAX_COLS = 12;
const DEFAULT_GRID_BUDGET_OPTIONS = {
  maxWallMs: 5000,
  maxRegions: 100,
  maxHotCellRatio: 0.5,
  fallbackToFlood: true,
} satisfies GridClusterOptions;
const FLOOD_FALLBACK_MAX_PIXELS = 1_800_000;
const QUICK_TILE_SIZE = 192;
const QUICK_TILE_DIFF_THRESHOLD = 16;
const QUICK_TILE_MAX_REGIONS = 60;
const QUICK_TILE_BUDGET_MS = 1500;

const PUBLIC_EXPORT_REDACTION_COLOR = { r: 0, g: 0, b: 0, alpha: 1 };

// 背景の塗りが無いノードを置く既定の下地。実装側の画面が白地で描かれることが多い。
const DEFAULT_DESIGN_BACKGROUND = "#FFFFFF";

/** #RRGGBB / #RGB を RGB 値へ。解釈できない指定は白として扱う。 */
export function parseBackgroundColor(value: string): { r: number; g: number; b: number } {
  const hex = value.trim().replace(/^#/, "");
  const expanded =
    hex.length === 3
      ? hex
          .split("")
          .map((char) => char + char)
          .join("")
      : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) {
    return { r: 255, g: 255, b: 255 };
  }
  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

export function hasTransparentPixel(pixels: Uint8ClampedArray): boolean {
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] !== 255) {
      return true;
    }
  }
  return false;
}

/**
 * 透明・半透明の画素を background の上に置いて不透明にする。
 *
 * pixelmatch は半透明を白へ混ぜて評価するので一致率は妥当に出るが、
 * 構造・色・輪郭を測る側は生の RGB を読むため、透明が黒として入る。
 * 背景の塗りが無い Figma ノードを白地の実装と比べると、そこだけで
 * 「一致率は高いのに構造一致は0%」という食い違いが起きる。
 */
export function flattenTransparentPixels(
  pixels: Uint8ClampedArray,
  background: { r: number; g: number; b: number },
): void {
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3];
    if (alpha === 255) {
      continue;
    }
    const ratio = alpha / 255;
    pixels[index] = Math.round(pixels[index] * ratio + background.r * (1 - ratio));
    pixels[index + 1] = Math.round(pixels[index + 1] * ratio + background.g * (1 - ratio));
    pixels[index + 2] = Math.round(pixels[index + 2] * ratio + background.b * (1 - ratio));
    pixels[index + 3] = 255;
  }
}

export async function redactImageBase64ForPublicExport(
  imageBase64: string,
  ignoreRegions: readonly IgnoreRegion[] | undefined,
): Promise<string> {
  if (!ignoreRegions || ignoreRegions.length === 0) {
    return imageBase64;
  }

  const imageBuffer = Buffer.from(imageBase64, "base64");
  const metadata = await createSharp(imageBuffer).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width === 0 || height === 0) {
    throw new Error("Invalid image dimensions");
  }

  const overlays = ignoreRegions
    .map((region) => clipIgnoreRegion(region, width, height))
    .filter((region): region is NonNullable<typeof region> => region !== null)
    .map((region) => ({
      input: {
        create: {
          width: region.width,
          height: region.height,
          channels: 4 as const,
          background: PUBLIC_EXPORT_REDACTION_COLOR,
        },
      },
      left: region.left,
      top: region.top,
    }));

  if (overlays.length === 0) {
    return imageBase64;
  }

  // public export では顧客デザイン断片を残さないため、不透明な単色で上書きする。
  const redactedBuffer = await createSharp(imageBuffer)
    .ensureAlpha()
    .composite(overlays)
    .png()
    .toBuffer();
  return redactedBuffer.toString("base64");
}

function clipIgnoreRegion(
  region: IgnoreRegion,
  imageWidth: number,
  imageHeight: number,
): { left: number; top: number; width: number; height: number } | null {
  const left = Math.max(0, Math.floor(region.x));
  const top = Math.max(0, Math.floor(region.y));
  const right = Math.min(imageWidth, Math.floor(region.x + region.width));
  const bottom = Math.min(imageHeight, Math.floor(region.y + region.height));
  if (right <= left || bottom <= top) {
    return null;
  }
  return { left, top, width: right - left, height: bottom - top };
}

interface PaddingMask {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface IgnoreMaskResult {
  maskedPixelCount: number;
  // 比較の対象外に置いた画素。1 = 対象外。
  mask?: Uint8Array;
}

interface GridCellGeometry {
  row: number;
  col: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface ClusterDiffResult {
  diffRegions: CompareDesignResult["diffRegions"];
  clusterTelemetry: ClusterTelemetry;
  clusterCollapse?: ClusterCollapse;
}

// 分割を諦めたときに、次に何を疑えばよいかを毎回同じ順で示す。
// ここが空だと「60箇所直せ」という読み方に戻ってしまう。
// 分割を諦めた理由のうち、「差分が全面に広がっている」と言い切れるもの。
// 時間切れ (wall-budget-exceeded) は処理が重かっただけで、広がりの証拠にならない。
function isWidespreadDiffReason(
  reason: NonNullable<ClusterTelemetry["fallbackReason"]>,
): reason is "hot-cell-ratio-exceeded" | "region-count-exceeded" {
  return reason === "hot-cell-ratio-exceeded" || reason === "region-count-exceeded";
}

const CLUSTER_COLLAPSE_CHECKS = [
  "撮影条件が設計と揃っているか（撮影幅・倍率・スクロール位置）",
  "比較元のFigmaフレームが、撮影した画面と同じものか",
  "実装がまだ着手前の状態になっていないか",
];

interface QuickTileCandidate {
  left: number;
  top: number;
  width: number;
  height: number;
  diffPixelCount: number;
}

function isScreenshotOnlyIgnoreRegion(region: IgnoreRegion): boolean {
  return region.label?.startsWith("system:") ?? false;
}

const isVisibleDiffPixelAtIndex = (diffPixelData: Uint8ClampedArray, idx: number): boolean => {
  const red = diffPixelData[idx];
  const green = diffPixelData[idx + 1];
  const blue = diffPixelData[idx + 2];
  const alpha = diffPixelData[idx + 3];

  return (
    !(alpha === 0 && red === 0 && green === 0 && blue === 0) && (red !== green || green !== blue)
  );
};

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

  const shouldSkipFloodFallback =
    useGrid &&
    totalPixelCount > FLOOD_FALLBACK_MAX_PIXELS &&
    (fallbackReason === "wall-budget-exceeded" ||
      fallbackReason === "hot-cell-ratio-exceeded" ||
      fallbackReason === "region-count-exceeded");

  if (
    useGrid &&
    gridOptions.fallbackToFlood !== false &&
    diffRegions.length === 0 &&
    diffPixelCount > 0 &&
    !shouldSkipFloodFallback
  ) {
    usedMode = "flood";
    fallbackReason = fallbackReason ?? "grid-empty-with-diff";
    diffRegions = clusterDiffPixels(diffPixelData, width, height);
  }
  // 差分が広すぎて分割できなかった場合。以前はここで作った等間隔タイルを
  // そのまま差分領域として返していたが、タイルは位置の手がかりを持たない。
  // 「直す場所がタイルの数だけある」と読めてしまうので、領域としては返さず、
  // 分割できなかったという事実として返す。
  let clusterCollapse: ClusterCollapse | undefined;
  if (useGrid && diffRegions.length === 0 && diffPixelCount > 0 && shouldSkipFloodFallback) {
    const coarseTiles = clusterDiffPixelsQuickTiles(diffPixelData, width, height);
    fallbackReason = fallbackReason ?? "grid-empty-with-diff";
    if (isWidespreadDiffReason(fallbackReason)) {
      clusterCollapse = {
        collapsed: true,
        reason: fallbackReason,
        coarseTileCount: coarseTiles.length,
        message:
          "差分が画面全体に広がっているため、直す場所を領域に分けられませんでした。個別のCSS修正へ進む前に、比較の前提を先に確認してください。",
        checks: CLUSTER_COLLAPSE_CHECKS,
      };
    } else {
      // 時間切れは「差分が全面に広がっている」証拠にならない。局所的な差分でも
      // 大きい画像なら起きる。せっかく見つけた大まかな位置を捨てずに返す。
      diffRegions = coarseTiles;
    }
  }

  return {
    diffRegions,
    clusterCollapse,
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

function clusterDiffPixelsQuickTiles(
  diffPixelData: Uint8ClampedArray,
  width: number,
  height: number,
): CompareDesignResult["diffRegions"] {
  const cols = Math.ceil(width / QUICK_TILE_SIZE);
  const rows = Math.ceil(height / QUICK_TILE_SIZE);
  const startedAt = performance.now();
  const tiles: QuickTileCandidate[] = [];
  for (let row = 0; row < rows; row++) {
    const top = row * QUICK_TILE_SIZE;
    const bottom = Math.min(height, top + QUICK_TILE_SIZE);
    for (let col = 0; col < cols; col++) {
      const left = col * QUICK_TILE_SIZE;
      const right = Math.min(width, left + QUICK_TILE_SIZE);
      let count = 0;
      for (let y = top; y < bottom; y++) {
        const rowStartIndex = (y * width + left) * 4;
        const rowEndIndex = (y * width + right) * 4;
        for (let idx = rowStartIndex; idx < rowEndIndex; idx += 4) {
          if (isVisibleDiffPixelAtIndex(diffPixelData, idx)) {
            count++;
          }
        }
      }
      if (count >= QUICK_TILE_DIFF_THRESHOLD) {
        tiles.push({
          left,
          top,
          width: right - left,
          height: bottom - top,
          diffPixelCount: count,
        });
      }
      if (performance.now() - startedAt >= QUICK_TILE_BUDGET_MS) {
        break;
      }
    }
    if (performance.now() - startedAt >= QUICK_TILE_BUDGET_MS) {
      break;
    }
  }

  const topTiles = tiles
    .sort((a, b) => b.diffPixelCount - a.diffPixelCount || a.top - b.top || a.left - b.left)
    .slice(0, QUICK_TILE_MAX_REGIONS)
    .sort((a, b) => a.top - b.top || a.left - b.left);

  return topTiles.map((tile, index) => ({
    id: index,
    bounds: {
      x: tile.left,
      y: tile.top,
      width: tile.width,
      height: tile.height,
    },
    diffPixelCount: tile.diffPixelCount,
    nearbyNodeIds: [],
    nearbyNodeNames: [],
  }));
}

// #252: 実装差によるページ全体のズレで、本来一致する箇所が
// 差分化されるのを避けるためアンカーを合わせる。
function rowLuminanceProfile(
  pixels: Uint8Array | Buffer,
  width: number,
  height: number,
): Float64Array {
  const profile = new Float64Array(height);
  if (pixels.length < width * height * 4) {
    return profile;
  }
  for (let y = 0; y < height; y++) {
    let sum = 0;
    let opaqueCount = 0;
    const rowStart = y * width * 4;
    for (let x = 0; x < width; x++) {
      const i = rowStart + x * 4;
      if (pixels[i + 3] === 0) continue;
      sum += 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
      opaqueCount++;
    }
    profile[y] = opaqueCount > 0 ? sum / opaqueCount : 0;
  }
  return profile;
}

export function columnLuminanceProfile(
  pixels: Uint8Array | Buffer,
  width: number,
  height: number,
  rowStart = 0,
  rowEnd = height,
): Float64Array {
  const profile = new Float64Array(width);
  if (pixels.length < width * height * 4) {
    return profile;
  }
  const clippedRowStart = Math.max(0, Math.min(height, Math.floor(rowStart)));
  const clippedRowEnd = Math.max(clippedRowStart, Math.min(height, Math.floor(rowEnd)));
  for (let x = 0; x < width; x++) {
    let sum = 0;
    let opaqueCount = 0;
    for (let y = clippedRowStart; y < clippedRowEnd; y++) {
      const i = (y * width + x) * 4;
      if (pixels[i + 3] === 0) continue;
      sum += 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
      opaqueCount++;
    }
    profile[x] = opaqueCount > 0 ? sum / opaqueCount : 0;
  }
  return profile;
}

function windowedPearsonCorrelation(
  design: Float64Array,
  reference: Float64Array,
  offset: number,
): number {
  const len = design.length;
  let sumA = 0;
  let sumB = 0;
  let sumAB = 0;
  let sumA2 = 0;
  let sumB2 = 0;
  for (let i = 0; i < len; i++) {
    const a = design[i];
    const b = reference[offset + i];
    sumA += a;
    sumB += b;
    sumAB += a * b;
    sumA2 += a * a;
    sumB2 += b * b;
  }
  const n = len;
  const numerator = n * sumAB - sumA * sumB;
  const denomA = n * sumA2 - sumA * sumA;
  const denomB = n * sumB2 - sumB * sumB;
  const denominator = Math.sqrt(Math.max(denomA, 0) * Math.max(denomB, 0));
  return denominator === 0 ? 0 : numerator / denominator;
}

// 相関が弱すぎる場合は誤検出を避けるため従来位置へフォールバックする。
const MIN_CONFIDENT_ANCHOR_CORRELATION = 0.3;
const ANCHOR_OFFSET_SEARCH_BUDGET = 2000;
const PADDING_LUMINANCE_STDDEV_THRESHOLD = 8;
const PADDING_EDGE_RGB_DISTANCE_THRESHOLD = 15;
const PADDING_EDGE_SAMPLE_THICKNESS = 3;
const TOP_REFINED_ANCHOR_CANDIDATE_COUNT = 3;
export function detectBestAnchorOffset(
  designProfile: Float64Array,
  referenceProfile: Float64Array,
  maxOffset: number,
  fallbackOffset = 0,
): number {
  const safeMaxOffset = Math.min(maxOffset, referenceProfile.length - designProfile.length);
  const clampedFallback = Math.max(0, Math.min(fallbackOffset, Math.max(safeMaxOffset, 0)));
  if (
    safeMaxOffset <= 0 ||
    designProfile.length === 0 ||
    referenceProfile.length < designProfile.length
  ) {
    return clampedFallback;
  }
  const findBestOffsetInRange = (start: number, end: number, step: number) => {
    let bestOffset = clampedFallback;
    let bestScore = -Infinity;
    for (let offset = start; offset <= end; offset += step) {
      const score = windowedPearsonCorrelation(designProfile, referenceProfile, offset);
      if (score > bestScore) {
        bestScore = score;
        bestOffset = offset;
      }
    }
    return { bestOffset, bestScore };
  };
  const findTopOffsetsInRange = (start: number, end: number, step: number, count: number) => {
    const candidates: { bestOffset: number; bestScore: number }[] = [];
    for (let offset = start; offset <= end; offset += step) {
      const score = windowedPearsonCorrelation(designProfile, referenceProfile, offset);
      candidates.push({ bestOffset: offset, bestScore: score });
      candidates.sort((a, b) => b.bestScore - a.bestScore);
      if (candidates.length > count) candidates.pop();
    }
    return candidates;
  };

  const stride =
    safeMaxOffset > ANCHOR_OFFSET_SEARCH_BUDGET
      ? Math.ceil(safeMaxOffset / ANCHOR_OFFSET_SEARCH_BUDGET)
      : 1;
  if (stride === 1) {
    const { bestOffset, bestScore } = findBestOffsetInRange(0, safeMaxOffset, 1);
    return bestScore >= MIN_CONFIDENT_ANCHOR_CORRELATION ? bestOffset : clampedFallback;
  }

  const stridedCandidates = findTopOffsetsInRange(
    0,
    safeMaxOffset,
    stride,
    TOP_REFINED_ANCHOR_CANDIDATE_COUNT,
  );
  const refinementRadius = stride;
  let refinedBest = { bestOffset: clampedFallback, bestScore: -Infinity };
  for (const candidate of stridedCandidates) {
    // 病的な反復パターンでは完全ではないが、単一候補だけの精密化より真のピークを落としにくくするため。
    const refinementStart = Math.max(0, candidate.bestOffset - refinementRadius);
    const refinementEnd = Math.min(safeMaxOffset, candidate.bestOffset + refinementRadius);
    const refinedCandidate = findBestOffsetInRange(refinementStart, refinementEnd, 1);
    if (refinedCandidate.bestScore > refinedBest.bestScore) {
      refinedBest = refinedCandidate;
    }
  }
  return refinedBest.bestScore >= MIN_CONFIDENT_ANCHOR_CORRELATION
    ? refinedBest.bestOffset
    : clampedFallback;
}

export function zeroIgnoredPixelsForAnchor(
  rawPixels: Uint8Array | Buffer,
  width: number,
  height: number,
  ignoreRegions: readonly IgnoreRegion[] | undefined,
): Uint8Array | Buffer {
  if (!ignoreRegions || ignoreRegions.length === 0) {
    return rawPixels;
  }
  if (rawPixels.length < width * height * 4) {
    return rawPixels;
  }
  const anchorPixels = Buffer.from(rawPixels);
  for (const region of ignoreRegions) {
    const clipped = clipIgnoreRegion(region, width, height);
    if (clipped === null) continue;
    for (let y = clipped.top; y < clipped.top + clipped.height; y += 1) {
      const rowStart = y * width * 4;
      for (let x = clipped.left; x < clipped.left + clipped.width; x += 1) {
        anchorPixels[rowStart + x * 4 + 3] = 0;
      }
    }
  }
  return anchorPixels;
}

interface RgbMean {
  r: number;
  g: number;
  b: number;
}

function meanRgbForRegion(
  pixels: Uint8Array | Buffer,
  width: number,
  height: number,
  region: { left: number; top: number; width: number; height: number },
): { mean: RgbMean | null; luminanceStddev: number } {
  const left = Math.max(0, region.left);
  const top = Math.max(0, region.top);
  const right = Math.min(width, region.left + region.width);
  const bottom = Math.min(height, region.top + region.height);
  if (pixels.length < width * height * 4 || right <= left || bottom <= top) {
    return { mean: null, luminanceStddev: 0 };
  }

  let luminanceSum = 0;
  let luminanceSumSq = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let y = top; y < bottom; y += 1) {
    const rowStart = y * width * 4;
    for (let x = left; x < right; x += 1) {
      const i = rowStart + x * 4;
      if (pixels[i + 3] === 0) continue;
      const luminance = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
      luminanceSum += luminance;
      luminanceSumSq += luminance * luminance;
      r += pixels[i];
      g += pixels[i + 1];
      b += pixels[i + 2];
      count += 1;
    }
  }
  if (count === 0) return { mean: null, luminanceStddev: 0 };
  const luminanceMean = luminanceSum / count;
  const variance = Math.max(0, luminanceSumSq / count - luminanceMean * luminanceMean);
  return {
    mean: { r: r / count, g: g / count, b: b / count },
    luminanceStddev: Math.sqrt(variance),
  };
}

function rgbDistance(a: RgbMean, b: RgbMean): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

type PaddingGapEdge = "top" | "left" | "right" | "bottom";

function contentEdgeRegion(edge: PaddingGapEdge, width: number, height: number) {
  const thickness = Math.max(1, Math.min(PADDING_EDGE_SAMPLE_THICKNESS, width, height));
  switch (edge) {
    case "top":
      return { left: 0, top: 0, width, height: Math.min(thickness, height) };
    case "left":
      return { left: 0, top: 0, width: Math.min(thickness, width), height };
    case "right":
      return {
        left: Math.max(0, width - thickness),
        top: 0,
        width: Math.min(thickness, width),
        height,
      };
    case "bottom":
      return {
        left: 0,
        top: Math.max(0, height - thickness),
        width,
        height: Math.min(thickness, height),
      };
  }
}

export function isLikelyLetterboxPadding(
  pixels: Uint8Array | Buffer,
  width: number,
  height: number,
  region: { left: number; top: number; width: number; height: number },
  contentPixels: Uint8Array | Buffer,
  contentWidth: number,
  contentHeight: number,
  contentEdge: PaddingGapEdge,
): boolean {
  if (pixels.length < width * height * 4) {
    return true;
  }
  const gapStats = meanRgbForRegion(pixels, width, height, region);
  if (gapStats.mean === null) return true;
  if (gapStats.luminanceStddev > PADDING_LUMINANCE_STDDEV_THRESHOLD) return false;

  const edgeStats = meanRgbForRegion(
    contentPixels,
    contentWidth,
    contentHeight,
    contentEdgeRegion(contentEdge, contentWidth, contentHeight),
  );
  if (edgeStats.mean === null) return true;
  return rgbDistance(gapStats.mean, edgeStats.mean) <= PADDING_EDGE_RGB_DISTANCE_THRESHOLD;
}

function shouldUsePaddingMask(
  pixels: Uint8Array | Buffer,
  width: number,
  height: number,
  left: number,
  top: number,
  contentPixels: Uint8Array | Buffer,
  contentWidth: number,
  contentHeight: number,
): boolean {
  const rightGapWidth = width - (left + contentWidth);
  const bottomGapHeight = height - (top + contentHeight);
  const gapChecks: {
    edge: PaddingGapEdge;
    region: { left: number; top: number; width: number; height: number };
  }[] = [];
  if (top > 0)
    gapChecks.push({
      edge: "top",
      region: { left: 0, top: 0, width, height: top },
    });
  if (left > 0)
    gapChecks.push({
      edge: "left",
      region: { left: 0, top: 0, width: left, height },
    });
  if (rightGapWidth > 0) {
    gapChecks.push({
      edge: "right",
      region: {
        left: left + contentWidth,
        top: 0,
        width: rightGapWidth,
        height,
      },
    });
  }
  if (bottomGapHeight > 0) {
    gapChecks.push({
      edge: "bottom",
      region: {
        left: 0,
        top: top + contentHeight,
        width,
        height: bottomGapHeight,
      },
    });
  }
  return gapChecks.every(({ edge, region }) =>
    isLikelyLetterboxPadding(
      pixels,
      width,
      height,
      region,
      contentPixels,
      contentWidth,
      contentHeight,
      edge,
    ),
  );
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
    figmaNodeId,
    ignoreRegions,
  } = options;

  // Decode base64 to buffers
  let designBuffer: Buffer = Buffer.from(designBase64, "base64");
  let screenshotBuffer: Buffer = Buffer.from(screenshotBase64, "base64");

  // Get original dimensions
  const designMeta = await createSharp(designBuffer).metadata();
  const screenshotMeta = await createSharp(screenshotBuffer).metadata();

  const designWidth = designMeta.width ?? 0;
  const designHeight = designMeta.height ?? 0;
  let screenshotWidth = screenshotMeta.width ?? 0;
  let screenshotHeight = screenshotMeta.height ?? 0;

  if (designWidth === 0 || designHeight === 0 || screenshotWidth === 0 || screenshotHeight === 0) {
    throw new Error("Invalid image dimensions");
  }

  // normalization レポートとアスペクト比診断は撮影時の実寸を使う。
  // 作業解像度ガードで縮小しても、報告値は native のまま維持する。
  const nativeScreenshotWidth = screenshotWidth;
  const nativeScreenshotHeight = screenshotHeight;

  // 作業ピクセル上限ガード: 大きい側 (スクショは縦長になりやすい) が
  // MAX_COMPARE_PIXELS を超えるとき、両画像を同じ比率で縮小して
  // 比較解像度を有界にする。同率で縮めることで座標系のズレを避ける。
  // design 側は後段で screenshot 幅に再正規化されるため、ここでは
  // 基準となる screenshot だけを物理的に縮小し、寸法を更新する。
  const screenshotPixelCount = screenshotWidth * screenshotHeight;
  if (screenshotPixelCount > MAX_COMPARE_PIXELS) {
    const capScale = Math.sqrt(MAX_COMPARE_PIXELS / screenshotPixelCount);
    const cappedWidth = Math.max(1, Math.round(screenshotWidth * capScale));
    const cappedHeight = Math.max(1, Math.round(screenshotHeight * capScale));
    screenshotBuffer = await createSharp(screenshotBuffer)
      .resize(cappedWidth, cappedHeight)
      .toBuffer();
    screenshotWidth = cappedWidth;
    screenshotHeight = cappedHeight;
  }

  // Resize design to match screenshot WIDTH first (maintaining aspect ratio)
  // This normalizes coordinate spaces before crop
  //
  // crop 前のこの寸法が、後段でノード bbox をスクリーンショット空間へ写すときの
  // 基準になる。crop 後の寸法を使うと、切り落とした分だけ倍率がずれる。
  let normalizedDesignHeight = designHeight;
  if (designWidth !== screenshotWidth) {
    const resizeHeight = Math.round(designHeight * (screenshotWidth / designWidth));
    normalizedDesignHeight = resizeHeight;
    designBuffer = await createSharp(designBuffer)
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
  const finalDesignMeta = await createSharp(designBuffer).metadata();
  const finalScreenshotMeta = await createSharp(screenshotBuffer).metadata();
  const finalDesignWidth = finalDesignMeta.width ?? 0;
  const finalDesignHeight = finalDesignMeta.height ?? 0;
  const finalScreenshotWidth = finalScreenshotMeta.width ?? 0;
  const finalScreenshotHeight = finalScreenshotMeta.height ?? 0;

  // Resize design to match screenshot if still different (e.g., height mismatch after crop)
  let finalDesignBuffer: Buffer = designBuffer;
  let paddingMask: PaddingMask | null = null;
  let wasComposited = false;
  let appliedScale = 1;
  // 合成した場合の貼り付け位置。ノード bbox を同じ空間へ写すときに要る。
  let compositeOffset = { x: 0, y: 0 };
  if (finalDesignWidth !== finalScreenshotWidth || finalDesignHeight !== finalScreenshotHeight) {
    const scale = Math.min(
      finalScreenshotWidth / finalDesignWidth,
      finalScreenshotHeight / finalDesignHeight,
    );
    appliedScale = scale;
    const contentWidth = Math.max(1, Math.round(finalDesignWidth * scale));
    const contentHeight = Math.max(1, Math.round(finalDesignHeight * scale));

    const { data: contentRaw } = await createSharp(designBuffer)
      .resize(contentWidth, contentHeight, { fit: "fill" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { data: screenshotRawForAnchor } = await createSharp(screenshotBuffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const screenshotAnchorPixels = zeroIgnoredPixelsForAnchor(
      screenshotRawForAnchor,
      finalScreenshotWidth,
      finalScreenshotHeight,
      ignoreRegions,
    );
    const maxTop = finalScreenshotHeight - contentHeight;
    const maxLeft = finalScreenshotWidth - contentWidth;
    const top = detectBestAnchorOffset(
      rowLuminanceProfile(contentRaw, contentWidth, contentHeight),
      rowLuminanceProfile(screenshotAnchorPixels, finalScreenshotWidth, finalScreenshotHeight),
      maxTop,
    );
    const left = detectBestAnchorOffset(
      columnLuminanceProfile(contentRaw, contentWidth, contentHeight),
      columnLuminanceProfile(
        screenshotAnchorPixels,
        finalScreenshotWidth,
        finalScreenshotHeight,
        top,
        top + contentHeight,
      ),
      maxLeft,
      Math.floor(maxLeft / 2),
    );

    // 実 UI の新規帯を contain 余白として隠すと、検出すべき差分が消えてしまうため。
    paddingMask = shouldUsePaddingMask(
      screenshotRawForAnchor,
      finalScreenshotWidth,
      finalScreenshotHeight,
      left,
      top,
      contentRaw,
      contentWidth,
      contentHeight,
    )
      ? {
          left,
          top,
          width: contentWidth,
          height: contentHeight,
        }
      : null;
    wasComposited = true;
    compositeOffset = { x: left, y: top };
    finalDesignBuffer = await createSharp({
      create: {
        width: finalScreenshotWidth,
        height: finalScreenshotHeight,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([
        {
          input: contentRaw,
          raw: { width: contentWidth, height: contentHeight, channels: 4 },
          left,
          top,
        },
      ])
      .ensureAlpha()
      .toBuffer();
  }

  // Extract raw pixel data
  const designRaw = await (wasComposited
    ? createSharp(finalDesignBuffer, {
        raw: {
          width: finalScreenshotWidth,
          height: finalScreenshotHeight,
          channels: 4,
        },
      })
    : createSharp(finalDesignBuffer)
  )
    .ensureAlpha()
    .raw()
    .toBuffer();
  const screenshotRaw = await createSharp(screenshotBuffer).ensureAlpha().raw().toBuffer();

  const width = finalScreenshotWidth;
  const height = finalScreenshotHeight;
  const screenshotPixels = Uint8ClampedArray.from(screenshotRaw);
  const pixelmatchDesignPixels = Uint8ClampedArray.from(designRaw);
  let reportDesignPixels = paddingMask ? Uint8ClampedArray.from(designRaw) : pixelmatchDesignPixels;

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
  const ignoreMaskResult = zeroIgnoreRegions(
    pixelmatchDesignPixels,
    screenshotPixels,
    width,
    height,
    ignoreRegions,
  );
  const { maskedPixelCount } = ignoreMaskResult;
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
      diffMask: true,
    },
  );

  const totalPixelCount = width * height - maskedPixelCount;
  const matchRate =
    totalPixelCount === 0
      ? 100
      : Math.round(((totalPixelCount - diffPixelCount) / totalPixelCount) * 100 * 100) / 100;
  // 判定と証拠を先に作る。矛盾で人間レビューへ回すとき、pixelmatch の閾値では
  // 1画素も差分にならないことがある。そのままだと差分画像が真っ黒、領域0件で
  // 「見てくれ」と渡すことになるので、見える差のあった画素を証拠として使う。
  // 判定側だけを不透明化する。pixelmatch の入力は触らないので一致率は変わらない。
  // pixelmatch は半透明を白へ混ぜて見るが、構造・色・輪郭を測る側は生の RGB を
  // 読むため、下地を敷かないと透明が黒として評価に入る。
  const backgroundColor = parseBackgroundColor(
    options.designBackground ?? DEFAULT_DESIGN_BACKGROUND,
  );
  let reportScreenshotPixels = screenshotPixels;
  if (hasTransparentPixel(reportDesignPixels)) {
    if (reportDesignPixels === pixelmatchDesignPixels) {
      reportDesignPixels = Uint8ClampedArray.from(reportDesignPixels);
    }
    flattenTransparentPixels(reportDesignPixels, backgroundColor);
  }
  if (hasTransparentPixel(screenshotPixels)) {
    reportScreenshotPixels = Uint8ClampedArray.from(screenshotPixels);
    flattenTransparentPixels(reportScreenshotPixels, backgroundColor);
  }

  const perceptibleMask = new Uint8Array(width * height);
  const diffReport = buildDiffReport({
    designPixels: reportDesignPixels,
    screenshotPixels: reportScreenshotPixels,
    width,
    height,
    figmaRootNode,
    figmaNodeId,
    // letterbox の余白と、比較の対象外に置いた画素を評価から外す。
    // 渡さないと余白だけで矛盾判定の比率が跳ね上がる。
    paddingMask: paddingMask ?? undefined,
    ignoreMask: ignoreMaskResult.mask,
    perceptibleMask,
  });

  if (
    diffPixelCount === 0 &&
    (diffReport.perceptibleDiffRatio ?? 0) > PERCEPTIBLE_DIFF_CONTRADICTION_RATIO
  ) {
    paintPerceptibleMask(diffPixelData, perceptibleMask);
  }

  const gridSummary = buildGridSummary(
    diffPixelData,
    width,
    height,
    diffPixelCount,
    ignoreMaskResult.mask,
  );

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
  const { clusterTelemetry, clusterCollapse } = clustered;

  // Match diff regions to Figma nodes if available
  if (figmaRootNode) {
    // 変換を渡さないと、ノード側は Figma canvas 座標 (x が数万になることもある)、
    // 差分領域は crop 後のスクリーンショット座標のままで突き合わせることになり、
    // 包含判定が一度も成立せずノード名が全件空で返る。
    // 倍率の基準は crop 前の正規化済み design 寸法。実パイプラインが
    // 「幅合わせ → crop」の順で処理するため、高さも幅合わせ後の値を渡す。
    // 差分領域は撮影側の座標で出るので、切り出し原点も撮影側の寸法で決める。
    // 設計側の寸法で決めると、片方だけ切り出しが成立した回に原点がずれる。
    const appliedCropOrigin = cropRegion
      ? resolveAppliedCropOrigin(cropRegion, screenshotWidth, screenshotHeight)
      : null;
    diffRegions = matchDiffRegionsToNodes(diffRegions, figmaRootNode, {
      fullScreenshotWidth: screenshotWidth,
      fullScreenshotHeight: normalizedDesignHeight,
      cropOrigin: appliedCropOrigin ?? undefined,
      // 切り出しの後にさらに縮めて貼り付けた場合は、その倍率と位置も反映する。
      // 反映しないと、その経路だけ座標がずれて違うノード名が付く。
      contentScale: wasComposited ? appliedScale : undefined,
      contentOffset: wasComposited ? compositeOffset : undefined,
    });
    clusterTelemetry.regionCount = diffRegions.length;
  }

  // Generate diff image visualization
  const diffImageBase64 = await generateDiffImage(diffPixelData, width, height);

  const suggestion = generateMatchSuggestion(matchRate);

  return {
    comparisonId: comparisonId ?? `cmp-${Date.now()}`,
    matchRate,
    diffPixelCount,
    totalPixelCount,
    diffRegions,
    suggestion,
    clusterTelemetry,
    clusterCollapse,
    gridSummary,
    diffReport,
    diffImageBase64,
    normalization: {
      designNativeWidth: designWidth,
      designNativeHeight: designHeight,
      screenshotWidth: nativeScreenshotWidth,
      screenshotHeight: nativeScreenshotHeight,
      cropApplied: Boolean(cropRegion),
      containResized: wasComposited,
      appliedScale,
    },
  };
}

/**
 * cropImageBuffer が実際に切り出す原点を、同じ丸めとクリップで先に求める。
 * 切り出しが成立しない場合は null を返す (画像がそのまま通るため原点は 0)。
 *
 * ノード bbox をスクリーンショット空間へ写すとき、要求値ではなく実際に
 * 適用された原点を引かないと、切り出しが無効だった回だけ座標が丸ごとずれる。
 */
export function resolveAppliedCropOrigin(
  cropRegion: CropRegion,
  imageWidth: number,
  imageHeight: number,
): { x: number; y: number } | null {
  if (imageWidth <= 0 || imageHeight <= 0) {
    return null;
  }

  if (
    !Number.isFinite(cropRegion.x) ||
    !Number.isFinite(cropRegion.y) ||
    !Number.isFinite(cropRegion.width) ||
    !Number.isFinite(cropRegion.height) ||
    cropRegion.width <= 0 ||
    cropRegion.height <= 0
  ) {
    return null;
  }

  const left = Math.max(0, Math.floor(cropRegion.x));
  const top = Math.max(0, Math.floor(cropRegion.y));
  const right = Math.min(imageWidth, Math.floor(cropRegion.x + cropRegion.width));
  const bottom = Math.min(imageHeight, Math.floor(cropRegion.y + cropRegion.height));

  if (left >= right || top >= bottom) {
    return null;
  }

  return { x: left, y: top };
}

/**
 * Crop image buffer using sharp
 */
async function cropImageBuffer(buffer: Buffer, cropRegion: CropRegion): Promise<Buffer> {
  const metadata = await createSharp(buffer).metadata();
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

  return createSharp(buffer)
    .extract({
      left,
      top,
      width,
      height,
    })
    .toBuffer();
}

// ignoreRegions 前処理。各矩形を画像境界にクリップし、通常の user mask は
// design / screenshot ピクセルを同一色 (0,0,0,0) で上書きする。
// system:* mask は screenshot 側だけを design と同じピクセルへ揃える。
// これで後段の pixelmatch は mask 範囲を「一致」として扱いながら、
// device chrome preset で Figma 側の上端/下端を黒塗りしない。
// 戻り値の diffPixelCount にも diff 可視化マークにも mask 範囲が
// 含まれなくなる。OR 結合 (重なるピクセルは 1 度のみカウント)。
// 戻り値は mask が覆ったユニークピクセル数 — matchRate 分母から引く。
function zeroIgnoreRegions(
  designPixels: Uint8ClampedArray,
  screenshotPixels: Uint8ClampedArray,
  width: number,
  height: number,
  ignoreRegions: readonly IgnoreRegion[] | undefined,
): IgnoreMaskResult {
  if (!ignoreRegions || ignoreRegions.length === 0) return { maskedPixelCount: 0 };

  // 矩形を反復しながら、未処理ピクセル (mask[i]===0) のみ上書き + カウント。
  // 計算量は O(画像面積) ではなく O(Σ mask 矩形面積) に下がる。
  // 矩形重複でも mask bitmap で一意化されるので二重カウントしない。
  const total = width * height;
  const mask = new Uint8Array(total);
  let maskedCount = 0;
  for (const region of ignoreRegions) {
    const screenshotOnly = isScreenshotOnlyIgnoreRegion(region);
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
        }
        const offset = i * 4;
        if (screenshotOnly) {
          screenshotPixels[offset] = designPixels[offset];
          screenshotPixels[offset + 1] = designPixels[offset + 1];
          screenshotPixels[offset + 2] = designPixels[offset + 2];
          screenshotPixels[offset + 3] = designPixels[offset + 3];
        } else {
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
  return { maskedPixelCount: maskedCount, mask };
}

function buildGridSummary(
  diffPixelData: Uint8ClampedArray,
  width: number,
  height: number,
  diffPixelCount: number,
  ignoreMask?: Uint8Array,
): GridSummary {
  const { rows, cols } = getGridDimensions(width, height);
  const geometries = buildGridCellGeometries(width, height, rows, cols);

  if (diffPixelCount === 0 && !ignoreMask) {
    return {
      rows,
      cols,
      cells: geometries.map(buildPerfectGridSummaryCell),
    };
  }

  const cells = geometries.map((geometry) =>
    summarizeGridCell(geometry, diffPixelData, width, ignoreMask),
  );
  return { rows, cols, cells };
}

function getGridDimensions(width: number, height: number): { rows: number; cols: number } {
  return {
    rows: Math.min(
      GRID_SUMMARY_MAX_ROWS,
      Math.max(1, Math.ceil(height / GRID_SUMMARY_TARGET_CELL_SIZE)),
    ),
    cols: Math.min(
      GRID_SUMMARY_MAX_COLS,
      Math.max(1, Math.ceil(width / GRID_SUMMARY_TARGET_CELL_SIZE)),
    ),
  };
}

function buildGridCellGeometries(
  width: number,
  height: number,
  rows: number,
  cols: number,
): GridCellGeometry[] {
  const geometries: GridCellGeometry[] = [];
  for (let row = 0; row < rows; row += 1) {
    const top = Math.floor((height * row) / rows);
    const bottom = Math.floor((height * (row + 1)) / rows);
    for (let col = 0; col < cols; col += 1) {
      const left = Math.floor((width * col) / cols);
      const right = Math.floor((width * (col + 1)) / cols);
      geometries.push({ row, col, left, top, right, bottom });
    }
  }
  return geometries;
}

function buildPerfectGridSummaryCell(geometry: GridCellGeometry): GridSummary["cells"][number] {
  return {
    row: geometry.row,
    col: geometry.col,
    x: geometry.left,
    y: geometry.top,
    width: geometry.right - geometry.left,
    height: geometry.bottom - geometry.top,
    diffPixels: 0,
    totalPixels: (geometry.right - geometry.left) * (geometry.bottom - geometry.top),
    matchRate: 100,
  };
}

function summarizeGridCell(
  geometry: GridCellGeometry,
  diffPixelData: Uint8ClampedArray,
  imageWidth: number,
  ignoreMask?: Uint8Array,
): GridSummary["cells"][number] {
  let diffPixels = 0;
  let totalPixels = 0;

  for (let y = geometry.top; y < geometry.bottom; y += 1) {
    const rowBase = y * imageWidth;
    for (let x = geometry.left; x < geometry.right; x += 1) {
      const pixelIndex = rowBase + x;
      if (ignoreMask?.[pixelIndex]) continue;
      totalPixels += 1;
      if (diffPixelData[pixelIndex * 4] > 128) {
        diffPixels += 1;
      }
    }
  }

  return {
    row: geometry.row,
    col: geometry.col,
    x: geometry.left,
    y: geometry.top,
    width: geometry.right - geometry.left,
    height: geometry.bottom - geometry.top,
    diffPixels,
    totalPixels,
    matchRate:
      totalPixels === 0
        ? 100
        : Math.round(((totalPixels - diffPixels) / totalPixels) * 100 * 100) / 100,
  };
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
// pixelmatch の差分可視化と同じ赤で塗る。証拠の出どころが違っても、
// 人が見る色は揃えておく。
function paintPerceptibleMask(diffPixelData: Uint8ClampedArray, mask: Uint8Array): void {
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i] !== 1) continue;
    const offset = i * 4;
    diffPixelData[offset] = 255;
    diffPixelData[offset + 1] = 0;
    diffPixelData[offset + 2] = 0;
    diffPixelData[offset + 3] = 255;
  }
}

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

  const pngBuffer = await createSharp(visualBuffer, {
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

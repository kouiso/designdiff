import type { DiffBoundingBox } from "../type.js";

export interface GlyphEdgeRasterEvidence {
  classification: "glyph-edge-rasterization";
  changedPixelCount: number;
  sharedCorePixelCount: number;
  backgroundHex: string;
  foregroundHex: string;
}

const HALO_PX = 2;
const CHANNEL_TOLERANCE = 1;
const MIN_BACKGROUND_COVERAGE = 0.4;
export const MIN_FOREGROUND_CONTRAST = 64;
const CORE_ALPHA = 0.85;
const EDGE_ALPHA_MIN = 0.02;
const EDGE_ALPHA_MAX = 0.98;
const MAX_BLEND_RESIDUAL = 10;

export const colorAt = (
  pixels: Uint8ClampedArray,
  pixelIndex: number,
): [number, number, number] => {
  const offset = pixelIndex * 4;
  return [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
};

export const colorKey = (color: readonly number[]): string => `${color[0]},${color[1]},${color[2]}`;

export const toHex = (color: readonly number[]): string =>
  `#${color
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;

export const maxChannelDelta = (a: readonly number[], b: readonly number[]): number =>
  Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

const squaredDistance = (a: readonly number[], b: readonly number[]): number =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

const dominantBorderColor = (
  pixels: Uint8ClampedArray,
  width: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
  ignoreMask?: Uint8Array,
): { color: [number, number, number]; coverage: number } | undefined => {
  const counts = new Map<string, { color: [number, number, number]; count: number }>();
  let sampleCount = 0;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      if (x !== left && x !== right - 1 && y !== top && y !== bottom - 1) continue;
      const pixelIndex = y * width + x;
      if (ignoreMask?.[pixelIndex]) continue;
      const color = colorAt(pixels, pixelIndex);
      const key = colorKey(color);
      const current = counts.get(key);
      counts.set(key, { color, count: (current?.count ?? 0) + 1 });
      sampleCount++;
    }
  }
  if (sampleCount === 0) return undefined;
  const dominant = [...counts.values()].sort((a, b) => b.count - a.count)[0];
  return { color: dominant.color, coverage: dominant.count / sampleCount };
};

export const blendAlphaAndResidual = (
  color: readonly number[],
  background: readonly number[],
  foreground: readonly number[],
): { alpha: number; residual: number } => {
  const axis = [
    foreground[0] - background[0],
    foreground[1] - background[1],
    foreground[2] - background[2],
  ];
  const denominator = axis[0] ** 2 + axis[1] ** 2 + axis[2] ** 2;
  const relative = [color[0] - background[0], color[1] - background[1], color[2] - background[2]];
  const alpha =
    denominator === 0
      ? 0
      : (relative[0] * axis[0] + relative[1] * axis[1] + relative[2] * axis[2]) / denominator;
  const projected = [
    background[0] + alpha * axis[0],
    background[1] + alpha * axis[1],
    background[2] + alpha * axis[2],
  ];
  return { alpha, residual: Math.sqrt(squaredDistance(color, projected)) };
};

export interface RasterWindow {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const resolveRasterWindow = (
  width: number,
  height: number,
  bbox: DiffBoundingBox,
): RasterWindow | undefined => {
  const window = {
    left: Math.max(0, Math.floor(bbox.x) - HALO_PX),
    top: Math.max(0, Math.floor(bbox.y) - HALO_PX),
    right: Math.min(width, Math.ceil(bbox.x + bbox.w) + HALO_PX),
    bottom: Math.min(height, Math.ceil(bbox.y + bbox.h) + HALO_PX),
  };
  return window.right - window.left >= 3 && window.bottom - window.top >= 3 ? window : undefined;
};

export const resolveMatchingBackground = (
  designPixels: Uint8ClampedArray,
  screenshotPixels: Uint8ClampedArray,
  width: number,
  window: RasterWindow,
  ignoreMask?: Uint8Array,
): [number, number, number] | undefined => {
  const args = [width, window.left, window.top, window.right, window.bottom, ignoreMask] as const;
  const design = dominantBorderColor(designPixels, ...args);
  const screenshot = dominantBorderColor(screenshotPixels, ...args);
  if (!design || !screenshot) return undefined;
  if (design.coverage < MIN_BACKGROUND_COVERAGE) return undefined;
  if (screenshot.coverage < MIN_BACKGROUND_COVERAGE) return undefined;
  return maxChannelDelta(design.color, screenshot.color) <= CHANNEL_TOLERANCE
    ? design.color
    : undefined;
};

const findSharedForeground = (
  designPixels: Uint8ClampedArray,
  screenshotPixels: Uint8ClampedArray,
  width: number,
  window: RasterWindow,
  background: readonly number[],
  ignoreMask?: Uint8Array,
): [number, number, number] | undefined => {
  let foreground: [number, number, number] | undefined;
  let foregroundDistance = 0;
  for (let y = window.top; y < window.bottom; y++) {
    for (let x = window.left; x < window.right; x++) {
      const pixelIndex = y * width + x;
      if (ignoreMask?.[pixelIndex]) continue;
      const design = colorAt(designPixels, pixelIndex);
      if (maxChannelDelta(design, colorAt(screenshotPixels, pixelIndex)) > CHANNEL_TOLERANCE) {
        continue;
      }
      const distance = Math.sqrt(squaredDistance(design, background));
      if (distance > foregroundDistance) {
        foreground = design;
        foregroundDistance = distance;
      }
    }
  }
  return foregroundDistance >= MIN_FOREGROUND_CONTRAST ? foreground : undefined;
};

const analyzeRasterPixels = (
  designPixels: Uint8ClampedArray,
  screenshotPixels: Uint8ClampedArray,
  width: number,
  window: RasterWindow,
  background: readonly number[],
  foreground: readonly number[],
  ignoreMask?: Uint8Array,
): { sharedCorePixelCount: number; changedPixelCount: number } | undefined => {
  let sharedCorePixelCount = 0;
  let changedPixelCount = 0;
  for (let y = window.top; y < window.bottom; y++) {
    for (let x = window.left; x < window.right; x++) {
      const pixelIndex = y * width + x;
      if (ignoreMask?.[pixelIndex]) continue;
      const design = colorAt(designPixels, pixelIndex);
      const screenshot = colorAt(screenshotPixels, pixelIndex);
      const designBlend = blendAlphaAndResidual(design, background, foreground);
      const screenshotBlend = blendAlphaAndResidual(screenshot, background, foreground);
      if (Math.max(designBlend.residual, screenshotBlend.residual) > MAX_BLEND_RESIDUAL) {
        return undefined;
      }
      const designCore = designBlend.alpha >= CORE_ALPHA;
      const screenshotCore = screenshotBlend.alpha >= CORE_ALPHA;
      if (designCore !== screenshotCore) return undefined;
      if (designCore) sharedCorePixelCount++;
      if (maxChannelDelta(design, screenshot) <= CHANNEL_TOLERANCE) continue;
      const alphas = [designBlend.alpha, screenshotBlend.alpha];
      if (alphas.some((alpha) => alpha <= EDGE_ALPHA_MIN || alpha >= EDGE_ALPHA_MAX)) {
        return undefined;
      }
      if (
        !changeTouchesCore(
          designPixels,
          screenshotPixels,
          width,
          window,
          x,
          y,
          background,
          foreground,
          ignoreMask,
        )
      ) {
        return undefined;
      }
      changedPixelCount++;
    }
  }
  return changedPixelCount > 0 && sharedCorePixelCount > 0
    ? { sharedCorePixelCount, changedPixelCount }
    : undefined;
};

const changeTouchesCore = (
  designPixels: Uint8ClampedArray,
  screenshotPixels: Uint8ClampedArray,
  width: number,
  window: RasterWindow,
  x: number,
  y: number,
  background: readonly number[],
  foreground: readonly number[],
  ignoreMask?: Uint8Array,
): boolean => {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const neighborX = x + dx;
      const neighborY = y + dy;
      if (
        neighborX < window.left ||
        neighborX >= window.right ||
        neighborY < window.top ||
        neighborY >= window.bottom
      ) {
        continue;
      }
      const neighborIndex = neighborY * width + neighborX;
      if (ignoreMask?.[neighborIndex]) continue;
      const design = blendAlphaAndResidual(
        colorAt(designPixels, neighborIndex),
        background,
        foreground,
      );
      const screenshot = blendAlphaAndResidual(
        colorAt(screenshotPixels, neighborIndex),
        background,
        foreground,
      );
      if (design.alpha >= CORE_ALPHA && screenshot.alpha >= CORE_ALPHA) return true;
    }
  }
  return false;
};

export const classifyGlyphEdgeRasterization = (
  designPixels: Uint8ClampedArray,
  screenshotPixels: Uint8ClampedArray,
  width: number,
  height: number,
  bbox: DiffBoundingBox,
  ignoreMask?: Uint8Array,
): GlyphEdgeRasterEvidence | undefined => {
  const window = resolveRasterWindow(width, height, bbox);
  if (!window) return undefined;
  const background = resolveMatchingBackground(
    designPixels,
    screenshotPixels,
    width,
    window,
    ignoreMask,
  );
  if (!background) return undefined;
  const foreground = findSharedForeground(
    designPixels,
    screenshotPixels,
    width,
    window,
    background,
    ignoreMask,
  );
  if (!foreground) return undefined;
  const analysis = analyzeRasterPixels(
    designPixels,
    screenshotPixels,
    width,
    window,
    background,
    foreground,
    ignoreMask,
  );
  if (!analysis) return undefined;

  return {
    classification: "glyph-edge-rasterization",
    changedPixelCount: analysis.changedPixelCount,
    sharedCorePixelCount: analysis.sharedCorePixelCount,
    backgroundHex: toHex(background),
    foregroundHex: toHex(foreground),
  };
};

export interface SameTokenRasterEvidence {
  classification: "same-token-rasterization";
  changedPixelCount: number;
  backgroundHex: string;
  foregroundHex: string;
  inkCoverageDelta: number;
}

// 前景トークンは両画像で同一色名である必要があるが、ラスタライザ差で数値は僅かに揺れる。
export const FOREGROUND_TOKEN_TOLERANCE = 24;
// 1px でも色相ズレが混ざったら別トークンとみなし、このクラスでは説明しない。
export const RASTER_BLEND_RESIDUAL = 16;
// 同じ太さの文字列が別ラスタライザで描かれたときのインク量差はせいぜい±15%。
// 太さ違い (Regular↔Bold で約30%)・文字欠落はこれを越えるので 0.25 で切る。
const MAX_INK_COVERAGE_DELTA = 0.25;
// 位置ズレのみの同一トポロジなら Hausdorff 正規化値は 0.1 前後。
// グリフ欠落・要素欠落は領域対角の 1/3 級の空隙を作るので 0.25 で切る。
const MAX_TOPOLOGY_SHAPE = 0.25;

export const foregroundExtreme = (
  pixels: Uint8ClampedArray,
  width: number,
  window: RasterWindow,
  background: readonly number[],
  ignoreMask?: Uint8Array,
): number[] | undefined => {
  let extreme: number[] | undefined;
  let extremeScore = 0;
  for (let y = window.top; y < window.bottom; y++) {
    for (let x = window.left; x < window.right; x++) {
      const index = y * width + x;
      if (ignoreMask?.[index]) continue;
      const color = colorAt(pixels, index);
      const contrast = maxChannelDelta(background, color);
      if (contrast > extremeScore) {
        extremeScore = contrast;
        extreme = [...color];
      }
    }
  }
  return extremeScore >= MIN_FOREGROUND_CONTRAST ? extreme : undefined;
};

export const isOnAxisBlend = (
  pixels: Uint8ClampedArray,
  width: number,
  window: RasterWindow,
  background: readonly number[],
  foreground: readonly number[],
  ignoreMask?: Uint8Array,
): boolean => {
  for (let y = window.top; y < window.bottom; y++) {
    for (let x = window.left; x < window.right; x++) {
      const index = y * width + x;
      if (ignoreMask?.[index]) continue;
      const { residual } = blendAlphaAndResidual(colorAt(pixels, index), background, foreground);
      if (residual > RASTER_BLEND_RESIDUAL) return false;
    }
  }
  return true;
};

export const inkCoverage = (
  pixels: Uint8ClampedArray,
  width: number,
  window: RasterWindow,
  background: readonly number[],
  foreground: readonly number[],
  ignoreMask?: Uint8Array,
): number => {
  let coverage = 0;
  for (let y = window.top; y < window.bottom; y++) {
    for (let x = window.left; x < window.right; x++) {
      const index = y * width + x;
      if (ignoreMask?.[index]) continue;
      coverage += blendAlphaAndResidual(colorAt(pixels, index), background, foreground).alpha;
    }
  }
  return coverage;
};

export const countChangedPixels = (
  designPixels: Uint8ClampedArray,
  screenshotPixels: Uint8ClampedArray,
  width: number,
  window: RasterWindow,
  ignoreMask?: Uint8Array,
): number => {
  let changed = 0;
  for (let y = window.top; y < window.bottom; y++) {
    for (let x = window.left; x < window.right; x++) {
      const index = y * width + x;
      if (ignoreMask?.[index]) continue;
      const design = colorAt(designPixels, index);
      const screenshot = colorAt(screenshotPixels, index);
      if (maxChannelDelta(design, screenshot) > CHANNEL_TOLERANCE) changed++;
    }
  }
  return changed;
};

/**
 * 同一トークン・同一トポロジのラスタライザ差分だけを証明する狭い分類。
 *
 * 4つの独立した拘束を全部満たす領域だけが対象:
 * 1. 両画像の全画素が共通 bg→fg 軸上のブレンドである (色相ズレ = 別トークン → 拒否)
 * 2. 各画像の最前景トークンが一致 (bg/fg の色名が同じ)
 * 3. インク被覆率差が小さい (同じ分量の墨が置かれている)
 * 4. エッジトポロジが近い (欠落したグリフや要素は大きな空隙を作り弾かれる)
 *
 * glyph-edge-rasterization が「同一位置の共有コア」を要求するのに対し、
 * こちらは位置を共有しない同一トークンを許容する。欠落・色違い・太さ違いの
 * 実害は各拘束が弾くため、このクラスに入れば要素レベルでは一致とみなせる。
 */
export const classifySameTokenRasterization = (
  designPixels: Uint8ClampedArray,
  screenshotPixels: Uint8ClampedArray,
  width: number,
  height: number,
  bbox: DiffBoundingBox,
  topologyShape: number,
  ignoreMask?: Uint8Array,
): SameTokenRasterEvidence | undefined => {
  if (topologyShape > MAX_TOPOLOGY_SHAPE) return undefined;
  const window = resolveRasterWindow(width, height, bbox);
  if (!window) return undefined;
  const background = resolveMatchingBackground(
    designPixels,
    screenshotPixels,
    width,
    window,
    ignoreMask,
  );
  if (!background) return undefined;
  const designForeground = foregroundExtreme(designPixels, width, window, background, ignoreMask);
  const screenshotForeground = foregroundExtreme(
    screenshotPixels,
    width,
    window,
    background,
    ignoreMask,
  );
  if (!designForeground || !screenshotForeground) return undefined;
  if (maxChannelDelta(designForeground, screenshotForeground) > FOREGROUND_TOKEN_TOLERANCE) {
    return undefined;
  }
  if (
    !isOnAxisBlend(designPixels, width, window, background, designForeground, ignoreMask) ||
    !isOnAxisBlend(screenshotPixels, width, window, background, screenshotForeground, ignoreMask)
  ) {
    return undefined;
  }
  const designInk = inkCoverage(
    designPixels,
    width,
    window,
    background,
    designForeground,
    ignoreMask,
  );
  const screenshotInk = inkCoverage(
    screenshotPixels,
    width,
    window,
    background,
    screenshotForeground,
    ignoreMask,
  );
  const inkDelta = Math.abs(designInk - screenshotInk) / Math.max(designInk, screenshotInk);
  if (inkDelta > MAX_INK_COVERAGE_DELTA) return undefined;

  const changedPixelCount = countChangedPixels(
    designPixels,
    screenshotPixels,
    width,
    window,
    ignoreMask,
  );
  if (changedPixelCount === 0) return undefined;

  return {
    classification: "same-token-rasterization",
    changedPixelCount,
    backgroundHex: toHex(background),
    foregroundHex: toHex(designForeground),
    inkCoverageDelta: inkDelta,
  };
};

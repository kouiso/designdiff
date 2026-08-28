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
const MIN_FOREGROUND_CONTRAST = 64;
const CORE_ALPHA = 0.85;
const EDGE_ALPHA_MIN = 0.02;
const EDGE_ALPHA_MAX = 0.98;
const MAX_BLEND_RESIDUAL = 10;

const colorAt = (pixels: Uint8ClampedArray, pixelIndex: number): [number, number, number] => {
  const offset = pixelIndex * 4;
  return [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
};

const colorKey = (color: readonly number[]): string => `${color[0]},${color[1]},${color[2]}`;

const toHex = (color: readonly number[]): string =>
  `#${color
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;

const maxChannelDelta = (a: readonly number[], b: readonly number[]): number =>
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

const blendAlphaAndResidual = (
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

interface RasterWindow {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const resolveRasterWindow = (
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

const resolveMatchingBackground = (
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
): { sharedCore: Set<number>; changed: number[] } | undefined => {
  const sharedCore = new Set<number>();
  const changed: number[] = [];
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
      if (designCore) sharedCore.add(pixelIndex);
      if (maxChannelDelta(design, screenshot) <= CHANNEL_TOLERANCE) continue;
      const alphas = [designBlend.alpha, screenshotBlend.alpha];
      if (alphas.some((alpha) => alpha <= EDGE_ALPHA_MIN || alpha >= EDGE_ALPHA_MAX)) {
        return undefined;
      }
      changed.push(pixelIndex);
    }
  }
  return changed.length > 0 && sharedCore.size > 0 ? { sharedCore, changed } : undefined;
};

const everyChangeTouchesCore = (
  changed: number[],
  sharedCore: Set<number>,
  width: number,
  height: number,
): boolean =>
  changed.every((pixelIndex) => {
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const neighborX = x + dx;
        const neighborY = y + dy;
        if (neighborX < 0 || neighborX >= width || neighborY < 0 || neighborY >= height) continue;
        if (sharedCore.has(neighborY * width + neighborX)) return true;
      }
    }
    return false;
  });

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
  if (!analysis || !everyChangeTouchesCore(analysis.changed, analysis.sharedCore, width, height)) {
    return undefined;
  }

  return {
    classification: "glyph-edge-rasterization",
    changedPixelCount: analysis.changed.length,
    sharedCorePixelCount: analysis.sharedCore.size,
    backgroundHex: toHex(background),
    foregroundHex: toHex(foreground),
  };
};

import type { DiffBoundingBox } from "../type.js";

type Rgb = readonly [number, number, number];

const BACKGROUND_HALO_PX = 2;
const MIN_BACKGROUND_COVERAGE = 0.4;
const CHANNEL_NOISE_TOLERANCE = 1;
const MIN_FOREGROUND_PIXELS = 3;
const COLOR_MAPPING_TOLERANCE = 8;
const MIN_REPEATED_FOREGROUND_COVERAGE = 0.4;

interface Window {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type ForegroundOccupancyGeometry = "same" | "different" | "unknown";

interface OccupancyScan {
  occupancyMismatch: boolean;
  colorMappingMismatch: boolean;
  foregroundPixelsA: number;
  foregroundPixelsB: number;
  backgroundPixelsA: number;
  backgroundPixelsB: number;
  repeatedForegroundPixelsA: number;
  repeatedForegroundPixelsB: number;
}

const clampWindow = (
  bbox: DiffBoundingBox,
  width: number,
  height: number,
  halo: number,
): Window => ({
  left: Math.max(0, Math.floor(bbox.x) - halo),
  top: Math.max(0, Math.floor(bbox.y) - halo),
  right: Math.min(width, Math.ceil(bbox.x + bbox.w) + halo),
  bottom: Math.min(height, Math.ceil(bbox.y + bbox.h) + halo),
});

const rgbAt = (pixels: Uint8ClampedArray, pixel: number): Rgb => {
  const offset = pixel * 4;
  return [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
};

const rgbKey = (color: Rgb): string => `${color[0]},${color[1]},${color[2]}`;

const maxChannelDelta = (a: Rgb, b: Rgb): number =>
  Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

function recordColorMapping(mapping: Map<string, Rgb>, source: Rgb, target: Rgb): boolean {
  const key = rgbKey(source);
  const previous = mapping.get(key);
  if (previous !== undefined) return maxChannelDelta(previous, target) <= COLOR_MAPPING_TOLERANCE;
  mapping.set(key, target);
  return true;
}

function increment(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function inferBackground(
  pixels: Uint8ClampedArray,
  width: number,
  window: Window,
  ignoreMask?: Uint8Array,
): Rgb | undefined {
  const counts = new Map<string, { color: Rgb; count: number }>();
  let samples = 0;
  for (let y = window.top; y < window.bottom; y++) {
    for (let x = window.left; x < window.right; x++) {
      if (
        x !== window.left &&
        x !== window.right - 1 &&
        y !== window.top &&
        y !== window.bottom - 1
      ) {
        continue;
      }
      const pixel = y * width + x;
      if (ignoreMask?.[pixel] === 1) continue;
      const color = rgbAt(pixels, pixel);
      const key = rgbKey(color);
      const current = counts.get(key);
      counts.set(key, { color, count: (current?.count ?? 0) + 1 });
      samples++;
    }
  }
  if (samples === 0) return undefined;

  let dominant: { color: Rgb; count: number } | undefined;
  for (const candidate of counts.values()) {
    if (dominant === undefined || candidate.count > dominant.count) dominant = candidate;
  }
  if (dominant === undefined || dominant.count / samples < MIN_BACKGROUND_COVERAGE)
    return undefined;
  return dominant.color;
}

function validateInputs(
  imgA: Uint8ClampedArray,
  imgB: Uint8ClampedArray,
  width: number,
  height: number,
  bbox: DiffBoundingBox,
  ignoreMask?: Uint8Array,
): void {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error("Image width and height must be positive integers");
  }
  if (
    !Number.isFinite(bbox.x) ||
    !Number.isFinite(bbox.y) ||
    !Number.isFinite(bbox.w) ||
    !Number.isFinite(bbox.h) ||
    bbox.w < 0 ||
    bbox.h < 0
  ) {
    throw new Error("Bounding box must contain finite coordinates and non-negative dimensions");
  }
  if (imgA.length !== width * height * 4 || imgB.length !== width * height * 4) {
    throw new Error("Image data length must equal width * height * 4");
  }
  if (ignoreMask !== undefined && ignoreMask.length !== width * height) {
    throw new Error("ignoreMask length must equal width * height");
  }
}

function scanOccupancy(
  imgA: Uint8ClampedArray,
  imgB: Uint8ClampedArray,
  width: number,
  region: Window,
  backgroundA: Rgb,
  backgroundB: Rgb,
  ignoreMask?: Uint8Array,
): OccupancyScan {
  let occupancyMismatch = false;
  let colorMappingMismatch = false;
  let foregroundPixelsA = 0;
  let foregroundPixelsB = 0;
  let backgroundPixelsA = 0;
  let backgroundPixelsB = 0;
  const forwardMapping = new Map<string, Rgb>();
  const reverseMapping = new Map<string, Rgb>();
  const sourceForegroundCounts = new Map<string, number>();
  const targetForegroundCounts = new Map<string, number>();
  const sourceForegroundColors: string[] = [];
  const targetForegroundColors: string[] = [];
  for (let y = region.top; y < region.bottom; y++) {
    for (let x = region.left; x < region.right; x++) {
      const pixel = y * width + x;
      if (ignoreMask?.[pixel] === 1) continue;
      const colorA = rgbAt(imgA, pixel);
      const colorB = rgbAt(imgB, pixel);
      const occupiedA = maxChannelDelta(colorA, backgroundA) > CHANNEL_NOISE_TOLERANCE;
      const occupiedB = maxChannelDelta(colorB, backgroundB) > CHANNEL_NOISE_TOLERANCE;
      if (occupiedA !== occupiedB) occupancyMismatch = true;
      const forwardConsistent = recordColorMapping(forwardMapping, colorA, colorB);
      const reverseConsistent = recordColorMapping(reverseMapping, colorB, colorA);
      if (!forwardConsistent || !reverseConsistent) colorMappingMismatch = true;
      if (occupiedA) {
        foregroundPixelsA++;
        const source = rgbKey(colorA);
        increment(sourceForegroundCounts, source);
        sourceForegroundColors.push(source);
      } else {
        backgroundPixelsA++;
      }
      if (occupiedB) {
        foregroundPixelsB++;
        const target = rgbKey(colorB);
        increment(targetForegroundCounts, target);
        targetForegroundColors.push(target);
      } else {
        backgroundPixelsB++;
      }
    }
  }

  return {
    occupancyMismatch,
    colorMappingMismatch,
    foregroundPixelsA,
    foregroundPixelsB,
    backgroundPixelsA,
    backgroundPixelsB,
    repeatedForegroundPixelsA: sourceForegroundColors.filter(
      (color) => (sourceForegroundCounts.get(color) ?? 0) >= 2,
    ).length,
    repeatedForegroundPixelsB: targetForegroundColors.filter(
      (color) => (targetForegroundCounts.get(color) ?? 0) >= 2,
    ).length,
  };
}

function hasComparableEvidence(scan: OccupancyScan): boolean {
  return (
    scan.foregroundPixelsA >= MIN_FOREGROUND_PIXELS &&
    scan.foregroundPixelsB >= MIN_FOREGROUND_PIXELS &&
    scan.backgroundPixelsA > 0 &&
    scan.backgroundPixelsB > 0 &&
    scan.repeatedForegroundPixelsA / scan.foregroundPixelsA >= MIN_REPEATED_FOREGROUND_COVERAGE &&
    scan.repeatedForegroundPixelsB / scan.foregroundPixelsB >= MIN_REPEATED_FOREGROUND_COVERAGE
  );
}

/**
 * 色を捨てた前景位置と内部境界を比較し、幾何差の証拠状態を返す。
 *
 * 前景や反復色が足りない場合は、途中で不一致が見えても unknown を返す。
 * 呼び出し側は different のときだけ position / size の根拠にできる。
 */
export function classifyForegroundOccupancyGeometry(
  imgA: Uint8ClampedArray,
  imgB: Uint8ClampedArray,
  width: number,
  height: number,
  bbox: DiffBoundingBox,
  ignoreMask?: Uint8Array,
): ForegroundOccupancyGeometry {
  validateInputs(imgA, imgB, width, height, bbox, ignoreMask);

  // 差分clusterは塗り矩形へ密着するため、bbox内だけでは全画素が前景になり
  // 背景との境界を検証できない。背景推定に使う狭いhaloも走査へ含める。
  const region = clampWindow(bbox, width, height, BACKGROUND_HALO_PX);
  if (region.right <= region.left || region.bottom <= region.top) return "unknown";
  const backgroundA = inferBackground(imgA, width, region, ignoreMask);
  const backgroundB = inferBackground(imgB, width, region, ignoreMask);
  if (backgroundA === undefined || backgroundB === undefined) return "unknown";

  const scan = scanOccupancy(imgA, imgB, width, region, backgroundA, backgroundB, ignoreMask);
  if (!hasComparableEvidence(scan)) return "unknown";
  return scan.occupancyMismatch || scan.colorMappingMismatch ? "different" : "same";
}

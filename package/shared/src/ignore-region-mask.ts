import type { IgnoreRegion } from "./type.js";

export interface IgnoreMaskResult {
  maskedPixelCount: number;
  mask?: Uint8Array;
}

function assertImageGeometry(width: number, height: number): void {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new RangeError(`Invalid image geometry: ${width}x${height}`);
  }
}

function assertPixelBuffer(buffer: Uint8ClampedArray, width: number, height: number): void {
  const expectedLength = width * height * 4;
  if (buffer.length !== expectedLength) {
    throw new RangeError(
      `Invalid pixel buffer length: expected ${expectedLength}, got ${buffer.length}`,
    );
  }
}

export function buildIgnoreMask(
  width: number,
  height: number,
  regions: readonly IgnoreRegion[] | undefined,
): IgnoreMaskResult {
  assertImageGeometry(width, height);
  if (!regions || regions.length === 0) return { maskedPixelCount: 0 };
  const mask = new Uint8Array(width * height);
  let maskedPixelCount = 0;
  for (const region of regions) {
    const left = Math.max(0, Math.floor(region.x));
    const top = Math.max(0, Math.floor(region.y));
    const right = Math.min(width, Math.floor(region.x + region.width));
    const bottom = Math.min(height, Math.floor(region.y + region.height));
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const index = y * width + x;
        if (mask[index] !== 0) continue;
        mask[index] = 1;
        maskedPixelCount += 1;
      }
    }
  }
  return { maskedPixelCount, mask };
}

export function applyIgnoreRegions(
  designPixels: Uint8ClampedArray,
  screenshotPixels: Uint8ClampedArray,
  width: number,
  height: number,
  regions: readonly IgnoreRegion[] | undefined,
  precomputed?: IgnoreMaskResult,
): IgnoreMaskResult {
  assertImageGeometry(width, height);
  assertPixelBuffer(designPixels, width, height);
  assertPixelBuffer(screenshotPixels, width, height);
  const result = precomputed ?? buildIgnoreMask(width, height, regions);
  if (!result.mask || !regions) return result;
  for (const region of regions) {
    const screenshotOnly = region.label?.startsWith("system:") === true;
    const left = Math.max(0, Math.floor(region.x));
    const top = Math.max(0, Math.floor(region.y));
    const right = Math.min(width, Math.floor(region.x + region.width));
    const bottom = Math.min(height, Math.floor(region.y + region.height));
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const offset = (y * width + x) * 4;
        if (screenshotOnly) {
          screenshotPixels.set(designPixels.subarray(offset, offset + 4), offset);
        } else {
          designPixels.fill(0, offset, offset + 4);
          screenshotPixels.fill(0, offset, offset + 4);
        }
      }
    }
  }
  return result;
}

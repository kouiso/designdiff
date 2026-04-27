import type { DiffBoundingBox } from "../type.js";

const SOBEL_MAX_MAGNITUDE = Math.sqrt(1020 ** 2 + 1020 ** 2);
const TEXTURE_MEAN_SCALE = 0.12;
const TEXTURE_VARIANCE_SCALE = 0.005;

const clamp01 = (value: number): number => {
  return Math.min(1, Math.max(0, value));
};

const toLuminance = (r: number, g: number, b: number): number => {
  return 0.299 * r + 0.587 * g + 0.114 * b;
};

const getLuminanceAt = (pixels: Uint8ClampedArray, width: number, x: number, y: number): number => {
  const index = (y * width + x) * 4;
  return toLuminance(pixels[index], pixels[index + 1], pixels[index + 2]);
};

const clampBbox = (
  width: number,
  height: number,
  bbox: DiffBoundingBox,
): { startX: number; startY: number; endX: number; endY: number } => {
  const startX = Math.min(width, Math.max(0, Math.floor(bbox.x)));
  const startY = Math.min(height, Math.max(0, Math.floor(bbox.y)));
  const endX = Math.min(width, Math.max(startX, Math.ceil(bbox.x + bbox.w)));
  const endY = Math.min(height, Math.max(startY, Math.ceil(bbox.y + bbox.h)));

  return { startX, startY, endX, endY };
};

export function detectHighTextureRegion(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  bbox: DiffBoundingBox,
): { textureScore: number; isPhotoLike: boolean } {
  if (pixels.length !== width * height * 4) {
    throw new Error("Image data length must equal width * height * 4");
  }

  const { startX, startY, endX, endY } = clampBbox(width, height, bbox);
  if (endX - startX < 3 || endY - startY < 3) {
    return { textureScore: 0, isPhotoLike: false };
  }

  let gradientSum = 0;
  let gradientSquaredSum = 0;
  let sumAbsGx = 0;
  let sumAbsGy = 0;
  let sampleCount = 0;

  for (let y = startY + 1; y < endY - 1; y++) {
    for (let x = startX + 1; x < endX - 1; x++) {
      const topLeft = getLuminanceAt(pixels, width, x - 1, y - 1);
      const top = getLuminanceAt(pixels, width, x, y - 1);
      const topRight = getLuminanceAt(pixels, width, x + 1, y - 1);
      const left = getLuminanceAt(pixels, width, x - 1, y);
      const right = getLuminanceAt(pixels, width, x + 1, y);
      const bottomLeft = getLuminanceAt(pixels, width, x - 1, y + 1);
      const bottom = getLuminanceAt(pixels, width, x, y + 1);
      const bottomRight = getLuminanceAt(pixels, width, x + 1, y + 1);

      const gx = -topLeft + topRight + -2 * left + 2 * right + -bottomLeft + bottomRight;
      const gy = topLeft + 2 * top + topRight + -bottomLeft + -2 * bottom + -bottomRight;

      const magnitude = Math.sqrt(gx * gx + gy * gy) / SOBEL_MAX_MAGNITUDE;
      gradientSum += magnitude;
      gradientSquaredSum += magnitude * magnitude;
      sumAbsGx += Math.abs(gx);
      sumAbsGy += Math.abs(gy);
      sampleCount += 1;
    }
  }

  if (sampleCount === 0) {
    return { textureScore: 0, isPhotoLike: false };
  }

  const meanMagnitude = gradientSum / sampleCount;
  const varianceMagnitude = Math.max(0, gradientSquaredSum / sampleCount - meanMagnitude ** 2);
  const normalizedMean = clamp01(meanMagnitude / TEXTURE_MEAN_SCALE);
  const normalizedVariance = clamp01(varianceMagnitude / TEXTURE_VARIANCE_SCALE);
  const directionalDenominator = sumAbsGx + sumAbsGy;
  const directionalBalance =
    directionalDenominator === 0 ? 0 : 1 - Math.abs(sumAbsGx - sumAbsGy) / directionalDenominator;

  const baseTexture = clamp01(normalizedMean * 0.55 + normalizedVariance * 0.45);
  const textureScore = clamp01(baseTexture * (0.2 + 0.8 * directionalBalance));

  return {
    textureScore,
    isPhotoLike: textureScore > 0.6,
  };
}

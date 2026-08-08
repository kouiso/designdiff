const WINDOW_SIZE = 8;
const C1 = (0.01 * 255) ** 2;
const C2 = (0.03 * 255) ** 2;

const toLuminance = (pixels: Uint8ClampedArray): Float64Array => {
  const luminance = new Float64Array(pixels.length / 4);

  for (let pixelIndex = 0; pixelIndex < luminance.length; pixelIndex++) {
    const rgbaIndex = pixelIndex * 4;
    const r = pixels[rgbaIndex];
    const g = pixels[rgbaIndex + 1];
    const b = pixels[rgbaIndex + 2];
    luminance[pixelIndex] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  return luminance;
};

const computeWindowStats = (
  luminanceA: Float64Array,
  luminanceB: Float64Array,
  width: number,
  startX: number,
  startY: number,
  windowWidth: number,
  windowHeight: number,
  ignoreMask?: Uint8Array,
): {
  meanA: number;
  meanB: number;
  varianceA: number;
  varianceB: number;
  covariance: number;
  sampleCount: number;
} => {
  let sampleCount = 0;
  let sumA = 0;
  let sumB = 0;

  for (let offsetY = 0; offsetY < windowHeight; offsetY++) {
    for (let offsetX = 0; offsetX < windowWidth; offsetX++) {
      const index = (startY + offsetY) * width + startX + offsetX;
      if (ignoreMask?.[index] === 1) continue;
      sumA += luminanceA[index];
      sumB += luminanceB[index];
      sampleCount += 1;
    }
  }

  if (sampleCount === 0) {
    return {
      meanA: 0,
      meanB: 0,
      varianceA: 0,
      varianceB: 0,
      covariance: 0,
      sampleCount: 0,
    };
  }

  const meanA = sumA / sampleCount;
  const meanB = sumB / sampleCount;
  let varianceAccumulatorA = 0;
  let varianceAccumulatorB = 0;
  let covarianceAccumulator = 0;

  for (let offsetY = 0; offsetY < windowHeight; offsetY++) {
    for (let offsetX = 0; offsetX < windowWidth; offsetX++) {
      const index = (startY + offsetY) * width + startX + offsetX;
      if (ignoreMask?.[index] === 1) continue;
      const centeredA = luminanceA[index] - meanA;
      const centeredB = luminanceB[index] - meanB;
      varianceAccumulatorA += centeredA * centeredA;
      varianceAccumulatorB += centeredB * centeredB;
      covarianceAccumulator += centeredA * centeredB;
    }
  }

  return {
    meanA,
    meanB,
    varianceA: varianceAccumulatorA / sampleCount,
    varianceB: varianceAccumulatorB / sampleCount,
    covariance: covarianceAccumulator / sampleCount,
    sampleCount,
  };
};

const computeWindowSsim = (stats: ReturnType<typeof computeWindowStats>): number => {
  const numerator = (2 * stats.meanA * stats.meanB + C1) * (2 * stats.covariance + C2);
  const denominator =
    (stats.meanA ** 2 + stats.meanB ** 2 + C1) * (stats.varianceA + stats.varianceB + C2);

  if (denominator === 0) {
    return 1;
  }

  return numerator / denominator;
};

export interface SsimRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

const clampRegion = (region: SsimRegion, width: number, height: number): SsimRegion => {
  const startX = Math.min(Math.max(0, Math.floor(region.x)), width);
  const startY = Math.min(Math.max(0, Math.floor(region.y)), height);
  const endX = Math.min(width, Math.max(startX, Math.ceil(region.x + region.w)));
  const endY = Math.min(height, Math.max(startY, Math.ceil(region.y + region.h)));

  return {
    x: startX,
    y: startY,
    w: Math.max(0, endX - startX),
    h: Math.max(0, endY - startY),
  };
};

export const computeSsimForRegion = (
  imgA: Uint8ClampedArray,
  imgB: Uint8ClampedArray,
  width: number,
  height: number,
  bbox: SsimRegion,
  ignoreMask?: Uint8Array,
): number => {
  if (imgA.length !== width * height * 4 || imgB.length !== width * height * 4) {
    throw new Error("Image data length must equal width * height * 4");
  }
  if (ignoreMask !== undefined && ignoreMask.length !== width * height) {
    throw new Error("ignoreMask length must equal width * height");
  }

  const region = clampRegion(bbox, width, height);
  if (region.w === 0 || region.h === 0) {
    return 1;
  }

  const luminanceA = toLuminance(imgA);
  const luminanceB = toLuminance(imgB);
  let ssimSum = 0;
  let windowCount = 0;
  let sampleCount = 0;

  // 窓は 8x8 のボックスで固定する。ガウス窓へ変えると、判定の基準が
  // これまでの記録と繋がらなくなる。
  // ΔE2000 と Hausdorff は別の信号として signal/ 配下に実装済みで、
  // diff-report-builder が SSIM と併用する。ここで扱わないだけ。
  for (let startY = region.y; startY < region.y + region.h; startY += WINDOW_SIZE) {
    const windowHeight = Math.min(WINDOW_SIZE, region.y + region.h - startY);

    for (let startX = region.x; startX < region.x + region.w; startX += WINDOW_SIZE) {
      const windowWidth = Math.min(WINDOW_SIZE, region.x + region.w - startX);
      const stats = computeWindowStats(
        luminanceA,
        luminanceB,
        width,
        startX,
        startY,
        windowWidth,
        windowHeight,
        ignoreMask,
      );
      if (stats.sampleCount === 0) continue;
      const windowSsim = computeWindowSsim(stats);
      if (ignoreMask === undefined) {
        // mask が無い比較は従来の窓単位平均を維持する。端数窓を画素数で軽くすると、
        // 既存fixtureの構造スコアと0.95判定境界がこの機能と無関係に変わるため。
        ssimSum += windowSsim;
        windowCount += 1;
      } else {
        // mask 内の画素を除いた窓は、有効画素が少ないほど寄与も小さくする。
        ssimSum += windowSsim * stats.sampleCount;
        sampleCount += stats.sampleCount;
      }
    }
  }

  const divisor = ignoreMask === undefined ? windowCount : sampleCount;
  if (divisor === 0) {
    return 1;
  }

  const averageSsim = ssimSum / divisor;
  return Math.min(1, Math.max(0, averageSsim));
};

export const computeSsim = (
  imgA: Uint8ClampedArray,
  imgB: Uint8ClampedArray,
  width: number,
  height: number,
): number => {
  return computeSsimForRegion(imgA, imgB, width, height, { x: 0, y: 0, w: width, h: height });
};

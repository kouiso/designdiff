/**
 * 位置合わせ（平行移動の検出と適用）
 *
 * 判定側とデスクトップ側の双方が同じ値を必要とする。片方だけに置くと、
 * 「15%以上良くなった時だけ適用する」という判断を2箇所で書き直すことになり、
 * いずれ食い違う。適用の可否まで含めてここへ集める。
 */

import type { Alignment } from "../type.js";

export const COARSE_RANGE = 50;
export const COARSE_STEP = 5;
export const FINE_RANGE = 5;
export const COARSE_SAMPLE_STEP = 4;
export const DIFF_THRESHOLD_SQ = 625; // per-channel RGB distance threshold (25^2)

/**
 * Count differing pixels between design (offset by dx,dy) and screenshot,
 * sampling every sampleStep pixels. No array allocation — direct index math.
 *
 * alwaysPenalizeOob: when true, every OOB pixel counts as a diff (used in the
 * improvement-check gate to prevent transparent-vs-black false matches).
 * When false (default for detection), OOB only penalizes visible screen content.
 */
export const countSsdOffset = (
  design: Uint8ClampedArray,
  screenshot: Uint8ClampedArray,
  width: number,
  height: number,
  dx: number,
  dy: number,
  sampleStep: number,
  alwaysPenalizeOob = false,
): number => {
  let diff = 0;
  for (let y = 0; y < height; y += sampleStep) {
    for (let x = 0; x < width; x += sampleStep) {
      const bIdx = (y * width + x) * 4;
      const srcX = x - dx;
      const srcY = y - dy;
      if (srcX < 0 || srcX >= width || srcY < 0 || srcY >= height) {
        if (alwaysPenalizeOob) {
          diff++;
        } else {
          // Out-of-bounds design pixels are effectively transparent (0,0,0,0).
          // Count as diff when the screenshot has visible content.
          const r = screenshot[bIdx];
          const g = screenshot[bIdx + 1];
          const b = screenshot[bIdx + 2];
          if (r * r + g * g + b * b > DIFF_THRESHOLD_SQ) diff++;
        }
        continue;
      }
      const aIdx = (srcY * width + srcX) * 4;
      const dr = design[aIdx] - screenshot[bIdx];
      const dg = design[aIdx + 1] - screenshot[bIdx + 1];
      const db = design[aIdx + 2] - screenshot[bIdx + 2];
      if (dr * dr + dg * dg + db * db > DIFF_THRESHOLD_SQ) diff++;
    }
  }
  return diff;
};

/**
 * Detect translation offset between design and screenshot pixels.
 * Coarse search (±50px, step 5px, sampled) then fine (±5px, full resolution).
 * Returns { dx, dy } such that shifting design by (dx,dy) minimises pixel diff.
 */
export const detectTranslation = (
  design: Uint8ClampedArray,
  screenshot: Uint8ClampedArray,
  width: number,
  height: number,
): { dx: number; dy: number; confidence: number; residual: number } => {
  if (width * height < 64) {
    return { dx: 0, dy: 0, confidence: 1, residual: 0 };
  }

  let bestDx = 0;
  let bestDy = 0;
  let bestDiff = Infinity;

  for (let dy = -COARSE_RANGE; dy <= COARSE_RANGE; dy += COARSE_STEP) {
    for (let dx = -COARSE_RANGE; dx <= COARSE_RANGE; dx += COARSE_STEP) {
      const d = countSsdOffset(design, screenshot, width, height, dx, dy, COARSE_SAMPLE_STEP);
      if (d < bestDiff) {
        bestDiff = d;
        bestDx = dx;
        bestDy = dy;
      }
    }
  }

  // bestDiff from the coarse pass is a sampled count (every COARSE_SAMPLE_STEP
  // pixels), not comparable to the fine pass's full-resolution count — reset
  // before the fine pass so it doesn't spuriously "win" against every full-res
  // candidate purely because it summed far fewer samples.
  const coarseDx = bestDx;
  const coarseDy = bestDy;
  bestDiff = Infinity;
  // The fine pass runs FINE_RANGE*2+1 squared candidates; a step of 1 on a
  // large screenshot (e.g. a 1080x2340 real-device capture) means over 100
  // full-resolution scans. Sample on a stride for large images — the fine
  // pass only needs to discriminate between candidates 10px apart, so a
  // coarser sample than 1px is still discriminating at that scale.
  const fineSampleStep = width * height > 1_000_000 ? 2 : 1;
  for (let dy = coarseDy - FINE_RANGE; dy <= coarseDy + FINE_RANGE; dy++) {
    for (let dx = coarseDx - FINE_RANGE; dx <= coarseDx + FINE_RANGE; dx++) {
      const d = countSsdOffset(design, screenshot, width, height, dx, dy, fineSampleStep);
      if (d < bestDiff) {
        bestDiff = d;
        bestDx = dx;
        bestDy = dy;
      }
    }
  }

  // bestDiff is a count over the fineSampleStep grid, not every pixel — normalize
  // by the actual number of sampled positions (matches countSsdOffset's
  // `for (i = 0; i < n; i += step)` iteration count), not the raw pixel count,
  // or a strided scan underreports residual by roughly step^2.
  const sampledPositionCount =
    Math.ceil(width / fineSampleStep) * Math.ceil(height / fineSampleStep);
  const residual = sampledPositionCount === 0 ? 0 : bestDiff / sampledPositionCount;
  const offsetMagnitude = Math.sqrt(bestDx * bestDx + bestDy * bestDy);
  const confidence = Math.max(0, 1 - offsetMagnitude / (COARSE_RANGE * Math.SQRT2));

  return { dx: bestDx, dy: bestDy, confidence, residual };
};

/**
 * Shift design pixels by (dx, dy) to apply alignment correction.
 * Pixels shifted outside bounds become transparent.
 */
export const shiftPixels = (
  src: Uint8ClampedArray,
  width: number,
  height: number,
  dx: number,
  dy: number,
): Uint8ClampedArray => {
  const dst = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcX = x - dx;
      const srcY = y - dy;
      if (srcX < 0 || srcX >= width || srcY < 0 || srcY >= height) continue;
      const srcIdx = (srcY * width + srcX) * 4;
      const dstIdx = (y * width + x) * 4;
      dst[dstIdx] = src[srcIdx];
      dst[dstIdx + 1] = src[srcIdx + 1];
      dst[dstIdx + 2] = src[srcIdx + 2];
      dst[dstIdx + 3] = src[srcIdx + 3];
    }
  }
  return dst;
};
// 位置合わせを適用するのは、画素の違いが15%以上減るときだけ。
// 一様な色の画像ではどの位置でも同じくらい良く見えるので、この門が無いと
// 偽の最小値へ寄せてしまう。
export const ALIGNMENT_IMPROVEMENT_THRESHOLD = 0.85;

export interface ResolvedAlignment {
  alignment: Alignment;
  alignedDesignPixels: Uint8ClampedArray;
  applied: boolean;
}

/**
 * 平行移動を検出し、割に合うときだけ適用した画素を返す。
 *
 * 検出と適用可否を分けて公開すると、呼ぶ側ごとに門の書き方がずれる。
 * ここで一続きにして、両方の呼び出し元が同じ判断を通るようにする。
 */
export const resolveAlignment = (
  designPixels: Uint8ClampedArray,
  screenshotPixels: Uint8ClampedArray,
  width: number,
  height: number,
): ResolvedAlignment => {
  const { dx, dy, confidence, residual } = detectTranslation(
    designPixels,
    screenshotPixels,
    width,
    height,
  );

  let alignedDesignPixels = designPixels;
  let applied = false;
  if (dx !== 0 || dy !== 0) {
    // 画像の外へ出た画素を必ず違いとして数える。数えないと、透明な余白が
    // 黒い実装と「一致」に見えてしまう。
    const baselineDiff = countSsdOffset(
      designPixels,
      screenshotPixels,
      width,
      height,
      0,
      0,
      COARSE_SAMPLE_STEP,
      true,
    );
    const correctedDiff = countSsdOffset(
      designPixels,
      screenshotPixels,
      width,
      height,
      dx,
      dy,
      COARSE_SAMPLE_STEP,
      true,
    );
    if (baselineDiff > 0 && correctedDiff < baselineDiff * ALIGNMENT_IMPROVEMENT_THRESHOLD) {
      alignedDesignPixels = shiftPixels(designPixels, width, height, dx, dy);
      applied = true;
    }
  }

  return {
    alignment: {
      // 適用しなかった場合も検出値をそのまま載せる。0 に伏せると、
      // 「ずれは見つけたが割に合わないので直さなかった」という事実が消える。
      translation: { x: dx, y: dy },
      scale: { x: 1, y: 1 },
      rotation: 0,
      confidence,
      residual,
    },
    alignedDesignPixels,
    applied,
  };
};

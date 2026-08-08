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

interface TranslationCandidate {
  dx: number;
  dy: number;
}

function validateIgnoreMask(
  ignoreMask: Uint8Array | undefined,
  width: number,
  height: number,
): void {
  if (ignoreMask && ignoreMask.length < width * height) {
    throw new Error(
      `ignoreMask buffer too small for ${width}x${height}: got ${ignoreMask.length}, expected>=${width * height}`,
    );
  }
}

function validateTranslationCandidates(candidates: readonly TranslationCandidate[]): void {
  for (const candidate of candidates) {
    if (!Number.isInteger(candidate.dx) || !Number.isInteger(candidate.dy)) {
      throw new Error(
        `translation candidate must use integer pixels: dx=${candidate.dx}, dy=${candidate.dy}`,
      );
    }
  }
}

/**
 * 位置をずらしたときに違って見える画素を数える。
 *
 * 配列を作らずに添字だけで走る。数百万画素を何十回も走るので、途中の配列を
 * 作ると確保と解放だけで時間が溶ける。
 *
 * alwaysPenalizeOob: 画像の外へ出た画素を必ず違いとして数えるか。
 * 数えないと、透明な余白が黒い実装と「一致」に見える。ずれを探すときは
 * 数えず（画面に見えている中身だけを罰する）、動かす価値を測るときは数える。
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
  ignoreMask?: Uint8Array,
): number => {
  // 0 や負の刻みを渡されると、走査が終わらずプロセスが固まる。
  // 公開した以上、呼ぶ側を信用せずここで止める。
  if (!Number.isInteger(sampleStep) || sampleStep <= 0) {
    throw new Error(`sampleStep must be a positive integer: got ${sampleStep}`);
  }
  validateIgnoreMask(ignoreMask, width, height);

  let diff = 0;
  for (let y = 0; y < height; y += sampleStep) {
    for (let x = 0; x < width; x += sampleStep) {
      if (ignoreMask && ignoreMask[y * width + x] !== 0) continue;
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

function scoreTranslationCandidate(
  design: Uint8ClampedArray,
  screenshot: Uint8ClampedArray,
  width: number,
  height: number,
  candidate: TranslationCandidate,
  sampleStep: number,
  ignoreMask: Uint8Array | undefined,
): number {
  return countSsdOffset(
    design,
    screenshot,
    width,
    height,
    candidate.dx,
    candidate.dy,
    sampleStep,
    false,
    ignoreMask,
  );
}

function countSampledPositions(
  width: number,
  height: number,
  sampleStep: number,
  ignoreMask: Uint8Array | undefined,
): number {
  let count = 0;
  for (let y = 0; y < height; y += sampleStep) {
    for (let x = 0; x < width; x += sampleStep) {
      if (ignoreMask && ignoreMask[y * width + x] !== 0) continue;
      count++;
    }
  }
  return count;
}

/**
 * 設計と撮影の間の平行移動を探す。
 *
 * 粗く広く探してから、その周りを細かく探す。最初から1px刻みで±50pxを見ると
 * 候補が1万通りになり、実寸の画像では終わらない。
 */
export const detectTranslation = (
  design: Uint8ClampedArray,
  screenshot: Uint8ClampedArray,
  width: number,
  height: number,
  ignoreMask?: Uint8Array,
  additionalCandidates: readonly TranslationCandidate[] = [],
): { dx: number; dy: number; confidence: number; residual: number } => {
  validateIgnoreMask(ignoreMask, width, height);
  validateTranslationCandidates(additionalCandidates);
  if (width * height < 64) {
    return { dx: 0, dy: 0, confidence: 1, residual: 0 };
  }

  let bestDx = 0;
  let bestDy = 0;
  let bestDiff = Infinity;

  // 同点のときは動かさない側を残す。一様な画像や繰り返し模様ではどの位置でも
  // 同じ数になり、走査順の先頭がそのまま「ずれ」として報告されてしまう。
  const isBetter = (diff: number, dx: number, dy: number): boolean => {
    if (diff !== bestDiff) {
      return diff < bestDiff;
    }
    return dx * dx + dy * dy < bestDx * bestDx + bestDy * bestDy;
  };

  for (let dy = -COARSE_RANGE; dy <= COARSE_RANGE; dy += COARSE_STEP) {
    for (let dx = -COARSE_RANGE; dx <= COARSE_RANGE; dx += COARSE_STEP) {
      const d = scoreTranslationCandidate(
        design,
        screenshot,
        width,
        height,
        { dx, dy },
        COARSE_SAMPLE_STEP,
        ignoreMask,
      );
      if (isBetter(d, dx, dy)) {
        bestDiff = d;
        bestDx = dx;
        bestDy = dy;
      }
    }
  }

  // 粗い探索の値は間引いて数えたもので、細かい探索の値とは桁が違う。
  // 持ち越すと、単に数えた点が少ないという理由で粗い側が勝ち続ける。
  const coarseDx = bestDx;
  const coarseDy = bestDy;
  bestDiff = Infinity;
  // 細かい探索は粗い探索の当たりを起点にする。同点判定の比較対象も
  // その位置へ戻さないと、前段の値と混ざる。
  bestDx = coarseDx;
  bestDy = coarseDy;
  // 大きい画像で1px刻みのまま全画素を100回以上走ると時間が持たない。
  // 細かい探索が見分けたいのは10px以内の差なので、間引いても区別はつく。
  const fineSampleStep = width * height > 1_000_000 ? 2 : 1;
  for (let dy = coarseDy - FINE_RANGE; dy <= coarseDy + FINE_RANGE; dy++) {
    for (let dx = coarseDx - FINE_RANGE; dx <= coarseDx + FINE_RANGE; dx++) {
      const d = scoreTranslationCandidate(
        design,
        screenshot,
        width,
        height,
        { dx, dy },
        fineSampleStep,
        ignoreMask,
      );
      if (isBetter(d, dx, dy)) {
        bestDiff = d;
        bestDx = dx;
        bestDy = dy;
      }
    }
  }

  // 端末 preset のように出所を検証済みの候補は、一般探索の範囲を広げず
  // その座標だけ追加で比べる。iOS の大きな inset のために全候補を広げると、
  // 本物のレイアウト回帰まで位置合わせで隠してしまう。
  for (const candidate of additionalCandidates) {
    const d = scoreTranslationCandidate(
      design,
      screenshot,
      width,
      height,
      candidate,
      fineSampleStep,
      ignoreMask,
    );
    if (isBetter(d, candidate.dx, candidate.dy)) {
      bestDiff = d;
      bestDx = candidate.dx;
      bestDy = candidate.dy;
    }
  }

  // 間引いて数えた回数で割る。全画素数で割ると、間引いた分だけ残差が
  // 小さく出て「ほぼ一致している」と誤って読める。
  const sampledPositionCount = countSampledPositions(width, height, fineSampleStep, ignoreMask);
  const residual = sampledPositionCount === 0 ? 0 : bestDiff / sampledPositionCount;
  const offsetMagnitude = Math.sqrt(bestDx * bestDx + bestDy * bestDy);
  const confidence = Math.max(0, 1 - offsetMagnitude / (COARSE_RANGE * Math.SQRT2));

  return { dx: bestDx, dy: bestDy, confidence, residual };
};

/**
 * 設計の画素を (dx, dy) だけ動かした新しい並びを返す。
 *
 * 動かした先が無い画素は透明のままにする。既定色で埋めると、埋めた色と
 * 撮影側の差が新しい崩れとして数えられる。
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
  ignoreMask?: Uint8Array,
  additionalCandidates: readonly TranslationCandidate[] = [],
): ResolvedAlignment => {
  const { dx, dy, confidence, residual } = detectTranslation(
    designPixels,
    screenshotPixels,
    width,
    height,
    ignoreMask,
    additionalCandidates,
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
      ignoreMask,
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
      ignoreMask,
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

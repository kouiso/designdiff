// 細い差分領域の局所変位の証明。
//
// WHY: 枠線・区切り線・カード縁のような 1-5px 幅の差分クラスタは、同じ線が
//      別ラスタライザの丸めで 1-3px ずれて描かれただけでも、ずれた位置では
//      「白 vs 線色」のベタ面同士になり flat_region_color / ΔE の critical に
//      上がる。局所シフト救済 (local-alignment.ts) は region と同じ大きさの窓を
//      ずらすため、1px 幅の領域では線の無い隣の背景行と一致してしまい、
//      片側にしか無い要素 (位置違いのカーソル等) まで「一致」と誤証明する。
//
//      ここでは窓を region の周囲へ maxShift 広げ、design の窓とずらした
//      screenshot の窓を丸ごと突き合わせる。ずらした窓は必ず region 全体を
//      含むので、片側にしか無い要素はどのオフセットでも窓の中に残り、
//      不一致として数えられる。両側にある同じ線が平行移動しただけの差分だけが
//      証明を通る。

import { deltaE2000, srgbToLab } from "./delta-e-2000.js";

import type { DiffBoundingBox } from "../type.js";

// 実測で観測される枠線・区切り線のずれは 1-3px。local-alignment と同じ上限。
export const LOCAL_DISPLACEMENT_MAX_SHIFT_PX = 3;

// 証明対象は細い領域だけ。太い領域は同一トークン証明・縁ストラドル証明の
// 守備範囲で、窓をずらすだけの証明を広げると実寸の違いまで飲み込む。
export const LOCAL_DISPLACEMENT_MAX_THICKNESS_PX = 5;

// これを超える1ch差は AA では出ず、別の色が載っている画素とみなす。
const STRONG_MISMATCH_CHANNEL = 32;
// 整列後の窓で別色が残る画素の上限割合。片側だけの 1px×20px の線でも
// 窓の数%を占めるので、ここを超えた時点で平行移動では説明できない。
const MAX_STRONG_MISMATCH_RATIO = 0.01;
// 整列後の region 内平均ΔE の上限。色差 critical と同じ水準で、
// トークン違いの塗りは整列しても残るため弾ける。
const MAX_ALIGNED_REGION_DELTA_E = 2;
// 平行移動で差分の大半が消えることを要求する (誤差の半分以上を説明する)。
const MIN_EXPLAINED_FRACTION = 0.5;
// 整列後に残る別色画素の連結成分の上限。AA の取りこぼしは縁の1-2画素に
// 孤立して出るが、線の一部欠落・別色の差し込みは線に沿って連なる。窓全体の
// 割合だけで判定すると長い線ほど欠落が薄まって見逃すため、塊の大きさで切る。
const MAX_RESIDUAL_COMPONENT_PX = 2;
// 走査コストの上限 (49 オフセット × 窓面積)。4K 幅の全幅 5px 線
// (3846 × 11 ≒ 42k) を含められる大きさにする。
const MAX_WINDOW_AREA = 120000;

export interface LocalDisplacementEvidence {
  classification: "local-displacement";
  // screenshot を (dx, dy) だけずらして読むと design と一致する向き。
  // 内容物は screenshot 側で (dx, dy) だけ動いて描かれている。
  dx: number;
  dy: number;
  // region 内の平均ΔE2000 (ずれたまま / 整列後)。
  unalignedDeltaE: number;
  alignedDeltaE: number;
  strongMismatchRatio: number;
  evaluatedPixelCount: number;
}

interface Window {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const channelDelta = (
  design: Uint8ClampedArray,
  screenshot: Uint8ClampedArray,
  designIndex: number,
  screenshotIndex: number,
): number => {
  const a = designIndex * 4;
  const b = screenshotIndex * 4;
  return Math.max(
    Math.abs(design[a] - screenshot[b]),
    Math.abs(design[a + 1] - screenshot[b + 1]),
    Math.abs(design[a + 2] - screenshot[b + 2]),
  );
};

const pixelDeltaE = (
  design: Uint8ClampedArray,
  screenshot: Uint8ClampedArray,
  designIndex: number,
  screenshotIndex: number,
): number => {
  const a = designIndex * 4;
  const b = screenshotIndex * 4;
  if (
    design[a] === screenshot[b] &&
    design[a + 1] === screenshot[b + 1] &&
    design[a + 2] === screenshot[b + 2]
  ) {
    return 0;
  }
  return deltaE2000(
    srgbToLab(design[a], design[a + 1], design[a + 2]),
    srgbToLab(screenshot[b], screenshot[b + 1], screenshot[b + 2]),
  );
};

interface OffsetScore {
  sum: number;
  strong: number;
  count: number;
}

const scoreOffset = (
  design: Uint8ClampedArray,
  screenshot: Uint8ClampedArray,
  width: number,
  window: Window,
  dx: number,
  dy: number,
  ignoreMask?: Uint8Array,
): OffsetScore => {
  let sum = 0;
  let strong = 0;
  let count = 0;
  for (let y = window.top; y < window.bottom; y++) {
    for (let x = window.left; x < window.right; x++) {
      const designIndex = y * width + x;
      const screenshotIndex = (y + dy) * width + x + dx;
      if (ignoreMask && (ignoreMask[designIndex] === 1 || ignoreMask[screenshotIndex] === 1)) {
        continue;
      }
      const delta = channelDelta(design, screenshot, designIndex, screenshotIndex);
      sum += delta;
      if (delta > STRONG_MISMATCH_CHANNEL) strong += 1;
      count += 1;
    }
  }
  return { sum, strong, count };
};

const regionMeanDeltaE = (
  design: Uint8ClampedArray,
  screenshot: Uint8ClampedArray,
  width: number,
  region: Window,
  dx: number,
  dy: number,
  ignoreMask?: Uint8Array,
): number => {
  let sum = 0;
  let count = 0;
  for (let y = region.top; y < region.bottom; y++) {
    for (let x = region.left; x < region.right; x++) {
      const designIndex = y * width + x;
      const screenshotIndex = (y + dy) * width + x + dx;
      if (ignoreMask && (ignoreMask[designIndex] === 1 || ignoreMask[screenshotIndex] === 1)) {
        continue;
      }
      sum += pixelDeltaE(design, screenshot, designIndex, screenshotIndex);
      count += 1;
    }
  }
  return count === 0 ? 0 : sum / count;
};

const buildResidualMask = (
  design: Uint8ClampedArray,
  screenshot: Uint8ClampedArray,
  width: number,
  window: Window,
  dx: number,
  dy: number,
  ignoreMask?: Uint8Array,
): Uint8Array => {
  const w = window.right - window.left;
  const h = window.bottom - window.top;
  const residual = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const designIndex = (window.top + y) * width + window.left + x;
      const screenshotIndex = designIndex + dy * width + dx;
      const masked =
        ignoreMask !== undefined &&
        (ignoreMask[designIndex] === 1 || ignoreMask[screenshotIndex] === 1);
      if (
        !masked &&
        channelDelta(design, screenshot, designIndex, screenshotIndex) > STRONG_MISMATCH_CHANNEL
      ) {
        residual[y * w + x] = 1;
      }
    }
  }
  return residual;
};

// mask の start から 8 連結で塗りつぶし、塗った画素数を返す (塗った画素は 2 にする)。
const fillComponent = (mask: Uint8Array, w: number, h: number, start: number): number => {
  const stack = [start];
  mask[start] = 2;
  let size = 0;
  while (stack.length > 0) {
    const index = stack.pop() ?? start;
    size += 1;
    const cx = index % w;
    const cy = (index - cx) / w;
    for (let ny = Math.max(0, cy - 1); ny <= Math.min(h - 1, cy + 1); ny++) {
      for (let nx = Math.max(0, cx - 1); nx <= Math.min(w - 1, cx + 1); nx++) {
        const neighbor = ny * w + nx;
        if (mask[neighbor] === 1) {
          mask[neighbor] = 2;
          stack.push(neighbor);
        }
      }
    }
  }
  return size;
};

// 整列後も別色のまま残る画素を 8 連結でまとめ、最大の塊の画素数を返す。
const largestResidualComponent = (
  design: Uint8ClampedArray,
  screenshot: Uint8ClampedArray,
  width: number,
  window: Window,
  dx: number,
  dy: number,
  ignoreMask?: Uint8Array,
): number => {
  const w = window.right - window.left;
  const h = window.bottom - window.top;
  const residual = buildResidualMask(design, screenshot, width, window, dx, dy, ignoreMask);
  let largest = 0;
  for (let start = 0; start < residual.length; start++) {
    if (residual[start] === 1) {
      largest = Math.max(largest, fillComponent(residual, w, h, start));
    }
  }
  return largest;
};

interface BestOffset {
  dx: number;
  dy: number;
  score: OffsetScore;
}

// ずらした窓は画像内に収まり、かつ region 全体を含むこと。region が
// 窓から外れるオフセットを許すと、screenshot 側にだけある要素を窓の外へ
// 逃がして「一致」にできてしまう (画像端の領域で起きる)。
const isEvaluableOffset = (
  window: Window,
  region: Window,
  width: number,
  height: number,
  dx: number,
  dy: number,
): boolean =>
  window.left + dx >= 0 &&
  window.top + dy >= 0 &&
  window.right + dx <= width &&
  window.bottom + dy <= height &&
  window.left + dx <= region.left &&
  window.top + dy <= region.top &&
  window.right + dx >= region.right &&
  window.bottom + dy >= region.bottom;

// 同点なら移動量の小さい方を採る。説明に要する移動は小さいほど丸め誤差として自然。
const isBetterOffset = (candidate: BestOffset, best: BestOffset | undefined): boolean => {
  if (best === undefined) return true;
  const mean = candidate.score.sum / candidate.score.count;
  const bestMean = best.score.sum / best.score.count;
  if (Math.abs(mean - bestMean) > 1e-9) return mean < bestMean;
  return Math.abs(candidate.dx) + Math.abs(candidate.dy) < Math.abs(best.dx) + Math.abs(best.dy);
};

const findBestOffset = (
  designPixels: Uint8ClampedArray,
  screenshotPixels: Uint8ClampedArray,
  width: number,
  height: number,
  region: Window,
  window: Window,
  maxShiftPx: number,
  ignoreMask?: Uint8Array,
): BestOffset | undefined => {
  let best: BestOffset | undefined;
  for (let dy = -maxShiftPx; dy <= maxShiftPx; dy++) {
    for (let dx = -maxShiftPx; dx <= maxShiftPx; dx++) {
      if ((dx === 0 && dy === 0) || !isEvaluableOffset(window, region, width, height, dx, dy)) {
        continue;
      }
      const score = scoreOffset(designPixels, screenshotPixels, width, window, dx, dy, ignoreMask);
      const candidate = { dx, dy, score };
      if (score.count > 0 && isBetterOffset(candidate, best)) {
        best = candidate;
      }
    }
  }
  return best;
};

/**
 * 細い差分領域が「両側にある同じ線・縁の 1-3px 平行移動」だけで説明できるかを判定する。
 * 証明できたときだけ証拠を返す。片側にしか無い要素・色違い・寸法違いは undefined。
 */
export const classifyLocalDisplacement = (
  designPixels: Uint8ClampedArray,
  screenshotPixels: Uint8ClampedArray,
  width: number,
  height: number,
  bbox: DiffBoundingBox,
  ignoreMask?: Uint8Array,
  maxShiftPx: number = LOCAL_DISPLACEMENT_MAX_SHIFT_PX,
): LocalDisplacementEvidence | undefined => {
  if (
    !Number.isSafeInteger(maxShiftPx) ||
    maxShiftPx < 1 ||
    maxShiftPx > LOCAL_DISPLACEMENT_MAX_SHIFT_PX
  ) {
    throw new RangeError(
      `classifyLocalDisplacement: maxShiftPx must be an integer in 1..${LOCAL_DISPLACEMENT_MAX_SHIFT_PX}`,
    );
  }
  if (
    designPixels.length !== width * height * 4 ||
    screenshotPixels.length !== width * height * 4
  ) {
    throw new Error("classifyLocalDisplacement: image data length must equal width * height * 4");
  }
  if (ignoreMask !== undefined && ignoreMask.length !== width * height) {
    throw new Error("classifyLocalDisplacement: ignoreMask length must equal width * height");
  }
  const region: Window = {
    left: Math.max(0, Math.floor(bbox.x)),
    top: Math.max(0, Math.floor(bbox.y)),
    right: Math.min(width, Math.ceil(bbox.x + bbox.w)),
    bottom: Math.min(height, Math.ceil(bbox.y + bbox.h)),
  };
  const regionWidth = region.right - region.left;
  const regionHeight = region.bottom - region.top;
  if (
    regionWidth <= 0 ||
    regionHeight <= 0 ||
    Math.min(regionWidth, regionHeight) > LOCAL_DISPLACEMENT_MAX_THICKNESS_PX
  ) {
    return undefined;
  }
  const window: Window = {
    left: Math.max(0, region.left - maxShiftPx),
    top: Math.max(0, region.top - maxShiftPx),
    right: Math.min(width, region.right + maxShiftPx),
    bottom: Math.min(height, region.bottom + maxShiftPx),
  };
  if ((window.right - window.left) * (window.bottom - window.top) > MAX_WINDOW_AREA) {
    return undefined;
  }

  const baseline = scoreOffset(designPixels, screenshotPixels, width, window, 0, 0, ignoreMask);
  if (baseline.count === 0 || baseline.sum === 0) {
    return undefined;
  }

  const best = findBestOffset(
    designPixels,
    screenshotPixels,
    width,
    height,
    region,
    window,
    maxShiftPx,
    ignoreMask,
  );
  if (best === undefined) {
    return undefined;
  }

  const baselineMean = baseline.sum / baseline.count;
  const bestMean = best.score.sum / best.score.count;
  const strongMismatchRatio = best.score.strong / best.score.count;
  if (
    bestMean > baselineMean * (1 - MIN_EXPLAINED_FRACTION) ||
    strongMismatchRatio > MAX_STRONG_MISMATCH_RATIO ||
    largestResidualComponent(
      designPixels,
      screenshotPixels,
      width,
      window,
      best.dx,
      best.dy,
      ignoreMask,
    ) > MAX_RESIDUAL_COMPONENT_PX
  ) {
    return undefined;
  }

  const alignedDeltaE = regionMeanDeltaE(
    designPixels,
    screenshotPixels,
    width,
    region,
    best.dx,
    best.dy,
    ignoreMask,
  );
  if (alignedDeltaE >= MAX_ALIGNED_REGION_DELTA_E) {
    return undefined;
  }

  return {
    classification: "local-displacement",
    dx: best.dx,
    dy: best.dy,
    unalignedDeltaE: regionMeanDeltaE(
      designPixels,
      screenshotPixels,
      width,
      region,
      0,
      0,
      ignoreMask,
    ),
    alignedDeltaE,
    strongMismatchRatio,
    evaluatedPixelCount: best.score.count,
  };
};

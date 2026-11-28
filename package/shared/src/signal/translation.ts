/**
 * 位置合わせ（平行移動の検出と適用）
 *
 * 判定側とデスクトップ側の双方が同じ値を必要とする。片方だけに置くと、
 * 「15%以上良くなった時だけ適用する」という判断を2箇所で書き直すことになり、
 * いずれ食い違う。適用の可否まで含めてここへ集める。
 */

import type { Alignment, ScaleAxisStatus } from "../type.js";

export const COARSE_RANGE = 50;
export const COARSE_STEP = 5;
export const FINE_RANGE = 5;
export const COARSE_SAMPLE_STEP = 4;
export const DIFF_THRESHOLD_SQ = 625; // per-channel RGB distance threshold (25^2)
export const GLOBAL_SHIFT_ISSUE_THRESHOLD_PX = 2;
export const GLOBAL_SHIFT_CRITICAL_THRESHOLD_PX = 2;

export interface TranslationCandidate {
  dx: number;
  dy: number;
  source?: "verified-system-ui";
}

function validateImageDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error(
      `image dimensions must be positive safe integers: width=${width}, height=${height}`,
    );
  }
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

// 短い buffer を渡されると TypedArray の範囲外読取りは undefined になり、
// 差分が NaN になる。NaN > しきい値 は常に false なので、実データが
// 足りていないのに「差分0」を返してしまう。事前に長さで弾く。
function validatePixelBuffer(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  label: string,
): void {
  const required = width * height * 4;
  if (pixels.length < required) {
    throw new Error(
      `${label} buffer too small for ${width}x${height}: got ${pixels.length}, expected>=${required}`,
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
  validatePixelBuffer(design, width, height, "design");
  validatePixelBuffer(screenshot, width, height, "screenshot");

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

function residualSampleStep(width: number, height: number): number {
  return width * height > 1_000_000 ? 2 : 1;
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
): {
  dx: number;
  dy: number;
  confidence: number;
  residual: number;
  verifiedSystemUiCandidate: boolean;
} => {
  validateImageDimensions(width, height);
  validateIgnoreMask(ignoreMask, width, height);
  validateTranslationCandidates(additionalCandidates);
  if (width * height < 64) {
    const sampleStep = residualSampleStep(width, height);
    const sampledPositionCount = countSampledPositions(width, height, sampleStep, ignoreMask);
    const residual =
      sampledPositionCount === 0
        ? 0
        : scoreTranslationCandidate(
            design,
            screenshot,
            width,
            height,
            { dx: 0, dy: 0 },
            sampleStep,
            ignoreMask,
          ) / sampledPositionCount;
    return {
      dx: 0,
      dy: 0,
      confidence: sampledPositionCount === 0 ? 0 : 1,
      residual,
      verifiedSystemUiCandidate: false,
    };
  }

  let bestDx = 0;
  let bestDy = 0;
  let bestVerifiedSystemUiCandidate = false;
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
        bestVerifiedSystemUiCandidate = false;
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
  bestVerifiedSystemUiCandidate = false;
  // 大きい画像で1px刻みのまま全画素を100回以上走ると時間が持たない。
  // 細かい探索が見分けたいのは10px以内の差なので、間引いても区別はつく。
  const fineSampleStep = residualSampleStep(width, height);
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
        bestVerifiedSystemUiCandidate = false;
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
    if (
      isBetter(d, candidate.dx, candidate.dy) ||
      (candidate.source === "verified-system-ui" &&
        d === bestDiff &&
        candidate.dx === bestDx &&
        candidate.dy === bestDy)
    ) {
      bestDiff = d;
      bestDx = candidate.dx;
      bestDy = candidate.dy;
      bestVerifiedSystemUiCandidate = candidate.source === "verified-system-ui";
    }
  }

  // 間引いて数えた回数で割る。全画素数で割ると、間引いた分だけ残差が
  // 小さく出て「ほぼ一致している」と誤って読める。
  const sampledPositionCount = countSampledPositions(width, height, fineSampleStep, ignoreMask);
  const residual = sampledPositionCount === 0 ? 0 : bestDiff / sampledPositionCount;
  const offsetMagnitude = Math.sqrt(bestDx * bestDx + bestDy * bestDy);
  // 比較した画素が1つも無いのに confidence=1(完全一致相当)を返すと、
  // 根拠ゼロの判定を「確信を持って一致」と読める形で外へ出してしまう。
  // 全画素が mask されたとき(理論上のみ、通常は起きない)は 0 にする。
  const confidence =
    sampledPositionCount === 0 ? 0 : Math.max(0, 1 - offsetMagnitude / (COARSE_RANGE * Math.SQRT2));

  return {
    dx: bestDx,
    dy: bestDy,
    confidence,
    residual,
    verifiedSystemUiCandidate: bestVerifiedSystemUiCandidate,
  };
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

// preset 完全一致した回だけを system UI 補正と認める判定の前提。
// 一次比較(image-compare-service.ts)とレポート(diff-report-builder.ts)が
// 別々にこの候補幅を持つと、片方だけ変えたときに採用される候補が食い違う。
export function buildVerifiedInsetCandidates(
  verifiedSystemUiTopInset: number | undefined,
): readonly TranslationCandidate[] {
  if (verifiedSystemUiTopInset === undefined) return [];
  const candidates = [-1, 0, 1].map((delta) => ({
    dx: 0,
    dy: verifiedSystemUiTopInset + delta,
    ...(delta === 0 ? { source: "verified-system-ui" as const } : {}),
  }));
  return candidates;
}

// 倍率を報告する範囲。書き出し倍率や DPR の食い違い（2倍・3倍）は取り込み側で
// 揃えている (#436, #439)。ここで扱うのは、揃えた後に残る ±25% 程度の伸縮だけ。
export const SCALE_SEARCH_MIN = 0.8;
export const SCALE_SEARCH_MAX = 1.25;
// 粗い探索は報告する範囲よりこの比だけ外まで見る。範囲の外の伸縮 (1.3 倍や
// DPR 1.5 と 2 倍書き出しの 4/3 倍) は、範囲の中の別の倍率でも一部だけ重なって
// 平行移動より良く見える。外まで見て山が外にあれば、測れなかったと返す。
// 2倍・3倍まで広げると、繰り返し模様が別の倍率でも重なる山を拾い、範囲の中の
// 正しい倍率まで捨てることになるので、DPR 1.5 の食い違いが入る 1.5 倍で止める。
const SCALE_GUARD_RATIO = 1.2;
// 片方の軸の長さがこれより短いと、その軸は測らない。画素の整数の位置で輪郭を
// 突き合わせる以上、倍率の分解能は長さに反比例する。白地と黒地、0.82〜1.2 倍の
// 検体で片方の軸の長さを振ると、96px と 128px では誤差が 0.01 を超える種があり、
// 160px・192px・256px では最大 0.007 だった。端の種に余裕を見て 192px にする。
export const SCALE_MIN_AXIS_LENGTH = 192;
// 輪郭の多い画面 (矩形30枚の検体) で、倍率の検出結果が収まる幅 (#437)。192px 以上の
// 軸で測った値に対する目安で、保証ではない。短い軸は測らない (scaleStatus が
// "unmeasured" になる)。
export const SCALE_DETECTION_TOLERANCE = 0.01;
// 輪郭の少ない画面 (矩形6枚の検体) で見た最大の誤差に余裕を足した幅。輪郭の位置は
// 画素の整数の位置で突き合わせるので、輪郭が少ないと1本の位置ずれが倍率にそのまま出る。
// 192x300 の白地で最大 0.0207、400x300 で 0.0106 だった。相関の山の高さと輪郭の数では、
// 外れた検体と合った検体を分けられなかったので、検出を止める門にはしていない。
export const SCALE_SPARSE_SCENE_TOLERANCE = 0.025;

// 粗い探索で縮める輪郭の並びの長さ。8000px の縦長画面を1px刻みで全候補と
// 突き合わせると終わらないので、まず束ねた並びで当たりを付ける。
const SCALE_COARSE_PROFILE_LENGTH = 512;
// 倍率の刻み (対数で等間隔)。等差にすると縮小側だけ刻みが粗くなる。
const SCALE_COARSE_LOG_STEP = Math.log(1.005);
const SCALE_FINE_LOG_STEP = Math.log(1.0005);
// 重なりが短いと、端の数画素だけが偶然揃った候補が相関1に近づく。
const SCALE_MIN_OVERLAP_RATIO = 0.5;

interface AxisScaleEstimate {
  scale: number;
  offset: number;
}

/**
 * 軸に沿った輪郭の強さの並びを作る。
 *
 * 倍率は輪郭の間隔に出る。色の平均の並びだと、白地の多い画面では
 * どの倍率でも同じに見えて決まらない。隣どうしの色の差を足した並びなら、
 * 縦に伸ばしても横の輪郭の位置は変わらないので、軸ごとに独立して測れる。
 */
function buildEdgeProfile(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  axis: "x" | "y",
  ignoreMask: Uint8Array | undefined,
): Float64Array {
  const length = axis === "x" ? width : height;
  const across = axis === "x" ? height : width;
  // 直交方向は間引く。輪郭の位置を決めるのは並びの向きで、直交方向の全画素は要らない。
  const stride = residualSampleStep(width, height);
  const profile = new Float64Array(length);
  for (let along = 0; along + 1 < length; along++) {
    let sum = 0;
    for (let other = 0; other < across; other += stride) {
      const first = axis === "x" ? other * width + along : along * width + other;
      const second = axis === "x" ? first + 1 : first + width;
      if (ignoreMask && (ignoreMask[first] !== 0 || ignoreMask[second] !== 0)) continue;
      const a = first * 4;
      const b = second * 4;
      sum +=
        Math.abs(pixels[a] - pixels[b]) +
        Math.abs(pixels[a + 1] - pixels[b + 1]) +
        Math.abs(pixels[a + 2] - pixels[b + 2]);
    }
    profile[along] = sum;
  }
  // 撮影側は輪郭が中間色で2画素へ割れることがある。1画素の山どうしで比べると、
  // 半画素ずれただけで相関が崩れるので、両側を軽くならす。
  const smoothed = new Float64Array(length);
  for (let index = 0; index < length; index++) {
    const left = profile[Math.max(0, index - 1)];
    const right = profile[Math.min(length - 1, index + 1)];
    smoothed[index] = (left + 2 * profile[index] + right) / 4;
  }
  return smoothed;
}

function binProfile(profile: Float64Array, binSize: number): Float64Array {
  const binned = new Float64Array(Math.ceil(profile.length / binSize));
  for (let index = 0; index < profile.length; index++) {
    binned[Math.floor(index / binSize)] += profile[index];
  }
  return binned;
}

/**
 * 撮影側の位置 x に、設計側の位置 (x - offset) / scale の値を重ねたときの相関。
 *
 * 位置は並びの中心を原点に取る。左端を原点にすると、倍率を少し変えるだけで
 * 右端の重なりが大きく動き、倍率と平行移動を分けて探せなくなる。
 */
function scoreAxisCandidate(
  design: Float64Array,
  screenshot: Float64Array,
  scale: number,
  centeredShift: number,
): number {
  const length = screenshot.length;
  const center = length / 2;
  let count = 0;
  let sumA = 0;
  let sumB = 0;
  let sumAB = 0;
  let sumAA = 0;
  let sumBB = 0;
  for (let x = 0; x < length; x++) {
    const source = (x + 0.5 - center - centeredShift) / scale + center - 0.5;
    if (source < 0 || source > design.length - 1) continue;
    const floor = Math.floor(source);
    const fraction = source - floor;
    const next = Math.min(design.length - 1, floor + 1);
    const a = design[floor] * (1 - fraction) + design[next] * fraction;
    const b = screenshot[x];
    count++;
    sumA += a;
    sumB += b;
    sumAB += a * b;
    sumAA += a * a;
    sumBB += b * b;
  }
  if (count < length * SCALE_MIN_OVERLAP_RATIO) return Number.NEGATIVE_INFINITY;
  const varianceA = count * sumAA - sumA * sumA;
  const varianceB = count * sumBB - sumB * sumB;
  // どちらかが平らなら相関は定義できない。0 割りで NaN を候補に混ぜない。
  if (varianceA <= 0 || varianceB <= 0) return Number.NEGATIVE_INFINITY;
  return (count * sumAB - sumA * sumB) / Math.sqrt(varianceA * varianceB);
}

interface AxisSearchResult {
  logScale: number;
  centeredShift: number;
  score: number;
}

function searchAxis(
  design: Float64Array,
  screenshot: Float64Array,
  logScales: readonly number[],
  shiftCenter: number,
  shiftRange: number,
): AxisSearchResult | undefined {
  let best: AxisSearchResult | undefined;
  for (const logScale of logScales) {
    const scale = Math.exp(logScale);
    for (let shift = shiftCenter - shiftRange; shift <= shiftCenter + shiftRange; shift++) {
      const score = scoreAxisCandidate(design, screenshot, scale, shift);
      // 同点なら先に見た候補を残す。並びは倍率1・移動0に近い順にしてあるので、
      // 手がかりの無い並びでは恒等が残る。
      if (score > (best?.score ?? Number.NEGATIVE_INFINITY)) {
        best = { logScale, centeredShift: shift, score };
      }
    }
  }
  return best;
}

/**
 * -lowerLimit..upperLimit の整数を 0 から近い順に並べる。
 *
 * 探索は同点なら先に見た候補を残すので、恒等に近い順に見ておけば、
 * 手がかりの無い並びで端の倍率が選ばれることは無い。
 */
function stepsNearestFirst(lowerLimit: number, upperLimit: number): number[] {
  const steps = [0];
  for (let magnitude = 1; magnitude <= Math.max(lowerLimit, upperLimit); magnitude++) {
    if (magnitude <= upperLimit) steps.push(magnitude);
    if (magnitude <= lowerLimit) steps.push(-magnitude);
  }
  return steps;
}

/**
 * 1軸ぶんの倍率と移動量を、輪郭の並びの突き合わせで推定する。
 *
 * 2次元で倍率を2つと移動を2つ同時に探すと、実寸の画面では候補の数が
 * 掛け算で増えて終わらない。輪郭の並びは軸ごとに独立なので、1次元の探索を
 * 軸の数だけ回せば足りる。
 *
 * 測れなかった軸は undefined を返す。短すぎる軸・輪郭の無い軸・山が報告する
 * 範囲の外にある軸がそれに当たる。倍率1と返すと「測って伸縮が無かった」と
 * 区別できなくなる。
 */
function estimateAxisScale(
  designProfile: Float64Array,
  screenshotProfile: Float64Array,
): AxisScaleEstimate | undefined {
  const length = screenshotProfile.length;
  if (length < SCALE_MIN_AXIS_LENGTH) return undefined;

  const minLogScale = Math.log(SCALE_SEARCH_MIN);
  const maxLogScale = Math.log(SCALE_SEARCH_MAX);
  const guardLogRatio = Math.log(SCALE_GUARD_RATIO);
  const binSize = Math.max(1, Math.ceil(length / SCALE_COARSE_PROFILE_LENGTH));
  const coarseDesign = binProfile(designProfile, binSize);
  const coarseScreenshot = binProfile(screenshotProfile, binSize);
  const coarseLogScales = stepsNearestFirst(
    Math.floor((guardLogRatio - minLogScale) / SCALE_COARSE_LOG_STEP),
    Math.floor((maxLogScale + guardLogRatio) / SCALE_COARSE_LOG_STEP),
  ).map((step) => step * SCALE_COARSE_LOG_STEP);
  // 左上を原点に伸縮した画面では、中心から見た移動が (1-倍率)*長さ/2 まで出る。
  // それに一般の平行移動の探索幅を足した範囲を見る。
  const widestScaleDeviation = Math.max(
    1 - SCALE_SEARCH_MIN / SCALE_GUARD_RATIO,
    SCALE_SEARCH_MAX * SCALE_GUARD_RATIO - 1,
  );
  const coarseShiftRange =
    Math.ceil((coarseScreenshot.length * widestScaleDeviation) / 2) +
    Math.ceil(COARSE_RANGE / binSize) +
    1;
  const coarse = searchAxis(coarseDesign, coarseScreenshot, coarseLogScales, 0, coarseShiftRange);
  if (!coarse) return undefined;
  // 範囲の端から粗い刻み1つ分を超えて外に山があれば、本当の倍率は範囲の外にある。
  // 刻み1つ分は許す。範囲の端ちょうど (1.25 倍) の画面でも、粗い刻みの格子点は
  // 端の少し外に来ることがあるため。
  if (
    coarse.logScale > maxLogScale + SCALE_COARSE_LOG_STEP ||
    coarse.logScale < minLogScale - SCALE_COARSE_LOG_STEP
  ) {
    return undefined;
  }

  const fineSpan = Math.ceil((1.5 * SCALE_COARSE_LOG_STEP) / SCALE_FINE_LOG_STEP);
  // 細かい探索は範囲の内側に限る。外へはみ出た値を報告に載せない。
  const fineLogScales = stepsNearestFirst(fineSpan, fineSpan)
    .map((step) => coarse.logScale + step * SCALE_FINE_LOG_STEP)
    .filter((logScale) => logScale >= minLogScale && logScale <= maxLogScale);
  const fine = searchAxis(
    designProfile,
    screenshotProfile,
    fineLogScales,
    coarse.centeredShift * binSize,
    binSize + 2,
  );
  if (!fine) return undefined;

  const scale = Math.exp(fine.logScale);
  // 中心を原点にした移動を、設計の左上を原点にした写し方 x = scale*u + offset へ戻す。
  const center = length / 2;
  return { scale, offset: fine.centeredShift + center * (1 - scale) };
}

/** 撮影の位置 position に写る設計の画素の位置。設計の外なら -1。 */
function axisSource(position: number, transform: AxisScaleEstimate, length: number): number {
  const source = Math.floor((position + 0.5 - transform.offset) / transform.scale);
  return source >= 0 && source < length ? source : -1;
}

/**
 * どの写し方でも設計の内側を指す撮影の位置の範囲 [start, end)。
 *
 * 写し方は位置について単調なので、内側を指す位置は1つの区間になる。
 * 式で端を解くと丸めで1画素ずれるので、両端から直接確かめて詰める。
 */
function commonAxisRange(
  length: number,
  transforms: readonly AxisScaleEstimate[],
): { start: number; end: number } {
  const inside = (position: number) =>
    transforms.every((transform) => axisSource(position, transform, length) >= 0);
  let start = 0;
  let end = length;
  while (start < end && !inside(start)) start++;
  while (end > start && !inside(end - 1)) end--;
  return { start, end };
}

/**
 * 軸ごとの写し方の組み合わせごとに、違って見える画素を数える。
 *
 * 数えるのは、比べる全ての写し方で設計の内側を指す画素だけにする。縮めた撮影には
 * 右や下に設計の外の帯ができ、帯を数えると帯の大きい候補ほど損をする。白地の画面
 * では帯が丸ごと違いになり、正しい倍率の候補が平行移動より良く見えなくなる。
 * 同じ画素だけを数えれば、どの候補も同じ物差しで比べられる。
 *
 * 戻り値は [x の写し方][y の写し方] の数と、数えた画素の数。
 */
function countScaledMismatches(
  design: Uint8ClampedArray,
  screenshot: Uint8ClampedArray,
  width: number,
  height: number,
  xTransforms: readonly AxisScaleEstimate[],
  yTransforms: readonly AxisScaleEstimate[],
  sampleStep: number,
  ignoreMask: Uint8Array | undefined,
): { diffs: number[][]; sampled: number } {
  const xRange = commonAxisRange(width, xTransforms);
  const yRange = commonAxisRange(height, yTransforms);
  const diffs = xTransforms.map(() => yTransforms.map(() => 0));
  let sampled = 0;
  // 全体の残差と同じ格子 (原点から sampleStep 刻み) の上の点だけを数える。
  const firstX = Math.ceil(xRange.start / sampleStep) * sampleStep;
  const firstY = Math.ceil(yRange.start / sampleStep) * sampleStep;
  const xSources = xTransforms.map((transform) => {
    const sources: number[] = [];
    for (let x = firstX; x < xRange.end; x += sampleStep) {
      sources.push(axisSource(x, transform, width));
    }
    return sources;
  });
  for (let y = firstY; y < yRange.end; y += sampleStep) {
    const ySources = yTransforms.map((transform) => axisSource(y, transform, height));
    for (let x = firstX, column = 0; x < xRange.end; x += sampleStep, column++) {
      const pixel = y * width + x;
      if (ignoreMask && ignoreMask[pixel] !== 0) continue;
      sampled++;
      const bIdx = pixel * 4;
      for (let xi = 0; xi < xTransforms.length; xi++) {
        const srcX = xSources[xi][column];
        for (let yi = 0; yi < yTransforms.length; yi++) {
          const aIdx = (ySources[yi] * width + srcX) * 4;
          const dr = design[aIdx] - screenshot[bIdx];
          const dg = design[aIdx + 1] - screenshot[bIdx + 1];
          const db = design[aIdx + 2] - screenshot[bIdx + 2];
          if (dr * dr + dg * dg + db * db > DIFF_THRESHOLD_SQ) diffs[xi][yi]++;
        }
      }
    }
  }
  return { diffs, sampled };
}

interface DetectedScale {
  scale: { x: number; y: number };
  offset?: { x: number; y: number };
  status: { x: ScaleAxisStatus; y: ScaleAxisStatus };
}

const UNMEASURED_SCALE: DetectedScale = {
  scale: { x: 1, y: 1 },
  status: { x: "unmeasured", y: "unmeasured" },
};

/**
 * 平行移動・片軸・両軸の候補から、門を通った最良を選ぶ。
 *
 * diffs は countScaledMismatches の戻り値で、添字 0 が平行移動、1 が伸縮の写し方。
 * 片方の軸だけの候補は平行移動と比べ、両軸の候補はそれまでの最良と比べる。
 * 両軸を常に平行移動とだけ比べると、雑音の倍率 (1.0005 など) が片軸の結果に
 * 相乗りして報告に載る。
 */
function pickScaleCandidate(
  diffs: readonly (readonly number[])[],
  identityX: AxisScaleEstimate,
  identityY: AxisScaleEstimate,
  xScaled: AxisScaleEstimate | undefined,
  yScaled: AxisScaleEstimate | undefined,
): { x: AxisScaleEstimate; y: AxisScaleEstimate } | undefined {
  const identityDiff = diffs[0][0];
  let best: { x: AxisScaleEstimate; y: AxisScaleEstimate } | undefined;
  let bestDiff = identityDiff;
  const singles: { x: AxisScaleEstimate; y: AxisScaleEstimate; diff: number }[] = [];
  if (xScaled) singles.push({ x: xScaled, y: identityY, diff: diffs[1][0] });
  if (yScaled) singles.push({ x: identityX, y: yScaled, diff: diffs[0][1] });
  for (const single of singles) {
    if (single.diff < identityDiff * ALIGNMENT_IMPROVEMENT_THRESHOLD && single.diff < bestDiff) {
      best = { x: single.x, y: single.y };
      bestDiff = single.diff;
    }
  }
  if (xScaled && yScaled && diffs[1][1] < bestDiff * ALIGNMENT_IMPROVEMENT_THRESHOLD) {
    return { x: xScaled, y: yScaled };
  }
  return best;
}

/**
 * 平行移動では説明しきれない伸縮を軸ごとに検出する。
 *
 * 輪郭の並びで当たりを付け、採るかどうかは平行移動と同じ「違って見える画素の数」で
 * 決める。相関だけで採ると、伸縮していない画面でも 1.003 のような雑音の倍率が
 * 毎回報告に載る。平行移動の適用と同じく 15% 以上減るときだけ採る。
 * 片方の軸だけの候補は平行移動と比べ、両軸の候補はそれまでの最良と比べる。
 */
function detectScale(
  design: Uint8ClampedArray,
  screenshot: Uint8ClampedArray,
  width: number,
  height: number,
  translation: { dx: number; dy: number },
  sampleStep: number,
  ignoreMask: Uint8Array | undefined,
): DetectedScale {
  const xEstimate = estimateAxisScale(
    buildEdgeProfile(design, width, height, "x", ignoreMask),
    buildEdgeProfile(screenshot, width, height, "x", ignoreMask),
  );
  const yEstimate = estimateAxisScale(
    buildEdgeProfile(design, width, height, "y", ignoreMask),
    buildEdgeProfile(screenshot, width, height, "y", ignoreMask),
  );
  const status: DetectedScale["status"] = {
    x: xEstimate ? "none" : "unmeasured",
    y: yEstimate ? "none" : "unmeasured",
  };
  const identity: DetectedScale = { scale: { x: 1, y: 1 }, status };
  const xScaled = xEstimate !== undefined && xEstimate.scale !== 1 ? xEstimate : undefined;
  const yScaled = yEstimate !== undefined && yEstimate.scale !== 1 ? yEstimate : undefined;
  if (!xScaled && !yScaled) return identity;

  const identityX = { scale: 1, offset: translation.dx };
  const identityY = { scale: 1, offset: translation.dy };
  const xTransforms = xScaled ? [identityX, xScaled] : [identityX];
  const yTransforms = yScaled ? [identityY, yScaled] : [identityY];
  const { diffs, sampled } = countScaledMismatches(
    design,
    screenshot,
    width,
    height,
    xTransforms,
    yTransforms,
    sampleStep,
    ignoreMask,
  );
  // 全ての候補で内側を指す画素が少ないと、残った端の数画素の一致で決まってしまう。
  // そのときは伸縮のある軸を測れなかったとする。
  const sampledPositions = countSampledPositions(width, height, sampleStep, ignoreMask);
  if (sampled === 0 || sampled < sampledPositions * SCALE_MIN_OVERLAP_RATIO) {
    return {
      scale: { x: 1, y: 1 },
      status: {
        x: xScaled ? "unmeasured" : status.x,
        y: yScaled ? "unmeasured" : status.y,
      },
    };
  }

  const best = pickScaleCandidate(diffs, identityX, identityY, xScaled, yScaled);
  if (!best) return identity;
  // 探索の刻みより細かい桁は測れていない。雑音の桁を報告に残さない。
  return {
    scale: { x: roundTo(best.x.scale, 4), y: roundTo(best.y.scale, 4) },
    offset: { x: roundTo(best.x.offset, 2), y: roundTo(best.y.offset, 2) },
    status: {
      x: best.x.scale !== 1 ? "detected" : status.x,
      y: best.y.scale !== 1 ? "detected" : status.y,
    },
  };
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export interface RegionResidualInput {
  regionId: string;
  bbox: { x: number; y: number; w: number; h: number };
}

/**
 * 領域ごとに、位置合わせ後に違って見える画素の割合を測る。
 *
 * 全体の残差 (alignment.residual) と同じ物差しにする。同じ画素の間引き方・
 * 同じしきい値・同じ ignoreMask の扱いにしないと、領域の値と全体の値を
 * 並べて読めない。採点に使う画素 (適用後の設計) を渡す前提で、ずらさずに数える。
 *
 * appliedTranslation には、適用した平行移動 (適用しなかった回は渡さない) を渡す。
 * 設計を動かした回は、動かした側の縁に設計の無い帯ができる (shiftPixels が透明で
 * 埋める)。帯は平行移動で説明済みの差なので、分子にも分母にも入れない。入れると、
 * 縁に接する領域だけが、平行移動で説明しきれたのに大きい残差に見える。
 *
 * 測れる画素が1つも無い領域は載せない。0 と書くと「一致した」と読める。
 */
export const computeRegionResiduals = (
  designPixels: Uint8ClampedArray,
  screenshotPixels: Uint8ClampedArray,
  width: number,
  height: number,
  regions: readonly RegionResidualInput[],
  ignoreMask?: Uint8Array,
  appliedTranslation?: { x: number; y: number },
): { regionId: string; residual: number }[] => {
  validateImageDimensions(width, height);
  validateIgnoreMask(ignoreMask, width, height);
  validatePixelBuffer(designPixels, width, height, "design");
  validatePixelBuffer(screenshotPixels, width, height, "screenshot");

  const shiftX = appliedTranslation?.x ?? 0;
  const shiftY = appliedTranslation?.y ?? 0;
  if (!Number.isInteger(shiftX) || !Number.isInteger(shiftY)) {
    throw new Error(`appliedTranslation must use integer pixels: x=${shiftX}, y=${shiftY}`);
  }
  // shiftPixels は srcX = x - dx なので、dx > 0 なら左端、dx < 0 なら右端が空く。
  const validLeft = Math.max(0, shiftX);
  const validRight = Math.min(width, width + shiftX);
  const validTop = Math.max(0, shiftY);
  const validBottom = Math.min(height, height + shiftY);

  const sampleStep = residualSampleStep(width, height);
  const residuals: { regionId: string; residual: number }[] = [];
  for (const region of regions) {
    const { x, y, w, h } = region.bbox;
    if (![x, y, w, h].every(Number.isFinite)) {
      throw new Error(
        `region bbox must be finite: regionId=${region.regionId}, x=${x}, y=${y}, w=${w}, h=${h}`,
      );
    }
    // 採点 (computeSsimForRegion など) と同じく、領域に掛かる画素を全て含める。
    const left = Math.max(validLeft, Math.floor(x));
    const top = Math.max(validTop, Math.floor(y));
    const right = Math.min(validRight, Math.ceil(x + w));
    const bottom = Math.min(validBottom, Math.ceil(y + h));
    if (right <= left || bottom <= top) continue;
    // 全体の残差と同じ格子 (原点から sampleStep 刻み) の上の点だけを数える。
    // 領域の左上から刻み直すと、隣り合う領域で同じ画素を二度数えたり飛ばしたりする。
    let counted = countRegionMismatch(
      designPixels,
      screenshotPixels,
      width,
      { left, top, right, bottom },
      sampleStep,
      ignoreMask,
    );
    // 1画素幅の領域は格子の点を1つも含まないことがある。格子に乗らないだけで
    // 測れる画素はあるので、その領域だけ全画素で数える。
    if (counted.sampled === 0 && sampleStep > 1) {
      counted = countRegionMismatch(
        designPixels,
        screenshotPixels,
        width,
        { left, top, right, bottom },
        1,
        ignoreMask,
      );
    }
    if (counted.sampled === 0) continue;
    residuals.push({ regionId: region.regionId, residual: counted.diff / counted.sampled });
  }
  return residuals;
};

function countRegionMismatch(
  designPixels: Uint8ClampedArray,
  screenshotPixels: Uint8ClampedArray,
  width: number,
  bounds: { left: number; top: number; right: number; bottom: number },
  sampleStep: number,
  ignoreMask: Uint8Array | undefined,
): { sampled: number; diff: number } {
  let sampled = 0;
  let diff = 0;
  const firstY = Math.ceil(bounds.top / sampleStep) * sampleStep;
  const firstX = Math.ceil(bounds.left / sampleStep) * sampleStep;
  for (let py = firstY; py < bounds.bottom; py += sampleStep) {
    for (let px = firstX; px < bounds.right; px += sampleStep) {
      const pixel = py * width + px;
      if (ignoreMask && ignoreMask[pixel] !== 0) continue;
      sampled++;
      const offset = pixel * 4;
      const dr = designPixels[offset] - screenshotPixels[offset];
      const dg = designPixels[offset + 1] - screenshotPixels[offset + 1];
      const db = designPixels[offset + 2] - screenshotPixels[offset + 2];
      if (dr * dr + dg * dg + db * db > DIFF_THRESHOLD_SQ) diff++;
    }
  }
  return { sampled, diff };
}

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
  validateImageDimensions(width, height);
  const { dx, dy, confidence, residual, verifiedSystemUiCandidate } = detectTranslation(
    designPixels,
    screenshotPixels,
    width,
    height,
    ignoreMask,
    additionalCandidates,
  );

  let alignedDesignPixels = designPixels;
  let applied = false;
  // scoreTranslationCandidate と同じOOB非罰則の不一致数を、既存 residual と
  // 同じくサンプル1点あたりへ正規化して記録する。raw countや別の罰則を
  // 混ぜると、候補スコアとの比較ができない。
  const residualStep = residualSampleStep(width, height);
  const residualSampleCount = countSampledPositions(width, height, residualStep, ignoreMask);
  const baselineResidual =
    residualSampleCount === 0
      ? undefined
      : scoreTranslationCandidate(
          designPixels,
          screenshotPixels,
          width,
          height,
          { dx: 0, dy: 0 },
          residualStep,
          ignoreMask,
        ) / residualSampleCount;
  const correctedDiff =
    residualSampleCount === 0
      ? undefined
      : scoreTranslationCandidate(
          designPixels,
          screenshotPixels,
          width,
          height,
          { dx, dy },
          residualStep,
          ignoreMask,
        );
  const correctedResidual =
    correctedDiff === undefined ? undefined : correctedDiff / residualSampleCount;
  // 倍率は検出して報告するだけで、適用する画素には使わない。後段の採点窓の
  // 切り取りや対象ノードの移動は平行移動だけを前提にしており、伸縮した画素を
  // 渡すと、そこで合否が黙って変わる (#437)。
  const detectedScale =
    correctedDiff === undefined
      ? UNMEASURED_SCALE
      : detectScale(
          designPixels,
          screenshotPixels,
          width,
          height,
          { dx, dy },
          residualStep,
          ignoreMask,
        );
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
      source:
        dx === 0 && dy === 0
          ? "none"
          : verifiedSystemUiCandidate && applied
            ? "verified-system-ui"
            : "auto",
      scale: detectedScale.scale,
      ...(detectedScale.offset ? { scaleOffset: detectedScale.offset } : {}),
      scaleStatus: detectedScale.status,
      rotation: 0,
      confidence,
      residual,
      baselineResidual,
      correctedResidual,
      applied,
    },
    alignedDesignPixels,
    applied,
  };
};

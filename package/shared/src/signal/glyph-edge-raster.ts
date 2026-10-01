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
// 背景色の一致判定だけは±4chまで許す。前景のピクセル一致とブレンド
//      検証は CHANNEL_TOLERANCE=1 のまま厳格に行う。実際の色トークン違いは
//      Δ5以上で発生するが、同トークンのグラデーションは端点スパンや補間
//      実装の差で同じ場所が±3-4chずれることがある (white→#EFF8F2 系)。
const BACKGROUND_CHANNEL_TOLERANCE = 4;
// 支配被覆の下限は0.3。二値化した上で最頻ビンが3割を占めれば支配色と
//      呼べる。細いグリフが縁リングまで食い込む密テキスト帯では0.4だと
//      系統的にリング被覆を割り込んで「背景なし」誤判定になる。
const MIN_BACKGROUND_COVERAGE = 0.3;
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

// なぜ量子化するか: 実機/Skia 由来のスクリーンショットの背景には
//      ±1-2ch の微細なディザが混入することが多い。完全一致で集計すると
//      支配色の支持率が40%前後へ割れて「背景なし」と誤判定するため
//      偶数ビンへ畳んで数える。代表色はビン内の実色平均を使う。
const BACKGROUND_BIN = 2;
const binKey = (color: readonly number[]): string =>
  `${Math.floor(color[0] / BACKGROUND_BIN)},${Math.floor(
    color[1] / BACKGROUND_BIN,
  )},${Math.floor(color[2] / BACKGROUND_BIN)}`;

const dominantColor = (
  pixels: Uint8ClampedArray,
  width: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
  borderOnly: boolean,
  ignoreMask?: Uint8Array,
): { color: [number, number, number]; coverage: number } | undefined => {
  const counts = new Map<string, { sum: [number, number, number]; count: number }>();
  let sampleCount = 0;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      if (borderOnly && x !== left && x !== right - 1 && y !== top && y !== bottom - 1) continue;
      const pixelIndex = y * width + x;
      if (ignoreMask?.[pixelIndex]) continue;
      const color = colorAt(pixels, pixelIndex);
      const key = binKey(color);
      const current = counts.get(key);
      counts.set(key, {
        sum: current
          ? [current.sum[0] + color[0], current.sum[1] + color[1], current.sum[2] + color[2]]
          : [color[0], color[1], color[2]],
        count: (current?.count ?? 0) + 1,
      });
      sampleCount++;
    }
  }
  if (sampleCount === 0) return undefined;
  const dominant = [...counts.values()].sort((a, b) => b.count - a.count)[0];
  return {
    color: [
      Math.round(dominant.sum[0] / dominant.count),
      Math.round(dominant.sum[1] / dominant.count),
      Math.round(dominant.sum[2] / dominant.count),
    ],
    coverage: dominant.count / sampleCount,
  };
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
  halo: number = HALO_PX,
): RasterWindow | undefined => {
  const window = {
    left: Math.max(0, Math.floor(bbox.x) - halo),
    top: Math.max(0, Math.floor(bbox.y) - halo),
    right: Math.min(width, Math.ceil(bbox.x + bbox.w) + halo),
    bottom: Math.min(height, Math.ceil(bbox.y + bbox.h) + halo),
  };
  return window.right - window.left >= 3 && window.bottom - window.top >= 3 ? window : undefined;
};

// 背景の支配推定は縁リングが第一候補だが、グリフがリングを占めると
//      前景色が支配として返ってしまう。真の背景は窓全体でも支配的な
//      はずなので、リング支配は窓全体支配と色が一致する時だけ採用し、
//      それ以外では窓全体支配に退く (被覆が足りなければ推定自体を捨てる)。
const MIN_FULLWINDOW_BACKGROUND_COVERAGE = 0.4;

export const resolveMatchingBackground = (
  designPixels: Uint8ClampedArray,
  screenshotPixels: Uint8ClampedArray,
  width: number,
  window: RasterWindow,
  ignoreMask?: Uint8Array,
): [number, number, number] | undefined => {
  const args = [width, window.left, window.top, window.right, window.bottom] as const;
  const crossMatch = (
    design: { color: [number, number, number]; coverage: number } | undefined,
    screenshot: { color: [number, number, number]; coverage: number } | undefined,
    minCoverage: number,
  ): [number, number, number] | undefined => {
    if (!design || !screenshot) return undefined;
    if (design.coverage < minCoverage || screenshot.coverage < minCoverage) {
      return undefined;
    }
    return maxChannelDelta(design.color, screenshot.color) <= BACKGROUND_CHANNEL_TOLERANCE
      ? design.color
      : undefined;
  };
  const designRing = dominantColor(designPixels, ...args, true, ignoreMask);
  const screenshotRing = dominantColor(screenshotPixels, ...args, true, ignoreMask);
  const designWindow = dominantColor(designPixels, ...args, false, ignoreMask);
  const screenshotWindow = dominantColor(screenshotPixels, ...args, false, ignoreMask);
  const ringSupported =
    designRing &&
    designWindow &&
    screenshotRing &&
    screenshotWindow &&
    maxChannelDelta(designRing.color, designWindow.color) <= BACKGROUND_CHANNEL_TOLERANCE &&
    maxChannelDelta(screenshotRing.color, screenshotWindow.color) <= BACKGROUND_CHANNEL_TOLERANCE;
  const ring = ringSupported
    ? crossMatch(designRing, screenshotRing, MIN_BACKGROUND_COVERAGE)
    : undefined;
  if (ring) return ring;
  return crossMatch(designWindow, screenshotWindow, MIN_FULLWINDOW_BACKGROUND_COVERAGE);
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
// 証明枠は差分の周辺文脈を見るための窓で、細い stem が縁を占める小窓では
// 背景支配率・インク量差・前景極値が実体より悪く出て証明が崩れる。
// 窓の大きさ自体は証明の意味論に関与しないので、失敗時は段階的に広げて
// 再証明する (designdiff#232)。先に小さい窓を試すため既存の証明済み領域の
// 判定は変わらない。
// halo は段階的に広げる。小さい窓ほどグリフがリングに食い込み背景
//      推定が失敗しやすい。12px までは隣接要素の誤取込を許容範囲内と
//      みなし、それ以上は行間の別要素を吸い込むため広げない。
const SAME_TOKEN_HALO_CANDIDATES = [HALO_PX, 4, 6, 8, 12] as const;

// 前景トークンの推定は最深3画素の平均。1px未満の細いストロークはAAで
//      最深画素すら真のトークン色に届かず、単一極値だとレンダラ差が
//      そのままトークン差に誤判定される (fig 133 vs app 156 で 24 を越える)。
//      3点平均は真のトークン差 (34ch 級) と描画上の被覆差を分離する。
const FOREGROUND_EXTREME_TOPK = 3;

export const foregroundExtreme = (
  pixels: Uint8ClampedArray,
  width: number,
  window: RasterWindow,
  background: readonly number[],
  ignoreMask?: Uint8Array,
): number[] | undefined => {
  const top: { score: number; color: number[] }[] = [];
  for (let y = window.top; y < window.bottom; y++) {
    for (let x = window.left; x < window.right; x++) {
      const index = y * width + x;
      if (ignoreMask?.[index]) continue;
      const color = colorAt(pixels, index);
      const contrast = maxChannelDelta(background, color);
      if (top.length < FOREGROUND_EXTREME_TOPK || contrast > top[top.length - 1].score) {
        top.push({ score: contrast, color: [...color] });
        top.sort((a, b) => b.score - a.score);
        if (top.length > FOREGROUND_EXTREME_TOPK) top.length = FOREGROUND_EXTREME_TOPK;
      }
    }
  }
  const deepest = top[0];
  if (!deepest || deepest.score < MIN_FOREGROUND_CONTRAST) return undefined;
  return [
    Math.round(top.reduce((s, e) => s + e.color[0], 0) / top.length),
    Math.round(top.reduce((s, e) => s + e.color[1], 0) / top.length),
    Math.round(top.reduce((s, e) => s + e.color[2], 0) / top.length),
  ];
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
const classifySameTokenRasterizationAtHalo = (
  designPixels: Uint8ClampedArray,
  screenshotPixels: Uint8ClampedArray,
  width: number,
  height: number,
  bbox: DiffBoundingBox,
  halo: number,
  ignoreMask?: Uint8Array,
): SameTokenRasterEvidence | undefined => {
  const window = resolveRasterWindow(width, height, bbox, halo);
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
  // 両側のインク量が0なら 0/0 で NaN になる。差が無いものとして0扱いにする。
  const inkDelta = Math.abs(designInk - screenshotInk) / Math.max(designInk, screenshotInk, 1e-9);
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
  for (const halo of SAME_TOKEN_HALO_CANDIDATES) {
    const evidence = classifySameTokenRasterizationAtHalo(
      designPixels,
      screenshotPixels,
      width,
      height,
      bbox,
      halo,
      ignoreMask,
    );
    if (evidence) return evidence;
  }
  return undefined;
};

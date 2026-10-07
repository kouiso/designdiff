import { computeShiftTolerantHausdorff } from "./hausdorff.js";

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
  // 証明に使ったインク量差の上限。トポロジ強一致の窓では緩和閾値になるので
  // 発行する診断の threshold にはこの値を使う。
  inkLimit: number;
  // 4拘束はどれも平行移動に不変なので、証明は「同じ内容物が数pxずれた」
  // 配置まで通す。実測の Figma 正本 vs 実機撮影では目視で受け入れ済みの
  // 画面でも 3-4px の局所ずれが普通に出るため、ずれ量で証明を落とすと
  // 受け入れ済み画面が FAIL に戻る。証明は維持し、ずれ量を証拠として残す。
  contentOffset?: ContentOffset;
}

export interface ContentOffset {
  // screenshot 側の内容物が design 側から (dx, dy) だけ動いている。
  dx: number;
  dy: number;
  // 最良オフセットでのインク分布の正規化相互相関 (-1..1)。
  peak: number;
  // argmax が探索端に張り付いた軸ごとに true。その軸の真のずれは報告値以上の可能性がある。
  clippedX?: boolean;
  clippedY?: boolean;
  // argmax とほぼ同強度の別極大があるとき true。周期コンテンツのエイリアスで
  // どのピークが真の移動か決まらず、値を主張しない。
  ambiguous?: boolean;
}

// 前景トークンは両画像で同一色名である必要があるが、ラスタライザ差で数値は僅かに揺れる。
export const FOREGROUND_TOKEN_TOLERANCE = 24;
// 1px でも色相ズレが混ざったら別トークンとみなし、このクラスでは説明しない。
export const RASTER_BLEND_RESIDUAL = 16;
// 同じ太さの文字列が別ラスタライザで描かれたときのインク量差はせいぜい±15%。
// 太さ違い (Regular↔Bold で約30%)・文字欠落はこれを越えるので 0.25 で切る。
const MAX_INK_COVERAGE_DELTA = 0.25;
// トポロジが強一致する窓に限りインク量差を 0.35 まで許す。縁の位置が同一なのに
// インク量だけが増えるのは、フォント版違いや合成太字処理で同じグリフが
// 太く描かれたラスタライザ差 (例: Figma 側 SemiBold と同梱 Inter-SemiBold.ttf の
// stem 差で約30%)。太さ違いの実害は stem の中心がずれてトポロジ側で弾く。
const TIGHT_TOPOLOGY_SHAPE = 0.12;
const RELAXED_INK_COVERAGE_DELTA = 0.35;
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

// ずれ量の探索幅。真のずれがこれを越えても、領域対角で正規化するシフト許容
// ハウスドルフでは証明が通りうる。その場合 argmax は探索端に張り付くので、
// 推定値は下限として clipped 印を付けて返す。
export const CONTENT_OFFSET_SEARCH_PX = 4;

// argmax のローブ外にそこそこ強い「別極大」があると、周期コンテンツの
// エイリアスでどれが真の移動か窓内では判別できない。探索端へ向かう
// 立ち上がり斜面は同じピークの側面なので、近傍内の局所最大だけを数える。
const OFFSET_ALIAS_RATIO = 0.5;
// 別極大が見つからなくても窓内コンテンツ自体が強周期を持つならずれ量は
// 周期の剰余でしか決まらない。エイリアス対が両方探索幅の外に逃げると
// 別極大が存在しないため、design 同士の自己相関でも周期を検出する。
const OFFSET_PERIODIC_MIN = 0.85;

const isLocalMaxInGrid = (scores: Float64Array, dx: number, dy: number): boolean => {
  const span = CONTENT_OFFSET_SEARCH_PX * 2 + 1;
  const score = scores[(dy + CONTENT_OFFSET_SEARCH_PX) * span + dx + CONTENT_OFFSET_SEARCH_PX];
  if (Number.isNaN(score)) return false;
  for (let ny = dy - 1; ny <= dy + 1; ny++) {
    for (let nx = dx - 1; nx <= dx + 1; nx++) {
      if (nx === dx && ny === dy) continue;
      if (
        nx < -CONTENT_OFFSET_SEARCH_PX ||
        nx > CONTENT_OFFSET_SEARCH_PX ||
        ny < -CONTENT_OFFSET_SEARCH_PX ||
        ny > CONTENT_OFFSET_SEARCH_PX
      )
        continue;
      const neighbor =
        scores[(ny + CONTENT_OFFSET_SEARCH_PX) * span + nx + CONTENT_OFFSET_SEARCH_PX];
      if (!Number.isNaN(neighbor) && neighbor > score) return false;
    }
  }
  return true;
};

const secondPeakScore = (scores: Float64Array, bestDx: number, bestDy: number): number => {
  const span = CONTENT_OFFSET_SEARCH_PX * 2 + 1;
  let secondBest = Number.NEGATIVE_INFINITY;
  for (let dy = -CONTENT_OFFSET_SEARCH_PX; dy <= CONTENT_OFFSET_SEARCH_PX; dy++) {
    for (let dx = -CONTENT_OFFSET_SEARCH_PX; dx <= CONTENT_OFFSET_SEARCH_PX; dx++) {
      if (Math.max(Math.abs(dx - bestDx), Math.abs(dy - bestDy)) < 2) continue;
      const score = scores[(dy + CONTENT_OFFSET_SEARCH_PX) * span + dx + CONTENT_OFFSET_SEARCH_PX];
      if (!Number.isNaN(score) && isLocalMaxInGrid(scores, dx, dy) && score > secondBest)
        secondBest = score;
    }
  }
  return secondBest;
};

const hasPeriodicContent = (selfCorrelate: (dx: number, dy: number) => number): boolean => {
  // ベタ面の高原状自己相関を弾くため厳密な局所最大だけを周期とみなす。
  const periodicSpan = CONTENT_OFFSET_SEARCH_PX * 2;
  const selfScores = new Map<number, number>();
  const selfAt = (dx: number, dy: number): number => {
    const key = (dy + 16) * 33 + dx + 16;
    let cached = selfScores.get(key);
    if (cached === undefined) {
      cached = selfCorrelate(dx, dy);
      selfScores.set(key, cached);
    }
    return cached;
  };
  const strictLocalMax = (dx: number, dy: number, score: number): boolean => {
    for (let ny = dy - 1; ny <= dy + 1; ny++) {
      for (let nx = dx - 1; nx <= dx + 1; nx++) {
        if (nx === dx && ny === dy) continue;
        const neighbor = nx === 0 && ny === 0 ? 1 : selfAt(nx, ny);
        if (!Number.isNaN(neighbor) && neighbor >= score) return false;
      }
    }
    return true;
  };
  for (let dy = -periodicSpan; dy <= periodicSpan; dy++) {
    for (let dx = -periodicSpan; dx <= periodicSpan; dx++) {
      if (dx === 0 && dy === 0) continue;
      const score = selfAt(dx, dy);
      if (!Number.isNaN(score) && score >= OFFSET_PERIODIC_MIN && strictLocalMax(dx, dy, score))
        return true;
    }
  }
  return false;
};

const detectAmbiguousOffset = (
  scores: Float64Array,
  best: number,
  bestDx: number,
  bestDy: number,
  selfCorrelate: (dx: number, dy: number) => number,
): boolean =>
  secondPeakScore(scores, bestDx, bestDy) >= best * OFFSET_ALIAS_RATIO ||
  ((bestDx !== 0 || bestDy !== 0) && hasPeriodicContent(selfCorrelate));

// 窓内のインク分布 (bg→fg 軸上の alpha) を正規化相互相関で突き合わせ、
// screenshot 側の内容物がどれだけ平行移動しているかを推定する。AA の被覆差は
// 相関ピークの位置を動かさず、内容物の移動だけがピークを中心から離す。
// 窓全体の相関なので、動かなかった塊が大きい窓ではずれを過小推定する。
export const estimateContentOffset = (
  designPixels: Uint8ClampedArray,
  screenshotPixels: Uint8ClampedArray,
  width: number,
  window: RasterWindow,
  background: readonly number[],
  designForeground: readonly number[],
  screenshotForeground: readonly number[],
  ignoreMask?: Uint8Array,
): ContentOffset | undefined => {
  const w = window.right - window.left;
  const h = window.bottom - window.top;
  const design = new Float64Array(w * h);
  const shot = new Float64Array(w * h);
  const valid = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const index = (window.top + y) * width + window.left + x;
      if (ignoreMask?.[index]) continue;
      const i = y * w + x;
      valid[i] = 1;
      design[i] = blendAlphaAndResidual(
        colorAt(designPixels, index),
        background,
        designForeground,
      ).alpha;
      shot[i] = blendAlphaAndResidual(
        colorAt(screenshotPixels, index),
        background,
        screenshotForeground,
      ).alpha;
    }
  }

  const span = CONTENT_OFFSET_SEARCH_PX * 2 + 1;
  const scores = new Float64Array(span * span).fill(Number.NaN);
  const correlate = (dx: number, dy: number, shifted: Float64Array = shot): number => {
    let count = 0;
    let sumD = 0;
    let sumS = 0;
    let sumDD = 0;
    let sumSS = 0;
    let sumDS = 0;
    for (let y = Math.max(0, -dy); y < Math.min(h, h - dy); y++) {
      for (let x = Math.max(0, -dx); x < Math.min(w, w - dx); x++) {
        const i = y * w + x;
        const j = (y + dy) * w + x + dx;
        if (!valid[i] || !valid[j]) continue;
        const d = design[i];
        const s = shifted[j];
        count++;
        sumD += d;
        sumS += s;
        sumDD += d * d;
        sumSS += s * s;
        sumDS += d * s;
      }
    }
    if (count < 4) return Number.NaN;
    const varD = sumDD - (sumD * sumD) / count;
    const varS = sumSS - (sumS * sumS) / count;
    if (varD <= 1e-9 || varS <= 1e-9) return Number.NaN;
    return (sumDS - (sumD * sumS) / count) / Math.sqrt(varD * varS);
  };

  let best = Number.NEGATIVE_INFINITY;
  let bestDx = 0;
  let bestDy = 0;
  for (let dy = -CONTENT_OFFSET_SEARCH_PX; dy <= CONTENT_OFFSET_SEARCH_PX; dy++) {
    for (let dx = -CONTENT_OFFSET_SEARCH_PX; dx <= CONTENT_OFFSET_SEARCH_PX; dx++) {
      const score = correlate(dx, dy);
      scores[(dy + CONTENT_OFFSET_SEARCH_PX) * span + dx + CONTENT_OFFSET_SEARCH_PX] = score;
      if (Number.isNaN(score)) continue;
      // 同点なら小さい移動を採る。移動ゼロで説明できるものを動いたとは言わない。
      const closer = dx * dx + dy * dy < bestDx * bestDx + bestDy * bestDy;
      if (score > best + 1e-12 || (Math.abs(score - best) <= 1e-12 && closer)) {
        best = score;
        bestDx = dx;
        bestDy = dy;
      }
    }
  }
  if (!Number.isFinite(best)) return undefined;

  const ambiguous =
    best > 0 &&
    detectAmbiguousOffset(scores, best, bestDx, bestDy, (dx, dy) => correlate(dx, dy, design));

  const scoreAt = (dx: number, dy: number): number =>
    Math.abs(dx) > CONTENT_OFFSET_SEARCH_PX || Math.abs(dy) > CONTENT_OFFSET_SEARCH_PX
      ? Number.NaN
      : scores[(dy + CONTENT_OFFSET_SEARCH_PX) * span + dx + CONTENT_OFFSET_SEARCH_PX];
  // 整数ピークの両隣で放物線を当ててサブピクセルに詰める。両隣が測れない
  // (探索端・評価不能) ときは整数値のまま返す。
  const refine = (center: number, left: number, right: number): number => {
    if (Number.isNaN(left) || Number.isNaN(right)) return center;
    const curvature = left - 2 * best + right;
    if (curvature >= -1e-9) return center;
    return center + Math.max(-0.5, Math.min(0.5, (left - right) / (2 * curvature)));
  };
  const round = (value: number): number => Math.round(value * 100) / 100;
  const clippedX = Math.abs(bestDx) === CONTENT_OFFSET_SEARCH_PX;
  const clippedY = Math.abs(bestDy) === CONTENT_OFFSET_SEARCH_PX;
  return {
    dx: round(refine(bestDx, scoreAt(bestDx - 1, bestDy), scoreAt(bestDx + 1, bestDy))),
    dy: round(refine(bestDy, scoreAt(bestDx, bestDy - 1), scoreAt(bestDx, bestDy + 1))),
    peak: round(best),
    ...(clippedX ? { clippedX: true } : {}),
    ...(clippedY ? { clippedY: true } : {}),
    ...(ambiguous ? { ambiguous: true } : {}),
  };
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
  effectiveShape: number,
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
  const inkLimit =
    effectiveShape <= TIGHT_TOPOLOGY_SHAPE ? RELAXED_INK_COVERAGE_DELTA : MAX_INK_COVERAGE_DELTA;
  // NaN は比較が常に false になり上限判定を素通りし、スキーマ検証で比較全体を落とす。
  if (!Number.isFinite(inkDelta) || inkDelta > inkLimit) return undefined;

  const changedPixelCount = countChangedPixels(
    designPixels,
    screenshotPixels,
    width,
    window,
    ignoreMask,
  );
  if (changedPixelCount === 0) return undefined;

  const contentOffset = estimateContentOffset(
    designPixels,
    screenshotPixels,
    width,
    window,
    background,
    designForeground,
    screenshotForeground,
    ignoreMask,
  );

  return {
    classification: "same-token-rasterization",
    changedPixelCount,
    backgroundHex: toHex(background),
    foregroundHex: toHex(designForeground),
    inkCoverageDelta: inkDelta,
    inkLimit,
    ...(contentOffset ? { contentOffset } : {}),
  };
};

// 平行移動を除いたトポロジ判定を許す探索幅。ラスタライザ差や座標丸めで
// 要素全体が ±数px ずれるだけなら形状は同一とみなす。
const SAME_TOKEN_TOPOLOGY_SHIFT_PX = 3;

export const classifySameTokenRasterization = (
  designPixels: Uint8ClampedArray,
  screenshotPixels: Uint8ClampedArray,
  width: number,
  height: number,
  bbox: DiffBoundingBox,
  topologyShape: number,
  ignoreMask?: Uint8Array,
): SameTokenRasterEvidence | undefined => {
  let effectiveShape = topologyShape;
  if (topologyShape > MAX_TOPOLOGY_SHAPE) {
    // 生のトポロジが門を割るときは、平行移動を除いた形状差で再判定する。
    // 評価窓は最大 halo。小窓だと移動したストロークの輪郭点が窓縁で切れて
    // 形状差が実体より大きく出るため、最も文脈を含む窓で一度だけ試す。
    const tolerantWindow = resolveRasterWindow(
      width,
      height,
      bbox,
      SAME_TOKEN_HALO_CANDIDATES[SAME_TOKEN_HALO_CANDIDATES.length - 1],
    );
    if (tolerantWindow === undefined) return undefined;
    effectiveShape = computeShiftTolerantHausdorff(
      designPixels,
      screenshotPixels,
      width,
      height,
      {
        x: tolerantWindow.left,
        y: tolerantWindow.top,
        w: tolerantWindow.right - tolerantWindow.left,
        h: tolerantWindow.bottom - tolerantWindow.top,
      },
      ignoreMask,
      SAME_TOKEN_TOPOLOGY_SHIFT_PX,
    );
    if (effectiveShape > MAX_TOPOLOGY_SHAPE) return undefined;
  }
  for (const halo of SAME_TOKEN_HALO_CANDIDATES) {
    const evidence = classifySameTokenRasterizationAtHalo(
      designPixels,
      screenshotPixels,
      width,
      height,
      bbox,
      halo,
      effectiveShape,
      ignoreMask,
    );
    if (evidence) return evidence;
  }
  return undefined;
};

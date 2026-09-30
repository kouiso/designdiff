// テキストブロックの行折り返し差分の分類。
//
// WHY: 同一フォント・同一文字列・同じカラム幅でも、ラスタライザごとの
//      グリフ進行量の測定差 (Skia と Figma の描画器) で行の折り返し位置が
//      ずれる。グリフが次の行へ移ると「どの平行移動でも説明できない」差分に
//      なるため、同一トークン分類 (glyph-edge-raster のトポロジ拘束) でも
//      弾かれる。折り返し位置は描画器の測定実装依存で、アプリ側の実装誤り
//      ではない (designdiff#230)。
//      証明にはトポロジではなく、テキストブロック全体で保存される不変量を
//      使う: 同一 bg/fg トークン・総インク量・行バンド数・インク連結成分数
//      (グリフ片数)。文字列の置換は連結成分数とインク量で弾く。

import {
  type RasterWindow,
  colorAt,
  countChangedPixels,
  foregroundExtreme,
  inkCoverage,
  isOnAxisBlend,
  blendAlphaAndResidual,
  maxChannelDelta,
  resolveMatchingBackground,
  toHex,
  FOREGROUND_TOKEN_TOLERANCE,
} from "./glyph-edge-raster.js";

import type { DiffBoundingBox } from "../type.js";

export interface TextReflowEvidence {
  classification: "text-block-reflow";
  changedPixelCount: number;
  backgroundHex: string;
  foregroundHex: string;
  inkCoverageDelta: number;
  designComponentCount: number;
  screenshotComponentCount: number;
  designLineCount: number;
  screenshotLineCount: number;
}

// 同じ文字列が別描画器で折り返されたとき、ブロック全体のインク量は
// per-glyph の被覆差が平均化されて小さく収まる。文字列置換・グリフ欠落は
// この範囲を越えるので 0.30 で切る (単独 cluster の 0.25 より広いのは、
// ブロック単位では窓境界に触れるグリフの出入りが残るため)。
const MAX_REFLOW_INK_DELTA = 0.3;
// 同じ文字列ならインクの連結成分 (ひとまとまりの墨の塊 = グリフ片) の数は
// 一致する。トラッキング差で隣接グリフが繋がったり離れたりする程度の揺れを
// 許容して 0.15 で切る。別の文字列は成分数がずれるので弾ける。
const MAX_COMPONENT_DELTA = 0.15;
// 行バンド判定で「墨がある行」とみなす、ブレンド alpha のしきい値。
const LINE_INK_ALPHA = 0.35;
// 行バンドとして数える最小の高さ。ベタ面の端が滲んだ 1-2px の帯は行と数えない。
const MIN_LINE_BAND_HEIGHT = 5;
// 証明窓は差分 cluster の外接矩形から広げる。差分が行内の一部のグリフ
// だけを含むと、窓の辺がインクで埋まって共通背景を推定できない。一方で
// 広げすぎると隣の要素 (色付きボタン等) が窓に入り、軸外画素として弾か
// れる。小さい順に試して最初に証明が取れた窓を採用する。
const REFLOW_WINDOW_PADDINGS = [2, 8, 16] as const;
// 連結成分として数える最小ブロック数。半分の解像度に縮小したマスク上の
// 1ブロックは元の 2x2 画素に相当するので、3ブロックは実質 ~12px の墨。
const MIN_COMPONENT_PIXELS = 3;
// ストロークの太さ差で隣接グリフが繋がったり離れたりする揺れを均すため、
// 成分数は半分の解像度に縮小したインクマスクで数える。
const COMPONENT_DOWNSCALE = 2;

interface LineBand {
  top: number;
  bottom: number;
}

// 行ごとのインク量ヒストグラムから、墨を含む連続行バンドを切り出す。
const lineBands = (
  pixels: Uint8ClampedArray,
  width: number,
  window: RasterWindow,
  background: readonly number[],
  foreground: readonly number[],
  ignoreMask?: Uint8Array,
): LineBand[] => {
  const bands: LineBand[] = [];
  let open = -1;
  for (let y = window.top; y < window.bottom; y++) {
    let rowInk = 0;
    for (let x = window.left; x < window.right; x++) {
      const index = y * width + x;
      if (ignoreMask?.[index]) continue;
      if (
        blendAlphaAndResidual(colorAt(pixels, index), background, foreground).alpha >=
        LINE_INK_ALPHA
      ) {
        rowInk++;
      }
    }
    if (rowInk > 0 && open === -1) open = y;
    if (rowInk === 0 && open !== -1) {
      if (y - open >= MIN_LINE_BAND_HEIGHT) bands.push({ top: open, bottom: y });
      open = -1;
    }
  }
  if (open !== -1 && window.bottom - open >= MIN_LINE_BAND_HEIGHT) {
    bands.push({ top: open, bottom: window.bottom });
  }
  return bands;
};

// インク画素 (alpha>=0.5) の 4 近傍連結成分数。ブロック内のグリフ片の
// 総数を近似する。幅優先ではなく単純スタックで十分な大きさの領域に限る
// (呼び出し側がテキストブロック規模に絞る前提)。
const inkComponentCount = (
  pixels: Uint8ClampedArray,
  width: number,
  window: RasterWindow,
  background: readonly number[],
  foreground: readonly number[],
  ignoreMask?: Uint8Array,
): number => {
  const w = window.right - window.left;
  const h = window.bottom - window.top;
  if (w <= 0 || h <= 0) return 0;
  const bw = Math.ceil(w / COMPONENT_DOWNSCALE);
  const bh = Math.ceil(h / COMPONENT_DOWNSCALE);
  const ink = new Uint8Array(bw * bh);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const index = (window.top + y) * width + window.left + x;
      if (ignoreMask?.[index]) continue;
      const { alpha, residual } = blendAlphaAndResidual(
        colorAt(pixels, index),
        background,
        foreground,
      );
      if (alpha >= 0.5 && residual <= 32) {
        ink[Math.floor(y / COMPONENT_DOWNSCALE) * bw + Math.floor(x / COMPONENT_DOWNSCALE)] = 1;
      }
    }
  }
  const visited = new Uint8Array(bw * bh);
  let count = 0;
  const stack: number[] = [];
  for (let start = 0; start < bw * bh; start++) {
    if (ink[start] === 0 || visited[start]) continue;
    let size = 0;
    stack.push(start);
    visited[start] = 1;
    while (stack.length > 0) {
      const i = stack.pop();
      if (i === undefined) break;
      size++;
      const y = Math.floor(i / bw);
      const x = i - y * bw;
      const neighbors = [
        x > 0 ? i - 1 : -1,
        x < bw - 1 ? i + 1 : -1,
        y > 0 ? i - bw : -1,
        y < bh - 1 ? i + bw : -1,
      ];
      for (const n of neighbors) {
        if (n >= 0 && ink[n] === 1 && visited[n] === 0) {
          visited[n] = 1;
          stack.push(n);
        }
      }
    }
    if (size >= MIN_COMPONENT_PIXELS) count++;
  }
  return count;
};

/**
 * テキストブロック全体に対して「同じ文字列が折り返しだけ変わった」を
 * 証明する分類。呼び出し側は隣接する差分 cluster を結合した窓を渡す
 * (行間をまたぐ移動があると cluster 単位では成分数がずれるため)。
 *
 * トポロジ拘束を持たない代わりに、ブロック内で保存される不変量を全て要求する:
 * 1. 両画像が共通の bg/fg トークンだけで構成される (有彩色・別トークンは拒否)
 * 2. 総インク量差が小さい (太さ違い・文字列置換は弾かれる)
 * 3. インク連結成分数が近い (別文字列・記号の増減は弾かれる)
 * 行バンド数は証拠にだけ残す。折り返しそのものが行数を変えうるので
 * 判定には使わない。
 */
const classifyInWindow = (
  designPixels: Uint8ClampedArray,
  screenshotPixels: Uint8ClampedArray,
  width: number,
  window: RasterWindow,
  ignoreMask?: Uint8Array,
): TextReflowEvidence | undefined => {
  if (window.right - window.left < 3 || window.bottom - window.top < 3) {
    return undefined;
  }
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
  const inkDelta = Math.abs(designInk - screenshotInk) / Math.max(designInk, screenshotInk);
  if (inkDelta > MAX_REFLOW_INK_DELTA) return undefined;

  // 行バンド数は証拠として残すが判定には使わない。折り返し差そのものが
  // 行数を変えうる (同じ文字列が2行にも3行にも折り返される) ことと、
  // 窓下端が行の途中で切れると短い帯として数え損ねることの2点で、
  // 行数の一致は本質的な不変量ではない。文字列の置換・行の増減は
  // 連結成分数とインク量で弾く。
  const designLines = lineBands(
    designPixels,
    width,
    window,
    background,
    designForeground,
    ignoreMask,
  );
  const screenshotLines = lineBands(
    screenshotPixels,
    width,
    window,
    background,
    screenshotForeground,
    ignoreMask,
  );

  const designComponents = inkComponentCount(
    designPixels,
    width,
    window,
    background,
    designForeground,
    ignoreMask,
  );
  const screenshotComponents = inkComponentCount(
    screenshotPixels,
    width,
    window,
    background,
    screenshotForeground,
    ignoreMask,
  );
  const componentDelta =
    Math.abs(designComponents - screenshotComponents) /
    Math.max(designComponents, screenshotComponents);
  if (componentDelta > MAX_COMPONENT_DELTA) return undefined;

  const changedPixelCount = countChangedPixels(
    designPixels,
    screenshotPixels,
    width,
    window,
    ignoreMask,
  );
  if (changedPixelCount === 0) return undefined;

  return {
    classification: "text-block-reflow",
    changedPixelCount,
    backgroundHex: toHex(background),
    foregroundHex: toHex(designForeground),
    inkCoverageDelta: inkDelta,
    designComponentCount: designComponents,
    screenshotComponentCount: screenshotComponents,
    designLineCount: designLines.length,
    screenshotLineCount: screenshotLines.length,
  };
};

export const classifyTextReflow = (
  designPixels: Uint8ClampedArray,
  screenshotPixels: Uint8ClampedArray,
  width: number,
  height: number,
  bbox: DiffBoundingBox,
  ignoreMask?: Uint8Array,
): TextReflowEvidence | undefined => {
  for (const padding of REFLOW_WINDOW_PADDINGS) {
    const window: RasterWindow = {
      left: Math.max(0, Math.floor(bbox.x) - padding),
      top: Math.max(0, Math.floor(bbox.y) - padding),
      right: Math.min(width, Math.ceil(bbox.x + bbox.w) + padding),
      bottom: Math.min(height, Math.ceil(bbox.y + bbox.h) + padding),
    };
    const evidence = classifyInWindow(designPixels, screenshotPixels, width, window, ignoreMask);
    if (evidence) return evidence;
  }
  return undefined;
};

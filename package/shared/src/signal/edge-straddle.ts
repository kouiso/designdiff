import { colorAt, maxChannelDelta, resolveRasterWindow } from "./glyph-edge-raster.js";

import type { DiffBoundingBox } from "../type.js";

export interface EdgeStraddleEvidence {
  classification: "edge-straddle-rasterization";
  changedPixelCount: number;
  straddleCoverage: number;
  designLowHex: string;
  designHighHex: string;
  screenshotLowHex: string;
  screenshotHighHex: string;
}

// 白いグリフ縁・写真内の強コントラスト境界・角丸の縁のように、
// 「同じ位置に両側とも強い輝度縁がある」場所では、ラスタライザの
// アンチエイリアス差だけで画素値が数十ずれる。実害 (別トークンの塗り・
// 要素の欠落) と区別する拘束:
//   1. 差分画素の大部分が、両側画像の同じ位置にある強縁の ±EDGE_RADIUS_PX
//      以内だけに載る (ベタ面の色違いは内部画素を含むため弾く)
//   2. 差分画素の両端の色 (暗側・明側の代表色) が両側で一致する
//      (別トークンへの塗り替えは端点がずれるため弾く)
// 要素が片側にだけ存在する差分は、存在しない側に縁が無いため拘束1で弾ける。
const EDGE_STRADDLE_HILO_PX = 8;
const EDGE_RADIUS_PX = 2;
const EDGE_GRADIENT_MIN = 48;
const MIN_STRADDLE_COVERAGE = 0.85;
const ENDPOINT_CHANNEL_TOLERANCE = 24;
// AA ブレンドは端点を結ぶ線分の直上に乗るが、写真のような3色以上の
// 重なりでは線分から数十ずれる。色相の違う別色は距離が100を超えるので
// その中間で切る。
const ON_SEGMENT_TOLERANCE = 40;
const CHANGE_CHANNEL_THRESHOLD = 8;
const ENDPOINT_PERCENTILE = 0.1;

const toLuminanceAt = (pixels: Uint8ClampedArray, width: number, x: number, y: number): number => {
  const index = (y * width + x) * 4;
  return pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
};

// 中央差分の絶対値和を縁の強さとする。Sobel だと対角成分で平均化されるが、
// ここでは「急峻に色が変わる位置」だけを拾えばよいので隣接差分で十分。
const buildEdgeMap = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  window: { left: number; top: number; right: number; bottom: number },
): Uint8Array => {
  const map = new Uint8Array(width * height);
  const left = Math.max(1, window.left);
  const top = Math.max(1, window.top);
  const right = Math.min(width - 1, window.right);
  const bottom = Math.min(height - 1, window.bottom);
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const gx = Math.abs(
        toLuminanceAt(pixels, width, x + 1, y) - toLuminanceAt(pixels, width, x - 1, y),
      );
      const gy = Math.abs(
        toLuminanceAt(pixels, width, x, y + 1) - toLuminanceAt(pixels, width, x, y - 1),
      );
      if (gx + gy >= EDGE_GRADIENT_MIN) {
        map[y * width + x] = 1;
      }
    }
  }
  return map;
};

// ある画素が「両側画像のどちらにも ±r 以内に強縁がある」位置かを見る。
// 別々の縁でよい (例: design のグリフ縁と screenshot の同じグリフ縁が
// 1px ずれていても、両方の近傍に縁があればラスタライザ差の候補になる)。
const isNearEdge = (
  edgeMap: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): boolean => {
  for (let dy = -EDGE_RADIUS_PX; dy <= EDGE_RADIUS_PX; dy++) {
    const ny = y + dy;
    if (ny < 0 || ny >= height) continue;
    for (let dx = -EDGE_RADIUS_PX; dx <= EDGE_RADIUS_PX; dx++) {
      const nx = x + dx;
      if (nx < 0 || nx >= width) continue;
      if (edgeMap[ny * width + nx]) return true;
    }
  }
  return false;
};

// AA のにじみは暗側・明側の補間になる。変化画素の色が端点を結ぶ線分から
// ずれるものは「縁の中間色」では説明できない別色なので弾く。
const distanceToSegment = (
  color: [number, number, number],
  low: [number, number, number],
  high: [number, number, number],
): number => {
  const dx = high[0] - low[0];
  const dy = high[1] - low[1];
  const dz = high[2] - low[2];
  const len2 = dx * dx + dy * dy + dz * dz;
  if (len2 === 0) {
    return Math.sqrt(
      (color[0] - low[0]) ** 2 + (color[1] - low[1]) ** 2 + (color[2] - low[2]) ** 2,
    );
  }
  const t = Math.max(
    0,
    Math.min(
      1,
      ((color[0] - low[0]) * dx + (color[1] - low[1]) * dy + (color[2] - low[2]) * dz) / len2,
    ),
  );
  return Math.sqrt(
    (color[0] - (low[0] + t * dx)) ** 2 +
      (color[1] - (low[1] + t * dy)) ** 2 +
      (color[2] - (low[2] + t * dz)) ** 2,
  );
};

// 差分画素集合の暗側・明側の代表色。パーセンタイルで外れ値を捨てる。
const endpointColors = (
  pixels: Uint8ClampedArray,
  width: number,
  indices: number[],
): { low: [number, number, number]; high: [number, number, number] } | undefined => {
  if (indices.length === 0) return undefined;
  const sorted = [...indices].sort(
    (a, b) =>
      toLuminanceAt(pixels, width, a % width, Math.floor(a / width)) -
      toLuminanceAt(pixels, width, b % width, Math.floor(b / width)),
  );
  const pick = (frac: number): [number, number, number] => {
    const index = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * frac))];
    return colorAt(pixels, index);
  };
  return { low: pick(ENDPOINT_PERCENTILE), high: pick(1 - ENDPOINT_PERCENTILE) };
};

/**
 * 両側画像の同じ位置に強縁が並ぶ箇所だけで画素がずれる差分を証明する。
 *
 * same-token-rasterization は平坦背景を、texture-resampling は写真全体の
 * リサンプルを前提にするため、どちらも「写真の中に描かれたグリフ縁」や
 * 「角丸の縁」のような小さな局所縁を拾えない。この分類は差分画素の空間
 * 分布 (両側の強縁にまたがる) と端点色の一致だけを拘束に使い、窓の
 * 写真様判定やトークン支配色の存在を要求しない。
 */
export const classifyEdgeStraddle = (
  designPixels: Uint8ClampedArray,
  screenshotPixels: Uint8ClampedArray,
  width: number,
  height: number,
  bbox: DiffBoundingBox,
  ignoreMask?: Uint8Array,
): EdgeStraddleEvidence | undefined => {
  const window = resolveRasterWindow(width, height, bbox, EDGE_STRADDLE_HILO_PX);
  if (!window) return undefined;

  const designEdges = buildEdgeMap(designPixels, width, height, window);
  const screenshotEdges = buildEdgeMap(screenshotPixels, width, height, window);

  const changed: number[] = [];
  let straddled = 0;
  for (let y = window.top; y < window.bottom; y++) {
    for (let x = window.left; x < window.right; x++) {
      const pixelIndex = y * width + x;
      if (ignoreMask?.[pixelIndex]) continue;
      if (
        maxChannelDelta(colorAt(designPixels, pixelIndex), colorAt(screenshotPixels, pixelIndex)) <
        CHANGE_CHANNEL_THRESHOLD
      ) {
        continue;
      }
      changed.push(pixelIndex);
      if (
        isNearEdge(designEdges, width, height, x, y) &&
        isNearEdge(screenshotEdges, width, height, x, y)
      ) {
        straddled++;
      }
    }
  }
  if (changed.length === 0) return undefined;

  const straddleCoverage = straddled / changed.length;
  if (straddleCoverage < MIN_STRADDLE_COVERAGE) return undefined;

  const designEndpoints = endpointColors(designPixels, width, changed);
  const screenshotEndpoints = endpointColors(screenshotPixels, width, changed);
  if (!designEndpoints || !screenshotEndpoints) return undefined;
  if (
    maxChannelDelta(designEndpoints.low, screenshotEndpoints.low) > ENDPOINT_CHANNEL_TOLERANCE ||
    maxChannelDelta(designEndpoints.high, screenshotEndpoints.high) > ENDPOINT_CHANNEL_TOLERANCE
  ) {
    return undefined;
  }

  // 色相の違う別色が混ざる差分を弾く。端点検査はパーセンタイルなので中間輝度の
  // 別色がすり抜ける。変化画素は全て端点を結ぶ線分の近傍 (AA 補間) でなければ
  // ならない。
  for (const index of changed) {
    const screenshotColor = colorAt(screenshotPixels, index);
    if (
      distanceToSegment(screenshotColor, screenshotEndpoints.low, screenshotEndpoints.high) >
      ON_SEGMENT_TOLERANCE
    ) {
      return undefined;
    }
    const designColor = colorAt(designPixels, index);
    if (
      distanceToSegment(designColor, designEndpoints.low, designEndpoints.high) >
      ON_SEGMENT_TOLERANCE
    ) {
      return undefined;
    }
  }

  const toHex = (c: [number, number, number]): string =>
    `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
  return {
    classification: "edge-straddle-rasterization",
    changedPixelCount: changed.length,
    straddleCoverage,
    designLowHex: toHex(designEndpoints.low),
    designHighHex: toHex(designEndpoints.high),
    screenshotLowHex: toHex(screenshotEndpoints.low),
    screenshotHighHex: toHex(screenshotEndpoints.high),
  };
};

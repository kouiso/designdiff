// 同じページを2回撮って、変わった場所を「動的コンテンツ」とみなす。
//
// 時計・カウンタ・カルーセル・ランダム広告のような、実装の正しさと関係なく
// 撮るたびに変わる要素は、差分として毎回計上される。これが残ると自走ループは
// 何を直しても差分が消えず、永久に収束せん。人が毎回手でマスクを引くのも同じ問題。
//
// 画素単位の連結成分は重く、境界も不安定になる。格子(セル)単位で「変わった」を
// 立てて、隣り合うセルを矩形へまとめる。多少太っても、除外する側なので害が小さい。

/** 判定に使う格子の一辺 (px)。 */
export const DYNAMIC_CELL_SIZE = 16;
/** RGB のいずれかがこの値を超えて違えば「変わった」とみなす。 */
export const DYNAMIC_CHANNEL_TOLERANCE = 8;
/** セル内でこの割合を超える画素が変わっていたら、そのセルを動的とみなす。 */
export const DYNAMIC_CELL_COVERAGE = 0.02;

export interface DynamicRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectDynamicRegionsOptions {
  cellSize?: number;
  channelTolerance?: number;
  cellCoverage?: number;
  /** これより小さい面積の矩形は雑音として捨てる (px^2)。 */
  minRegionArea?: number;
  /**
   * 検出した矩形を上下へ広げるセル数。既定 1。
   * 上下には別の要素が並ぶことが多いので、広げすぎると正しい差分まで隠す。
   */
  paddingCells?: number;
  /**
   * 検出した矩形を左右へ広げるセル数。既定 3。
   * 動的コンテンツはたいてい横書きのテキストで、変わったのは一部の文字だけ。
   * 変わらなかった文字は同じ行の左右に並ぶので、横方向は上下より広く取る。
   * 実測 (800px 幅の時計ページ): 左右1セルで覆う面積 10,240px、3セルで 27,648px。
   */
  horizontalPaddingCells?: number;
}

const DEFAULT_MIN_REGION_AREA = DYNAMIC_CELL_SIZE * DYNAMIC_CELL_SIZE;

function assertSameSize(
  a: Uint8Array | Uint8ClampedArray,
  b: Uint8Array | Uint8ClampedArray,
): void {
  if (a.length !== b.length) {
    throw new Error(`2枚の画素配列の長さが違います (${a.length} vs ${b.length})`);
  }
}

/**
 * 同一ページの2枚から、撮るたびに変わる領域を検出する。
 *
 * 入力は同じ寸法の RGBA。寸法が違う場合は呼び出し側が揃えること
 * (揃っていない = そもそも同一ページの2連写ではない)。
 */
export function detectDynamicRegions(
  pixels1: Uint8Array | Uint8ClampedArray,
  pixels2: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  options: DetectDynamicRegionsOptions = {},
): DynamicRegion[] {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`寸法が不正です (width=${width}, height=${height})`);
  }
  assertSameSize(pixels1, pixels2);
  if (pixels1.length < width * height * 4) {
    throw new Error(`画素配列が寸法に足りません (${pixels1.length} < ${width * height * 4})`);
  }

  const cellSize = options.cellSize ?? DYNAMIC_CELL_SIZE;
  const tolerance = options.channelTolerance ?? DYNAMIC_CHANNEL_TOLERANCE;
  const coverage = options.cellCoverage ?? DYNAMIC_CELL_COVERAGE;
  const minArea = options.minRegionArea ?? DEFAULT_MIN_REGION_AREA;
  if (cellSize <= 0) throw new Error(`cellSize は正の値が必要です (${cellSize})`);

  const cols = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);
  const changed = new Uint8Array(cols * rows);

  for (let row = 0; row < rows; row++) {
    const yStart = row * cellSize;
    const yEnd = Math.min(yStart + cellSize, height);
    for (let col = 0; col < cols; col++) {
      const xStart = col * cellSize;
      const xEnd = Math.min(xStart + cellSize, width);
      const total = (yEnd - yStart) * (xEnd - xStart);
      if (total === 0) continue;
      const needed = Math.max(1, Math.ceil(total * coverage));
      let diffCount = 0;
      for (let y = yStart; y < yEnd && diffCount < needed; y++) {
        const rowOffset = y * width;
        for (let x = xStart; x < xEnd; x++) {
          const i = (rowOffset + x) * 4;
          if (
            Math.abs(pixels1[i] - pixels2[i]) > tolerance ||
            Math.abs(pixels1[i + 1] - pixels2[i + 1]) > tolerance ||
            Math.abs(pixels1[i + 2] - pixels2[i + 2]) > tolerance
          ) {
            diffCount++;
            if (diffCount >= needed) break;
          }
        }
      }
      if (diffCount >= needed) changed[row * cols + col] = 1;
    }
  }

  return mergeCellsIntoRegions(changed, cols, rows, cellSize, width, height, minArea, {
    x: options.horizontalPaddingCells ?? 3,
    y: options.paddingCells ?? 1,
  });
}

/**
 * 同じページの3枚以上から、変わった領域の和集合を返す。
 * 2枚だけでは、その間隔で動いた部分しか取れない (秒とミリ秒で更新周期が違う等)。
 * 基準の1枚に対して残り全部を突き合わせ、重なりをまとめる。
 */
export function detectDynamicRegionsAcrossSamples(
  base: Uint8Array | Uint8ClampedArray,
  samples: readonly (Uint8Array | Uint8ClampedArray)[],
  width: number,
  height: number,
  options: DetectDynamicRegionsOptions = {},
): DynamicRegion[] {
  if (samples.length === 0) return [];
  const cellSize = options.cellSize ?? DYNAMIC_CELL_SIZE;
  const cols = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);
  const union = new Uint8Array(cols * rows);

  for (const sample of samples) {
    for (const region of detectDynamicRegions(base, sample, width, height, {
      ...options,
      // 和を取ってから面積と余白を判定する。1枚ごとに捨てると、複数枚に
      // またがってようやく形になる領域を取りこぼす。
      minRegionArea: 1,
      paddingCells: 0,
      horizontalPaddingCells: 0,
    })) {
      const colStart = Math.floor(region.x / cellSize);
      const colEnd = Math.min(cols - 1, Math.floor((region.x + region.width - 1) / cellSize));
      const rowStart = Math.floor(region.y / cellSize);
      const rowEnd = Math.min(rows - 1, Math.floor((region.y + region.height - 1) / cellSize));
      for (let row = rowStart; row <= rowEnd; row++) {
        for (let col = colStart; col <= colEnd; col++) union[row * cols + col] = 1;
      }
    }
  }

  return mergeCellsIntoRegions(
    union,
    cols,
    rows,
    cellSize,
    width,
    height,
    options.minRegionArea ?? DEFAULT_MIN_REGION_AREA,
    { x: options.horizontalPaddingCells ?? 3, y: options.paddingCells ?? 1 },
  );
}

/** 立っているセルを4近傍で連結し、外接矩形へまとめる。 */
function mergeCellsIntoRegions(
  changed: Uint8Array,
  cols: number,
  rows: number,
  cellSize: number,
  width: number,
  height: number,
  minArea: number,
  paddingCells: { x: number; y: number },
): DynamicRegion[] {
  const visited = new Uint8Array(cols * rows);
  const regions: DynamicRegion[] = [];
  const stack: number[] = [];

  for (let start = 0; start < changed.length; start++) {
    if (changed[start] === 0 || visited[start] === 1) continue;
    visited[start] = 1;
    stack.length = 0;
    stack.push(start);

    let minCol = cols;
    let maxCol = -1;
    let minRow = rows;
    let maxRow = -1;

    while (stack.length > 0) {
      const index = stack.pop();
      if (index === undefined) break;
      const col = index % cols;
      const row = (index - col) / cols;
      if (col < minCol) minCol = col;
      if (col > maxCol) maxCol = col;
      if (row < minRow) minRow = row;
      if (row > maxRow) maxRow = row;

      const neighbors = [
        col > 0 ? index - 1 : -1,
        col < cols - 1 ? index + 1 : -1,
        row > 0 ? index - cols : -1,
        row < rows - 1 ? index + cols : -1,
      ];
      for (const n of neighbors) {
        if (n < 0 || visited[n] === 1 || changed[n] === 0) continue;
        visited[n] = 1;
        stack.push(n);
      }
    }

    // 面積の判定は余白を足す前に行う。足した後で測ると、1セルの雑音が
    // 余白ぶんだけ膨らんで閾値を越え、捨てられなくなる。
    const rawWidth = Math.min((maxCol + 1) * cellSize, width) - minCol * cellSize;
    const rawHeight = Math.min((maxRow + 1) * cellSize, height) - minRow * cellSize;
    if (rawWidth <= 0 || rawHeight <= 0) continue;
    if (rawWidth * rawHeight < minArea) continue;

    const paddedMinCol = Math.max(0, minCol - paddingCells.x);
    const paddedMinRow = Math.max(0, minRow - paddingCells.y);
    const paddedMaxCol = Math.min(cols - 1, maxCol + paddingCells.x);
    const paddedMaxRow = Math.min(rows - 1, maxRow + paddingCells.y);
    const x = paddedMinCol * cellSize;
    const y = paddedMinRow * cellSize;
    const regionWidth = Math.min((paddedMaxCol + 1) * cellSize, width) - x;
    const regionHeight = Math.min((paddedMaxRow + 1) * cellSize, height) - y;
    if (regionWidth <= 0 || regionHeight <= 0) continue;
    regions.push({ x, y, width: regionWidth, height: regionHeight });
  }

  regions.sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
  return regions;
}

import type { DiffRegion } from "./type.js";

/**
 * 8-connectivity flood fill で差分ピクセルをクラスタリング
 * 10px未満のクラスタはノイズとしてフィルタ
 *
 * NOTE: 全画面 web スクリーンショットでは anti-aliasing chain により
 * diff pixel が画像全体で 1 cluster に潰れる既知の問題がある。
 * Full-page 比較には clusterDiffPixelsGrid を推奨。
 */
export function clusterDiffPixels(
  diffPixelData: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
): DiffRegion[] {
  const visited = new Set<number>();
  const regions: DiffRegion[] = [];
  let regionId = 0;

  for (let y = 0; y < imageHeight; y++) {
    for (let x = 0; x < imageWidth; x++) {
      const idx = (y * imageWidth + x) * 4;
      if (isDiffPixel(diffPixelData, idx) && !visited.has(idx)) {
        const region = floodFill(diffPixelData, imageWidth, imageHeight, x, y, visited);

        if (region.pixelCount >= 10) {
          const diffRegion: DiffRegion = {
            id: regionId++,
            bounds: region.bounds,
            diffPixelCount: region.pixelCount,
            nearbyNodeIds: [],
            nearbyNodeNames: [],
          };
          regions.push(diffRegion);
        }
      }
    }
  }

  return regions;
}

function floodFill(
  diffData: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  startX: number,
  startY: number,
  visited: Set<number>,
): { bounds: { x: number; y: number; width: number; height: number }; pixelCount: number } {
  const stack: [number, number][] = [[startX, startY]];
  let minX = startX;
  let maxX = startX;
  let minY = startY;
  let maxY = startY;
  let pixelCount = 0;

  while (stack.length > 0) {
    const item = stack.pop();
    if (!item) break;
    const [x, y] = item;
    const idx = (y * imageWidth + x) * 4;

    if (
      x < 0 ||
      x >= imageWidth ||
      y < 0 ||
      y >= imageHeight ||
      visited.has(idx) ||
      !isDiffPixel(diffData, idx)
    ) {
      continue;
    }

    visited.add(idx);
    pixelCount++;

    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);

    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }

  return {
    bounds: {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    },
    pixelCount,
  };
}

function isDiffPixel(diffData: Uint8ClampedArray, idx: number): boolean {
  const red = diffData[idx];
  const green = diffData[idx + 1];
  const blue = diffData[idx + 2];
  const alpha = diffData[idx + 3];

  if (alpha === 0 && red === 0 && green === 0 && blue === 0) {
    return false;
  }

  // pixelmatch は一致ピクセルを白/グレー、不一致ピクセルを赤/黄で描く。
  return red !== green || green !== blue;
}

export interface GridClusterOptions {
  cellSize?: number;
  cellDensityThreshold?: number;
  minRegionCells?: number;
}

const DEFAULT_GRID_OPTIONS: Required<GridClusterOptions> = {
  cellSize: 64,
  cellDensityThreshold: 0.05,
  minRegionCells: 1,
};

/**
 * Grid-based clustering for full-page web screenshots.
 *
 * Why: 8-connectivity flood fill collapses every full-page diff into one
 * image-spanning cluster because anti-aliasing creates pixel chains across
 * the whole canvas. This function tiles the image into cells, marks cells
 * whose diff density exceeds a threshold, and runs 4-connectivity component
 * labelling on the hot cells. Output: localized regions at section granularity.
 *
 * Uses the same isDiffPixel helper as the flood-fill clusterer to stay
 * consistent with how the rest of the pipeline classifies pixelmatch output.
 *
 * - cellSize (default 64 px): grid cell edge length
 * - cellDensityThreshold (default 0.05): minimum fraction of diff pixels in a
 *   cell for it to count as "hot"
 * - minRegionCells (default 1): minimum hot-cell count for a region to be
 *   reported; raise to suppress small noise
 */
export function clusterDiffPixelsGrid(
  diffPixelData: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  options: GridClusterOptions = {},
): DiffRegion[] {
  const { cellSize, cellDensityThreshold, minRegionCells } = {
    ...DEFAULT_GRID_OPTIONS,
    ...options,
  };
  const { cellDiff, gridWidth, gridHeight } = buildCellGrid(
    diffPixelData,
    imageWidth,
    imageHeight,
    cellSize,
  );

  const hotMask = buildHotMask({
    cellDiff,
    gridWidth,
    gridHeight,
    cellSize,
    imageWidth,
    imageHeight,
    cellDensityThreshold,
  });

  const components = labelConnectedHotCells(hotMask, gridWidth, gridHeight);

  return components
    .map((component) =>
      buildRegionFromComponent({
        component,
        cellDiff,
        cellSize,
        imageWidth,
        imageHeight,
        gridWidth,
      }),
    )
    .filter((region) => region.cellCount >= minRegionCells)
    .map((region, index) => ({
      id: index,
      bounds: region.bounds,
      diffPixelCount: region.diffPixelCount,
      nearbyNodeIds: [],
      nearbyNodeNames: [],
    }));
}

function buildCellGrid(
  diffPixelData: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  cellSize: number,
): { cellDiff: number[]; gridWidth: number; gridHeight: number } {
  const gridWidth = Math.ceil(imageWidth / cellSize);
  const gridHeight = Math.ceil(imageHeight / cellSize);
  const cellDiff = new Array<number>(gridWidth * gridHeight).fill(0);

  for (let y = 0; y < imageHeight; y++) {
    const cellY = Math.floor(y / cellSize);
    const rowBase = y * imageWidth;
    for (let x = 0; x < imageWidth; x++) {
      const idx = (rowBase + x) * 4;
      if (isDiffPixel(diffPixelData, idx)) {
        const cellX = Math.floor(x / cellSize);
        cellDiff[cellY * gridWidth + cellX] += 1;
      }
    }
  }

  return { cellDiff, gridWidth, gridHeight };
}

function buildHotMask(args: {
  cellDiff: number[];
  gridWidth: number;
  gridHeight: number;
  cellSize: number;
  imageWidth: number;
  imageHeight: number;
  cellDensityThreshold: number;
}): boolean[] {
  const {
    cellDiff,
    gridWidth,
    gridHeight,
    cellSize,
    imageWidth,
    imageHeight,
    cellDensityThreshold,
  } = args;
  const hotMask = new Array<boolean>(gridWidth * gridHeight).fill(false);

  for (let cy = 0; cy < gridHeight; cy++) {
    const cellY0 = cy * cellSize;
    const cellY1 = Math.min(cellY0 + cellSize, imageHeight);
    for (let cx = 0; cx < gridWidth; cx++) {
      const cellX0 = cx * cellSize;
      const cellX1 = Math.min(cellX0 + cellSize, imageWidth);
      const cellPixels = (cellX1 - cellX0) * (cellY1 - cellY0);
      if (cellPixels === 0) continue;
      const density = cellDiff[cy * gridWidth + cx] / cellPixels;
      if (density >= cellDensityThreshold) {
        hotMask[cy * gridWidth + cx] = true;
      }
    }
  }

  return hotMask;
}

function labelConnectedHotCells(
  hotMask: boolean[],
  gridWidth: number,
  gridHeight: number,
): number[][] {
  const visited = new Array<boolean>(gridWidth * gridHeight).fill(false);
  const components: number[][] = [];

  for (let cy = 0; cy < gridHeight; cy++) {
    for (let cx = 0; cx < gridWidth; cx++) {
      const idx = cy * gridWidth + cx;
      if (!hotMask[idx] || visited[idx]) continue;
      components.push(floodFillHotComponent(hotMask, visited, gridWidth, gridHeight, idx));
    }
  }

  return components;
}

function floodFillHotComponent(
  hotMask: boolean[],
  visited: boolean[],
  gridWidth: number,
  gridHeight: number,
  startIdx: number,
): number[] {
  const cells: number[] = [];
  const stack: number[] = [startIdx];
  while (stack.length > 0) {
    const cellIdx = stack.pop();
    if (cellIdx === undefined || visited[cellIdx] || !hotMask[cellIdx]) continue;
    visited[cellIdx] = true;
    cells.push(cellIdx);
    pushNeighbours(stack, cellIdx, gridWidth, gridHeight);
  }
  return cells;
}

function pushNeighbours(
  stack: number[],
  cellIdx: number,
  gridWidth: number,
  gridHeight: number,
): void {
  const x = cellIdx % gridWidth;
  const y = Math.floor(cellIdx / gridWidth);
  if (x + 1 < gridWidth) stack.push(cellIdx + 1);
  if (x - 1 >= 0) stack.push(cellIdx - 1);
  if (y + 1 < gridHeight) stack.push(cellIdx + gridWidth);
  if (y - 1 >= 0) stack.push(cellIdx - gridWidth);
}

interface ComponentRegion {
  bounds: { x: number; y: number; width: number; height: number };
  diffPixelCount: number;
  cellCount: number;
}

function buildRegionFromComponent(args: {
  component: number[];
  cellDiff: number[];
  cellSize: number;
  imageWidth: number;
  imageHeight: number;
  gridWidth: number;
}): ComponentRegion {
  const { component, cellDiff, cellSize, imageWidth, imageHeight, gridWidth } = args;
  let minCellX = Number.POSITIVE_INFINITY;
  let maxCellX = Number.NEGATIVE_INFINITY;
  let minCellY = Number.POSITIVE_INFINITY;
  let maxCellY = Number.NEGATIVE_INFINITY;
  let diffPixelCount = 0;

  for (const cellIdx of component) {
    const cx = cellIdx % gridWidth;
    const cy = Math.floor(cellIdx / gridWidth);
    if (cx < minCellX) minCellX = cx;
    if (cx > maxCellX) maxCellX = cx;
    if (cy < minCellY) minCellY = cy;
    if (cy > maxCellY) maxCellY = cy;
    diffPixelCount += cellDiff[cellIdx];
  }

  const x = minCellX * cellSize;
  const y = minCellY * cellSize;
  const width = Math.min((maxCellX - minCellX + 1) * cellSize, imageWidth - x);
  const height = Math.min((maxCellY - minCellY + 1) * cellSize, imageHeight - y);

  return {
    bounds: { x, y, width, height },
    diffPixelCount,
    cellCount: component.length,
  };
}

export function generateMatchSuggestion(matchRate: number): string {
  if (matchRate === 100) {
    return "compare.suggestionPerfect";
  }
  if (matchRate >= 95) {
    return "compare.suggestionMinor";
  }
  return "compare.suggestionMajor";
}

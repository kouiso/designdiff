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
  maxWallMs?: number;
  budgetMs?: number;
  maxRegions?: number;
  maxHotCellRatio?: number;
  fallbackToFlood?: boolean;
}

const DEFAULT_GRID_OPTIONS: Required<
  Pick<GridClusterOptions, "cellSize" | "cellDensityThreshold" | "minRegionCells">
> = {
  cellSize: 64,
  cellDensityThreshold: 0.05,
  minRegionCells: 1,
};

export type GridClusterAbortReason =
  | "wall-budget-exceeded"
  | "region-count-exceeded"
  | "hot-cell-ratio-exceeded";

export interface GridClusterResult {
  regions: DiffRegion[];
  aborted: boolean;
  abortReason?: GridClusterAbortReason;
  wallMs: number;
  budgetMs?: number;
  hotCellRatio: number;
}

interface BudgetClock {
  startedAt: number;
  maxWallMs?: number;
}

class GridClusterBudgetExceededError extends Error {
  constructor() {
    super("grid cluster wall budget exceeded");
  }
}

function nowMs(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function isBudgetExceeded(clock: BudgetClock): boolean {
  if (clock.maxWallMs === undefined) {
    return false;
  }
  return nowMs() - clock.startedAt >= clock.maxWallMs;
}

function assertWithinBudget(clock: BudgetClock): void {
  if (isBudgetExceeded(clock)) {
    throw new GridClusterBudgetExceededError();
  }
}

function validateGridClusterOptions(args: {
  cellSize: number;
  cellDensityThreshold: number;
  minRegionCells: number;
  options: GridClusterOptions;
}): void {
  const { cellSize, cellDensityThreshold, minRegionCells, options } = args;
  if (!Number.isFinite(cellSize) || cellSize <= 0 || !Number.isInteger(cellSize)) {
    throw new RangeError(
      `clusterDiffPixelsGrid: cellSize must be a positive integer, got ${cellSize}`,
    );
  }
  if (
    !Number.isFinite(cellDensityThreshold) ||
    cellDensityThreshold < 0 ||
    cellDensityThreshold > 1
  ) {
    throw new RangeError(
      `clusterDiffPixelsGrid: cellDensityThreshold must be in [0,1], got ${cellDensityThreshold}`,
    );
  }
  if (!Number.isFinite(minRegionCells) || minRegionCells < 1 || !Number.isInteger(minRegionCells)) {
    throw new RangeError(
      `clusterDiffPixelsGrid: minRegionCells must be an integer ≥ 1, got ${minRegionCells}`,
    );
  }
  if (
    options.budgetMs !== undefined &&
    (!Number.isFinite(options.budgetMs) || options.budgetMs < 0)
  ) {
    throw new RangeError(
      `clusterDiffPixelsGrid: budgetMs must be nonnegative, got ${options.budgetMs}`,
    );
  }
  if (
    options.maxWallMs !== undefined &&
    (!Number.isFinite(options.maxWallMs) || options.maxWallMs < 0)
  ) {
    throw new RangeError(
      `clusterDiffPixelsGrid: maxWallMs must be nonnegative, got ${options.maxWallMs}`,
    );
  }
  if (
    options.maxRegions !== undefined &&
    (!Number.isFinite(options.maxRegions) ||
      options.maxRegions < 1 ||
      !Number.isInteger(options.maxRegions))
  ) {
    throw new RangeError(
      `clusterDiffPixelsGrid: maxRegions must be an integer ≥ 1, got ${options.maxRegions}`,
    );
  }
  if (
    options.maxHotCellRatio !== undefined &&
    (!Number.isFinite(options.maxHotCellRatio) ||
      options.maxHotCellRatio < 0 ||
      options.maxHotCellRatio > 1)
  ) {
    throw new RangeError(
      `clusterDiffPixelsGrid: maxHotCellRatio must be in [0,1], got ${options.maxHotCellRatio}`,
    );
  }
}

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
  return clusterDiffPixelsGridDetailed(diffPixelData, imageWidth, imageHeight, options).regions;
}

export function clusterDiffPixelsGridDetailed(
  diffPixelData: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  options: GridClusterOptions = {},
): GridClusterResult {
  const startedAt = nowMs();
  const { cellSize, cellDensityThreshold, minRegionCells } = {
    ...DEFAULT_GRID_OPTIONS,
    ...options,
  };
  const finish = (
    regions: DiffRegion[],
    partial: Pick<GridClusterResult, "aborted" | "abortReason" | "hotCellRatio">,
  ): GridClusterResult => ({
    regions,
    ...partial,
    wallMs: Math.max(0, nowMs() - startedAt),
    budgetMs: options.maxWallMs ?? options.budgetMs,
  });

  validateGridClusterOptions({ cellSize, cellDensityThreshold, minRegionCells, options });

  const clock: BudgetClock = { startedAt, maxWallMs: options.maxWallMs ?? options.budgetMs };
  try {
    const grid = buildCellGrid(diffPixelData, imageWidth, imageHeight, cellSize, clock);
    const { cellDiff, gridWidth, gridHeight } = grid;

    const hotMask = buildHotMask({
      cellDiff,
      gridWidth,
      gridHeight,
      cellSize,
      imageWidth,
      imageHeight,
      cellDensityThreshold,
      clock,
    });
    const hotCellCount = hotMask.filter(Boolean).length;
    const hotCellRatio = hotMask.length === 0 ? 0 : hotCellCount / hotMask.length;

    if (options.maxHotCellRatio !== undefined && hotCellRatio > options.maxHotCellRatio) {
      return finish([], {
        aborted: true,
        abortReason: "hot-cell-ratio-exceeded",
        hotCellRatio,
      });
    }

    const components = labelConnectedHotCells(hotMask, gridWidth, gridHeight, clock);
    if (options.maxRegions !== undefined && components.length > options.maxRegions) {
      return finish([], {
        aborted: true,
        abortReason: "region-count-exceeded",
        hotCellRatio,
      });
    }

    const regions = components
      .map((component) => buildRegionFromComponent({ component, grid }))
      .filter((region) => region.cellCount >= minRegionCells)
      .map((region, index) => ({
        id: index,
        bounds: region.bounds,
        diffPixelCount: region.diffPixelCount,
        nearbyNodeIds: [],
        nearbyNodeNames: [],
      }));

    return finish(regions, { aborted: false, hotCellRatio });
  } catch (error) {
    if (!(error instanceof GridClusterBudgetExceededError)) {
      throw error;
    }
    return finish([], {
      aborted: true,
      abortReason: "wall-budget-exceeded",
      hotCellRatio: 0,
    });
  }
}

interface CellGrid {
  cellDiff: Uint32Array;
  // Per-cell tight bounds (Uint32Array sentinel: minX/minY start at gridDim ≥ any
  // valid coord, maxX/maxY at 0). Used in buildRegionFromComponent to produce
  // pixel-tight region bounds instead of cell-aligned ones, so
  // matchDiffRegionsToNodes resolves nodes by the actual diff center.
  cellMinX: Uint32Array;
  cellMinY: Uint32Array;
  cellMaxX: Uint32Array;
  cellMaxY: Uint32Array;
  gridWidth: number;
  gridHeight: number;
}

function buildCellGrid(
  diffPixelData: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  cellSize: number,
  clock: BudgetClock,
): CellGrid {
  const gridWidth = Math.ceil(imageWidth / cellSize);
  const gridHeight = Math.ceil(imageHeight / cellSize);
  // Uint32Array is ~4× more memory-efficient than Array<number> for large grids
  // and gives faster scans inside hot loops.
  const cellDiff = new Uint32Array(gridWidth * gridHeight);
  const cellMinX = new Uint32Array(gridWidth * gridHeight).fill(imageWidth);
  const cellMinY = new Uint32Array(gridWidth * gridHeight).fill(imageHeight);
  const cellMaxX = new Uint32Array(gridWidth * gridHeight);
  const cellMaxY = new Uint32Array(gridWidth * gridHeight);

  for (let y = 0; y < imageHeight; y++) {
    if (y % 16 === 0) assertWithinBudget(clock);
    const cellY = Math.floor(y / cellSize);
    const rowBase = y * imageWidth;
    for (let x = 0; x < imageWidth; x++) {
      const idx = (rowBase + x) * 4;
      if (isDiffPixel(diffPixelData, idx)) {
        const cellX = Math.floor(x / cellSize);
        const cellIdx = cellY * gridWidth + cellX;
        cellDiff[cellIdx] += 1;
        if (x < cellMinX[cellIdx]) cellMinX[cellIdx] = x;
        if (y < cellMinY[cellIdx]) cellMinY[cellIdx] = y;
        if (x > cellMaxX[cellIdx]) cellMaxX[cellIdx] = x;
        if (y > cellMaxY[cellIdx]) cellMaxY[cellIdx] = y;
      }
    }
  }

  return { cellDiff, cellMinX, cellMinY, cellMaxX, cellMaxY, gridWidth, gridHeight };
}

function buildHotMask(args: {
  cellDiff: Uint32Array;
  gridWidth: number;
  gridHeight: number;
  cellSize: number;
  imageWidth: number;
  imageHeight: number;
  cellDensityThreshold: number;
  clock: BudgetClock;
}): boolean[] {
  const {
    cellDiff,
    gridWidth,
    gridHeight,
    cellSize,
    imageWidth,
    imageHeight,
    cellDensityThreshold,
    clock,
  } = args;
  const hotMask = new Array<boolean>(gridWidth * gridHeight).fill(false);

  for (let cy = 0; cy < gridHeight; cy++) {
    assertWithinBudget(clock);
    const cellY0 = cy * cellSize;
    const cellY1 = Math.min(cellY0 + cellSize, imageHeight);
    for (let cx = 0; cx < gridWidth; cx++) {
      const cellX0 = cx * cellSize;
      const cellX1 = Math.min(cellX0 + cellSize, imageWidth);
      const cellPixels = (cellX1 - cellX0) * (cellY1 - cellY0);
      if (cellPixels === 0) continue;
      // Require at least one diff pixel — otherwise a threshold of 0 would
      // mark every cell hot (including all-matching ones), producing components
      // with Infinity bounds from buildRegionFromComponent's sentinel min values.
      const diffCount = cellDiff[cy * gridWidth + cx];
      if (diffCount === 0) continue;
      const density = diffCount / cellPixels;
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
  clock: BudgetClock,
): number[][] {
  const visited = new Array<boolean>(gridWidth * gridHeight).fill(false);
  const components: number[][] = [];

  for (let cy = 0; cy < gridHeight; cy++) {
    assertWithinBudget(clock);
    for (let cx = 0; cx < gridWidth; cx++) {
      const idx = cy * gridWidth + cx;
      if (!hotMask[idx] || visited[idx]) continue;
      components.push(floodFillHotComponent(hotMask, visited, gridWidth, gridHeight, idx, clock));
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
  clock: BudgetClock,
): number[] {
  // Mark-before-push: prevents the same cell from being pushed multiple times
  // and keeps the stack bounded by the number of cells in the component.
  const cells: number[] = [];
  visited[startIdx] = true;
  cells.push(startIdx);
  const stack: number[] = [];
  pushUnvisitedNeighbours(stack, visited, hotMask, startIdx, gridWidth, gridHeight);
  while (stack.length > 0) {
    if (cells.length % 64 === 0) assertWithinBudget(clock);
    const cellIdx = stack.pop();
    if (cellIdx === undefined) continue;
    visited[cellIdx] = true;
    cells.push(cellIdx);
    pushUnvisitedNeighbours(stack, visited, hotMask, cellIdx, gridWidth, gridHeight);
  }
  return cells;
}

function pushUnvisitedNeighbours(
  stack: number[],
  visited: boolean[],
  hotMask: boolean[],
  cellIdx: number,
  gridWidth: number,
  gridHeight: number,
): void {
  const x = cellIdx % gridWidth;
  const y = Math.floor(cellIdx / gridWidth);
  const candidates: number[] = [];
  if (x + 1 < gridWidth) candidates.push(cellIdx + 1);
  if (x - 1 >= 0) candidates.push(cellIdx - 1);
  if (y + 1 < gridHeight) candidates.push(cellIdx + gridWidth);
  if (y - 1 >= 0) candidates.push(cellIdx - gridWidth);
  for (const n of candidates) {
    if (hotMask[n] && !visited[n]) {
      visited[n] = true;
      stack.push(n);
    }
  }
}

interface ComponentRegion {
  bounds: { x: number; y: number; width: number; height: number };
  diffPixelCount: number;
  cellCount: number;
}

function buildRegionFromComponent(args: { component: number[]; grid: CellGrid }): ComponentRegion {
  const { component, grid } = args;
  // Use per-cell pixel-tight bounds collected in buildCellGrid so node
  // matching uses the actual diff centroid, not the cell-aligned corner.
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let diffPixelCount = 0;

  for (const cellIdx of component) {
    if (grid.cellDiff[cellIdx] === 0) continue;
    diffPixelCount += grid.cellDiff[cellIdx];
    if (grid.cellMinX[cellIdx] < minX) minX = grid.cellMinX[cellIdx];
    if (grid.cellMinY[cellIdx] < minY) minY = grid.cellMinY[cellIdx];
    if (grid.cellMaxX[cellIdx] > maxX) maxX = grid.cellMaxX[cellIdx];
    if (grid.cellMaxY[cellIdx] > maxY) maxY = grid.cellMaxY[cellIdx];
  }

  return {
    bounds: {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    },
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

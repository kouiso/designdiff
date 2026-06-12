import { describe, expect, it } from "vitest";

import {
  clusterDiffPixels,
  clusterDiffPixelsGrid,
  clusterDiffPixelsGridDetailed,
  generateMatchSuggestion,
} from "./diff-cluster.js";

const createDiffData = (
  width: number,
  height: number,
  diffPixels: { x: number; y: number }[],
): Uint8ClampedArray => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (const { x, y } of diffPixels) {
    const idx = (y * width + x) * 4;
    data[idx] = 255;
    data[idx + 1] = 0;
    data[idx + 2] = 0;
    data[idx + 3] = 255;
  }
  return data;
};

describe("clusterDiffPixels", () => {
  it("差分なしの画像は空配列を返す", () => {
    const data = new Uint8ClampedArray(100 * 100 * 4);
    const regions = clusterDiffPixels(data, 100, 100);
    expect(regions).toEqual([]);
  });

  it("pixelmatchの一致ピクセルは差分領域として扱わない", () => {
    const data = new Uint8ClampedArray(10 * 1 * 4);

    for (let x = 0; x < 10; x++) {
      const idx = x * 4;
      data[idx] = x % 2 === 0 ? 255 : 230;
      data[idx + 1] = data[idx];
      data[idx + 2] = data[idx];
      data[idx + 3] = 255;
    }

    const regions = clusterDiffPixels(data, 10, 1);
    expect(regions).toEqual([]);
  });

  it("10px未満のクラスタはノイズとしてフィルタされる", () => {
    const pixels = Array.from({ length: 9 }, (_, i) => ({ x: i, y: 0 }));
    const data = createDiffData(100, 100, pixels);
    const regions = clusterDiffPixels(data, 100, 100);
    expect(regions).toEqual([]);
  });

  it("10px以上の連続差分を1つのリージョンとして検出する", () => {
    const pixels = Array.from({ length: 15 }, (_, i) => ({ x: i, y: 0 }));
    const data = createDiffData(100, 100, pixels);
    const regions = clusterDiffPixels(data, 100, 100);
    expect(regions).toHaveLength(1);
    expect(regions[0].bounds).toEqual({ x: 0, y: 0, width: 15, height: 1 });
    expect(regions[0].diffPixelCount).toBe(15);
    expect(regions[0].id).toBe(0);
  });

  it("離れた2つの差分領域を別リージョンとして検出する", () => {
    const cluster1 = Array.from({ length: 10 }, (_, i) => ({ x: i, y: 0 }));
    const cluster2 = Array.from({ length: 10 }, (_, i) => ({ x: 50 + i, y: 50 }));
    const data = createDiffData(100, 100, [...cluster1, ...cluster2]);
    const regions = clusterDiffPixels(data, 100, 100);
    expect(regions).toHaveLength(2);
  });

  it("2D矩形の差分を正しくバウンディングボックスで囲む", () => {
    const pixels: { x: number; y: number }[] = [];
    for (let y = 10; y < 15; y++) {
      for (let x = 20; x < 25; x++) {
        pixels.push({ x, y });
      }
    }
    const data = createDiffData(100, 100, pixels);
    const regions = clusterDiffPixels(data, 100, 100);
    expect(regions).toHaveLength(1);
    expect(regions[0].bounds).toEqual({ x: 20, y: 10, width: 5, height: 5 });
    expect(regions[0].diffPixelCount).toBe(25);
  });

  it("nearbyNodeIds/nearbyNodeNamesは空配列で初期化される", () => {
    const pixels = Array.from({ length: 10 }, (_, i) => ({ x: i, y: 0 }));
    const data = createDiffData(100, 100, pixels);
    const regions = clusterDiffPixels(data, 100, 100);
    expect(regions[0].nearbyNodeIds).toEqual([]);
    expect(regions[0].nearbyNodeNames).toEqual([]);
  });
});

describe("generateMatchSuggestion", () => {
  it("100%一致で 'compare.suggestionPerfect' を返す", () => {
    expect(generateMatchSuggestion(100)).toBe("compare.suggestionPerfect");
  });

  it("95%以上で 'compare.suggestionMinor' を返す", () => {
    expect(generateMatchSuggestion(95)).toBe("compare.suggestionMinor");
    expect(generateMatchSuggestion(99.9)).toBe("compare.suggestionMinor");
  });

  it("95%未満で 'compare.suggestionMajor' を返す", () => {
    expect(generateMatchSuggestion(94.9)).toBe("compare.suggestionMajor");
    expect(generateMatchSuggestion(0)).toBe("compare.suggestionMajor");
  });
});

describe("clusterDiffPixelsGrid", () => {
  it("差分なしの画像は空配列を返す", () => {
    const data = new Uint8ClampedArray(256 * 256 * 4);
    const regions = clusterDiffPixelsGrid(data, 256, 256);
    expect(regions).toEqual([]);
  });

  it("離れた 2 領域は 2 region に分割される (flood-fill では 1 にならない検証)", () => {
    const size = 512;
    const pixels: { x: number; y: number }[] = [];
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) pixels.push({ x, y });
    for (let y = 384; y < 448; y++) for (let x = 384; x < 448; x++) pixels.push({ x, y });
    const data = createDiffData(size, size, pixels);
    const regions = clusterDiffPixelsGrid(data, size, size, { cellSize: 64 });
    expect(regions.length).toBe(2);
    for (const r of regions) {
      expect(r.bounds.width).toBeLessThan(size);
      expect(r.bounds.height).toBeLessThan(size);
    }
  });

  it("低密度のスパースな散布は hot cell にならず region 0", () => {
    const size = 256;
    const pixels = [
      { x: 10, y: 10 },
      { x: 100, y: 100 },
      { x: 200, y: 200 },
    ];
    const data = createDiffData(size, size, pixels);
    const regions = clusterDiffPixelsGrid(data, size, size);
    expect(regions.length).toBe(0);
  });

  it("region bounds は image 境界をはみ出さない", () => {
    const w = 200;
    const h = 200;
    const pixels: { x: number; y: number }[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) pixels.push({ x, y });
    const data = createDiffData(w, h, pixels);
    const regions = clusterDiffPixelsGrid(data, w, h, { cellSize: 64 });
    expect(regions.length).toBeGreaterThanOrEqual(1);
    for (const r of regions) {
      expect(r.bounds.x + r.bounds.width).toBeLessThanOrEqual(w);
      expect(r.bounds.y + r.bounds.height).toBeLessThanOrEqual(h);
    }
  });
});

describe("clusterDiffPixelsGrid validation guards", () => {
  const data = new Uint8ClampedArray(64 * 64 * 4);

  it("cellSize <= 0 throws RangeError", () => {
    expect(() => clusterDiffPixelsGrid(data, 64, 64, { cellSize: 0 })).toThrow(RangeError);
    expect(() => clusterDiffPixelsGrid(data, 64, 64, { cellSize: -8 })).toThrow(RangeError);
  });

  it("non-integer cellSize throws", () => {
    expect(() => clusterDiffPixelsGrid(data, 64, 64, { cellSize: 12.5 })).toThrow(RangeError);
  });

  it("cellDensityThreshold outside [0,1] throws", () => {
    expect(() => clusterDiffPixelsGrid(data, 64, 64, { cellDensityThreshold: 1.5 })).toThrow(
      RangeError,
    );
    expect(() => clusterDiffPixelsGrid(data, 64, 64, { cellDensityThreshold: -0.1 })).toThrow(
      RangeError,
    );
  });

  it("minRegionCells < 1 throws", () => {
    expect(() => clusterDiffPixelsGrid(data, 64, 64, { minRegionCells: 0 })).toThrow(RangeError);
  });

  it("budgetMs < 0 throws", () => {
    expect(() => clusterDiffPixelsGrid(data, 64, 64, { budgetMs: -1 })).toThrow(RangeError);
  });

  it("maxWallMs < 0 throws", () => {
    expect(() => clusterDiffPixelsGrid(data, 64, 64, { maxWallMs: -1 })).toThrow(RangeError);
  });

  it("maxRegions < 1 throws", () => {
    expect(() => clusterDiffPixelsGrid(data, 64, 64, { maxRegions: 0 })).toThrow(RangeError);
  });

  it("maxHotCellRatio outside [0,1] throws", () => {
    expect(() => clusterDiffPixelsGrid(data, 64, 64, { maxHotCellRatio: 1.5 })).toThrow(RangeError);
  });
});

describe("clusterDiffPixelsGrid pixel-tight bounds", () => {
  it("region bounds collapse to exact diff pixels, not cell-aligned corners", () => {
    // A single diff pixel at (200, 300) inside a 512×512 image.
    // cellSize=64 → cell (3, 4) is hot.
    // Old behaviour: region bounded at (192, 256, 64, 64) (cell-aligned).
    // New behaviour: region bounded at (200, 300, 1, 1) (pixel-tight).
    const size = 512;
    // With minRegionCells=1 and a single diff pixel, the cell density
    // (1 / 4096 ≈ 0.0002) is well below default 0.05, so we need a small
    // dense cluster instead. A 16×16 block at (200, 300) gives density
    // 256/4096 = 0.0625 > 0.05 → cell becomes hot.
    const blockData = createDiffData(
      size,
      size,
      Array.from({ length: 16 * 16 }, (_, i) => ({
        x: 200 + (i % 16),
        y: 300 + Math.floor(i / 16),
      })),
    );
    const regions = clusterDiffPixelsGrid(blockData, size, size, { cellSize: 64 });
    expect(regions.length).toBe(1);
    const b = regions[0].bounds;
    // Pixel-tight bounds should match the 16×16 block (215, 315 inclusive)
    expect(b.x).toBe(200);
    expect(b.y).toBe(300);
    expect(b.width).toBe(16);
    expect(b.height).toBe(16);
  });
});

describe("clusterDiffPixelsGrid edge — zero-density threshold", () => {
  it("cellDensityThreshold=0 still excludes all-matching cells (no Infinity bounds)", () => {
    // All-zero diff data with threshold 0 must produce zero regions
    // (regression guard: pre-fix this would mark every cell hot and
    // buildRegionFromComponent would return ±Infinity bounds).
    const data = new Uint8ClampedArray(128 * 128 * 4);
    const regions = clusterDiffPixelsGrid(data, 128, 128, { cellDensityThreshold: 0 });
    expect(regions).toEqual([]);
  });
});

describe("clusterDiffPixelsGridDetailed telemetry", () => {
  it("budgetMs=0 で wall-budget-exceeded を返す", () => {
    const data = createDiffData(
      128,
      128,
      Array.from({ length: 64 * 64 }, (_, i) => ({ x: i % 64, y: Math.floor(i / 64) })),
    );

    const result = clusterDiffPixelsGridDetailed(data, 128, 128, {
      cellSize: 64,
      budgetMs: 0,
    });

    expect(result.aborted).toBe(true);
    expect(result.abortReason).toBe("wall-budget-exceeded");
    expect(result.regions).toEqual([]);
    expect(result.budgetMs).toBe(0);
    expect(result.wallMs).toBeGreaterThanOrEqual(0);
  });

  it("hot cell ratio cap を超えたら hot-cell-ratio-exceeded を返す", () => {
    const data = createDiffData(
      128,
      128,
      Array.from({ length: 128 * 128 }, (_, i) => ({
        x: i % 128,
        y: Math.floor(i / 128),
      })),
    );

    const result = clusterDiffPixelsGridDetailed(data, 128, 128, {
      cellSize: 64,
      maxHotCellRatio: 0.5,
    });

    expect(result.aborted).toBe(true);
    expect(result.abortReason).toBe("hot-cell-ratio-exceeded");
    expect(result.hotCellRatio).toBe(1);
  });
});

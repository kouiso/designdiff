import { describe, expect, it } from "vitest";

import { clusterDiffPixels, generateMatchSuggestion } from "./diff-cluster.js";

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

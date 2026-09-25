import { describe, expect, it } from "vitest";

import { comparePixels } from "./pixel-compare.js";

describe("comparePixels", () => {
  it("同一画像 → 差分0", () => {
    const img = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
    const output = new Uint8ClampedArray(8);
    expect(comparePixels(img, img, output, 2, 1)).toBe(0);
  });

  it("全ピクセル相違 → 差分数がピクセル総数と一致する", () => {
    const a = new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255]);
    const b = new Uint8ClampedArray([0, 255, 0, 255, 0, 255, 0, 255]);
    const output = new Uint8ClampedArray(8);
    expect(comparePixels(a, b, output, 2, 1)).toBe(2);
  });

  it("透明画素は白へblendして比較する (v5互換)", () => {
    // pixelmatch v7 既定の checkerboard=true では透明画素が市松の色にblendされ
    // 不透明な白と一致しない。既定 checkerboard=false で白blendを維持する。
    const transparent = new Uint8ClampedArray([0, 0, 0, 0]);
    const white = new Uint8ClampedArray([255, 255, 255, 255]);
    const output = new Uint8ClampedArray(4);
    expect(comparePixels(transparent, white, output, 1, 1)).toBe(0);
  });

  it("checkerboard=true を明示すれば v7 の市松比較になる", () => {
    const transparent = new Uint8ClampedArray([0, 0, 0, 0]);
    const white = new Uint8ClampedArray([255, 255, 255, 255]);
    const output = new Uint8ClampedArray(4);
    expect(comparePixels(transparent, white, output, 1, 1, { checkerboard: true })).toBe(1);
  });
});

import { describe, expect, it } from "vitest";

import { computeBestLocalAlignment } from "./local-alignment.js";

const WIDTH = 40;
const HEIGHT = 24;

const makeCanvas = (blobX: number, blobY: number, blobW = 6, blobH = 10): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4).fill(255);
  for (let y = blobY; y < blobY + blobH; y++) {
    for (let x = blobX; x < blobX + blobW; x++) {
      const offset = (y * WIDTH + x) * 4;
      pixels[offset] = 0;
      pixels[offset + 1] = 0;
      pixels[offset + 2] = 0;
    }
  }
  return pixels;
};

// 縁が中間 alpha・core が前景色のグリフ様の縦棒。ラスタライザ差の検証用。
const makeGlyphCanvas = (edgeX: number, coreX: number, edgeValue: number): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4).fill(255);
  for (let y = 8; y < 16; y++) {
    for (const [x, value] of [
      [edgeX, edgeValue],
      [coreX, 0],
    ] as const) {
      const offset = (y * WIDTH + x) * 4;
      pixels[offset] = value;
      pixels[offset + 1] = value;
      pixels[offset + 2] = value;
    }
  }
  return pixels;
};

const BBOX = { x: 6, y: 4, w: 24, h: 16 };

describe("computeBestLocalAlignment", () => {
  it("±3px の平行移動で完全一致する領域を救済する", () => {
    const result = computeBestLocalAlignment(
      makeCanvas(12, 8),
      makeCanvas(15, 8),
      WIDTH,
      HEIGHT,
      BBOX,
    );

    expect(result).toBeDefined();
    expect(result?.dx).toBe(3);
    expect(result?.dy).toBe(0);
    expect(result?.structure).toBe(1);
    expect(result?.color).toBe(0);
    expect(result?.residualGlyphEdge).toBeUndefined();
  });

  it("斜めの移動量も dx/dy で報告する", () => {
    const result = computeBestLocalAlignment(
      makeCanvas(12, 8),
      makeCanvas(10, 6),
      WIDTH,
      HEIGHT,
      BBOX,
    );

    expect(result).toBeDefined();
    expect(result?.dx).toBe(-2);
    expect(result?.dy).toBe(-2);
    expect(result?.structure).toBe(1);
  });

  it("許容範囲を超える移動は救済しない", () => {
    // +5px は既定の ±3px では届かない。候補内の部分一致は救済水準を割る。
    const result = computeBestLocalAlignment(
      makeCanvas(12, 8),
      makeCanvas(17, 8),
      WIDTH,
      HEIGHT,
      BBOX,
    );

    expect(result).toBeUndefined();
  });

  it("maxShiftPx を広げれば届く範囲は救済される", () => {
    const result = computeBestLocalAlignment(
      makeCanvas(12, 8),
      makeCanvas(17, 8),
      WIDTH,
      HEIGHT,
      BBOX,
      undefined,
      6,
    );

    expect(result).toBeDefined();
    expect(result?.dx).toBe(5);
    expect(result?.structure).toBe(1);
  });

  it("内容物が違う領域は最良オフセットでも救済水準に届かず失格のまま", () => {
    // design の黒ブロックの位置に screenshot は別形状 (横長) を持つ。
    // 平行移動だけでは一致しないので undefined を返す。
    const result = computeBestLocalAlignment(
      makeCanvas(12, 8, 6, 10),
      makeCanvas(10, 8, 12, 4),
      WIDTH,
      HEIGHT,
      BBOX,
    );

    expect(result).toBeUndefined();
  });

  it("整列後の残差がグリフ縁だけなら residualGlyphEdge を立てる", () => {
    // design: edge 96 + core 0 / shot: +1px シフトで edge 144 + core 0。
    // +1 整列で core は一致し、残差は縁の中間 alpha 差だけになる。
    const result = computeBestLocalAlignment(
      makeGlyphCanvas(11, 12, 96),
      makeGlyphCanvas(12, 13, 144),
      WIDTH,
      HEIGHT,
      { x: 8, y: 5, w: 12, h: 14 },
    );

    expect(result).toBeDefined();
    expect(result?.dx).toBe(1);
    expect(result?.residualGlyphEdge).toBe(true);
  });

  it("画像端に接する領域でも範囲外オフセットを飛ばして採点できる", () => {
    const result = computeBestLocalAlignment(
      makeCanvas(1, 1, 6, 10),
      makeCanvas(3, 1, 6, 10),
      WIDTH,
      HEIGHT,
      { x: 0, y: 0, w: 10, h: 12 },
    );

    expect(result?.dx).toBe(2);
    expect(result?.structure).toBe(1);
  });
});

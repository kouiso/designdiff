import { describe, expect, it } from "vitest";

import { classifyGlyphEdgeRasterization } from "./glyph-edge-raster.js";

const WIDTH = 9;
const HEIGHT = 9;
const WHITE = 255;

const makeGlyph = (edgeValue: number, xOffset = 0, coreHeight = 5): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4).fill(WHITE);
  for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel++) pixels[pixel * 4 + 3] = 255;
  const coreX = 4 + xOffset;
  const edgeX = coreX - 1;
  if (edgeX < 0 || coreX >= WIDTH || coreHeight <= 0 || 2 + coreHeight > HEIGHT) {
    throw new RangeError("glyph fixture coordinates are outside the canvas");
  }
  for (let y = 2; y < 2 + coreHeight; y++) {
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

const classify = (design: Uint8ClampedArray, screenshot: Uint8ClampedArray) =>
  classifyGlyphEdgeRasterization(design, screenshot, WIDTH, HEIGHT, { x: 2, y: 1, w: 5, h: 7 });

describe("classifyGlyphEdgeRasterization", () => {
  it("同じcore形状で中間alphaだけが違う描画を分類する", () => {
    expect(classify(makeGlyph(96), makeGlyph(144))).toMatchObject({
      classification: "glyph-edge-rasterization",
      changedPixelCount: 5,
      backgroundHex: "#FFFFFF",
      foregroundHex: "#000000",
    });
  });

  it("1px移動をglyph edgeとして扱わない", () => {
    expect(classify(makeGlyph(96), makeGlyph(96, 1))).toBeUndefined();
  });

  it("文字サイズと行高に相当するcore形状差を扱わない", () => {
    expect(classify(makeGlyph(96, 0, 5), makeGlyph(96, 0, 4))).toBeUndefined();
  });

  it("ベタ面トークン差を扱わない", () => {
    const design = new Uint8ClampedArray(WIDTH * HEIGHT * 4).fill(255);
    const screenshot = new Uint8ClampedArray(WIDTH * HEIGHT * 4).fill(248);
    expect(classify(design, screenshot)).toBeUndefined();
  });

  it("左右端を越えた別行のcoreを隣接扱いしない", () => {
    const design = new Uint8ClampedArray(WIDTH * HEIGHT * 4).fill(255);
    const screenshot = Uint8ClampedArray.from(design);
    const edgeIndex = 3 * WIDTH * 4;
    const wrappedCoreIndex = (1 * WIDTH + WIDTH - 1) * 4;
    for (let channel = 0; channel < 3; channel++) {
      design[edgeIndex + channel] = 96;
      screenshot[edgeIndex + channel] = 144;
      design[wrappedCoreIndex + channel] = 0;
      screenshot[wrappedCoreIndex + channel] = 0;
    }

    expect(
      classifyGlyphEdgeRasterization(design, screenshot, WIDTH, HEIGHT, {
        x: 0,
        y: 0,
        w: WIDTH,
        h: HEIGHT,
      }),
    ).toBeUndefined();
  });

  it("範囲外fixtureを拒否する", () => {
    expect(() => makeGlyph(96, -4)).toThrow(RangeError);
    expect(() => makeGlyph(96, 0, HEIGHT)).toThrow(RangeError);
  });
});

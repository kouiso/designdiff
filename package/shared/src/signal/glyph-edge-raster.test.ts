import { describe, expect, it } from "vitest";

import { classifyGlyphEdgeRasterization } from "./glyph-edge-raster.js";

const WIDTH = 9;
const HEIGHT = 9;
const WHITE = 255;

const makeGlyph = (edgeValue: number, xOffset = 0, coreHeight = 5): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4).fill(WHITE);
  for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel++) pixels[pixel * 4 + 3] = 255;
  for (let y = 2; y < 2 + coreHeight; y++) {
    const coreX = 4 + xOffset;
    const edgeX = coreX - 1;
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
});

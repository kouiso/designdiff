import { describe, expect, it } from "vitest";

import {
  classifyGlyphEdgeRasterization,
  classifySameTokenRasterization,
} from "./glyph-edge-raster.js";

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

const classifySameToken = (
  design: Uint8ClampedArray,
  screenshot: Uint8ClampedArray,
  topologyShape = 0.1,
) =>
  classifySameTokenRasterization(
    design,
    screenshot,
    WIDTH,
    HEIGHT,
    { x: 1, y: 1, w: 7, h: 7 },
    topologyShape,
  );

describe("classifySameTokenRasterization", () => {
  it("同一トークンで位置ずれしたグリフを同一トークン差として分類する", () => {
    expect(classifySameToken(makeGlyph(96), makeGlyph(96, 1))).toMatchObject({
      classification: "same-token-rasterization",
      backgroundHex: "#FFFFFF",
      foregroundHex: "#000000",
    });
  });

  it("被覆差だけの同一位置グリフも分類する", () => {
    expect(classifySameToken(makeGlyph(96), makeGlyph(144))).toMatchObject({
      classification: "same-token-rasterization",
    });
  });

  it("トポロジ差が大きい領域 (グリフ欠落) を扱わない", () => {
    // 片方だけにグリフがあると欠落側のエッジが空隙を作る。
    // builder 由来の Hausdorff 値が閾値を越えた入力は分類を拒否する。
    const blank = new Uint8ClampedArray(WIDTH * HEIGHT * 4).fill(255);
    for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel++) blank[pixel * 4 + 3] = 255;
    expect(classifySameToken(makeGlyph(96), blank, 0.4)).toBeUndefined();
  });

  it("色相の違う画素が混ざった領域を扱わない", () => {
    const design = makeGlyph(96);
    const screenshot = makeGlyph(96, 1);
    const colored = (8 * WIDTH + 2) * 4;
    screenshot[colored] = 200;
    screenshot[colored + 1] = 40;
    screenshot[colored + 2] = 40;
    expect(classifySameToken(design, screenshot)).toBeUndefined();
  });

  it("インク量差が大きい領域 (太さ違い) を扱わない", () => {
    const design = makeGlyph(96);
    const screenshot = makeGlyph(96);
    // 太字化相当: core の右隣に同じ高さの列を追加して墨量を約1.5倍にする。
    const extraX = 5;
    for (let y = 2; y < 7; y++) {
      const offset = (y * WIDTH + extraX) * 4;
      screenshot[offset] = 0;
      screenshot[offset + 1] = 0;
      screenshot[offset + 2] = 0;
    }
    expect(classifySameToken(design, screenshot)).toBeUndefined();
  });

  it("前景の無い領域 (要素欠落) を扱わない", () => {
    const blank = new Uint8ClampedArray(WIDTH * HEIGHT * 4).fill(255);
    for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel++) blank[pixel * 4 + 3] = 255;
    expect(classifySameToken(makeGlyph(96), blank)).toBeUndefined();
  });

  it("ベタ面トークン差を扱わない", () => {
    const design = new Uint8ClampedArray(WIDTH * HEIGHT * 4).fill(255);
    const screenshot = new Uint8ClampedArray(WIDTH * HEIGHT * 4).fill(248);
    expect(classifySameToken(design, screenshot)).toBeUndefined();
  });

  const BIG = 40;
  const bigPixels = (stems: number[]): Uint8ClampedArray => {
    const pixels = new Uint8ClampedArray(BIG * BIG * 4).fill(255);
    for (let pixel = 0; pixel < BIG * BIG; pixel++) pixels[pixel * 4 + 3] = 255;
    for (const x of stems) {
      for (let y = 10; y < 27; y++) {
        const offset = (y * BIG + x) * 4;
        pixels[offset] = 51;
        pixels[offset + 1] = 51;
        pixels[offset + 2] = 51;
      }
    }
    return pixels;
  };

  it("証明枠の縁をグリフが占有する小窓でも拡大枠で同一トークンを証明する", () => {
    // 実測パターン (designdiff#232): 窓縁を別 stem が埋めて背景支配率が
    // 40% を割るクラスタ。halo を広げた窓では縁が白に戻り証明が成立する。
    const design = bigPixels([10, 14, 19]);
    const screenshot = bigPixels([11, 15, 20]);
    for (let x = 10; x <= 20; x++) {
      const offset = (10 * BIG + x) * 4;
      design[offset] = design[offset + 1] = design[offset + 2] = 51;
      screenshot[offset] = screenshot[offset + 1] = screenshot[offset + 2] = 51;
    }
    const bbox = { x: 12, y: 12, w: 6, h: 12 };
    expect(classifySameTokenRasterization(design, screenshot, BIG, BIG, bbox, 0.1)).toMatchObject({
      classification: "same-token-rasterization",
    });
  });
});

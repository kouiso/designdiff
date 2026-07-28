import sharp from "sharp";
import { describe, it, expect } from "vitest";

import {
  compareImages,
  flattenTransparentPixels,
  hasTransparentPixel,
  parseBackgroundColor,
} from "./image-compare-service.js";

// 実物の画像処理を使う。差し替えると、透明が黒として評価に入るかという
// 本題そのものが確かめられなくなる。

const SIZE = 64;
const MARK = { x: 24, y: 24, w: 16, h: 16 };

/** 下地の色を指定して、中央に黒い四角を置いた PNG を作る。 */
async function makePng(base: { r: number; g: number; b: number; a: number }): Promise<string> {
  const pixels = Buffer.alloc(SIZE * SIZE * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = base.r;
    pixels[index + 1] = base.g;
    pixels[index + 2] = base.b;
    pixels[index + 3] = base.a;
  }
  for (let y = MARK.y; y < MARK.y + MARK.h; y++) {
    for (let x = MARK.x; x < MARK.x + MARK.w; x++) {
      const offset = (y * SIZE + x) * 4;
      pixels[offset] = 0;
      pixels[offset + 1] = 0;
      pixels[offset + 2] = 0;
      pixels[offset + 3] = 255;
    }
  }
  const png = await sharp(pixels, { raw: { width: SIZE, height: SIZE, channels: 4 } })
    .png()
    .toBuffer();
  return png.toString("base64");
}

describe("背景の塗りが無い設計を白地の実装と比べるとき", () => {
  it("透明部分を黒と読まず、構造一致が落ちないこと", async () => {
    const designBase64 = await makePng({ r: 0, g: 0, b: 0, a: 0 });
    const screenshotBase64 = await makePng({ r: 255, g: 255, b: 255, a: 255 });

    const result = await compareImages({ designBase64, screenshotBase64, threshold: 0.1 });

    const structures = (result.diffReport?.regionScores ?? []).map((score) => score.structure);
    expect(structures.length).toBeGreaterThan(0);
    for (const structure of structures) {
      expect(structure).toBeGreaterThanOrEqual(0.95);
    }
  });

  it("下地の色を指定すると、その色の上に置いて評価すること", async () => {
    // 設計は透明、実装は黒地。白を敷けば食い違い、黒を敷けば一致する。
    const designBase64 = await makePng({ r: 0, g: 0, b: 0, a: 0 });
    const screenshotBase64 = await makePng({ r: 0, g: 0, b: 0, a: 255 });

    const onWhite = await compareImages({ designBase64, screenshotBase64, threshold: 0.1 });
    const onBlack = await compareImages({
      designBase64,
      screenshotBase64,
      threshold: 0.1,
      designBackground: "#000000",
    });

    const worst = (result: typeof onWhite): number =>
      Math.min(...(result.diffReport?.regionScores ?? []).map((score) => score.structure));
    expect(worst(onBlack)).toBeGreaterThan(worst(onWhite));
  });
});

describe("parseBackgroundColor", () => {
  it("6桁と3桁の指定を読むこと", () => {
    expect(parseBackgroundColor("#1a2B3c")).toEqual({ r: 26, g: 43, b: 60 });
    expect(parseBackgroundColor("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseBackgroundColor("000000")).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("読めない指定は白として扱うこと", () => {
    expect(parseBackgroundColor("rebeccapurple")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseBackgroundColor("")).toEqual({ r: 255, g: 255, b: 255 });
  });
});

describe("flattenTransparentPixels", () => {
  it("完全な透明は下地の色そのものになること", () => {
    const pixels = Uint8ClampedArray.from([0, 0, 0, 0]);
    flattenTransparentPixels(pixels, { r: 255, g: 255, b: 255 });
    expect(Array.from(pixels)).toEqual([255, 255, 255, 255]);
  });

  it("半透明は下地と混ざること", () => {
    const pixels = Uint8ClampedArray.from([0, 0, 0, 128]);
    flattenTransparentPixels(pixels, { r: 255, g: 255, b: 255 });
    // alpha 128 は 128/255 なので、ちょうど半分にはならない。
    expect(pixels[0]).toBe(127);
    expect(pixels[3]).toBe(255);
  });

  it("不透明な画素は変えないこと", () => {
    const pixels = Uint8ClampedArray.from([10, 20, 30, 255]);
    flattenTransparentPixels(pixels, { r: 255, g: 255, b: 255 });
    expect(Array.from(pixels)).toEqual([10, 20, 30, 255]);
  });
});

describe("hasTransparentPixel", () => {
  it("全部不透明なら false", () => {
    expect(hasTransparentPixel(Uint8ClampedArray.from([1, 2, 3, 255, 4, 5, 6, 255]))).toBe(false);
  });

  it("1画素でも透けていれば true", () => {
    expect(hasTransparentPixel(Uint8ClampedArray.from([1, 2, 3, 255, 4, 5, 6, 254]))).toBe(true);
  });
});

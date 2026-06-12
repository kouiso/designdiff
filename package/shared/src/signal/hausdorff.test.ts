import { describe, expect, it } from "vitest";

import { computeHausdorff } from "./hausdorff.js";

function createBlankImage(width: number, height: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let index = 0; index < width * height; index++) {
    const rgbaIndex = index * 4;
    pixels[rgbaIndex] = 255;
    pixels[rgbaIndex + 1] = 255;
    pixels[rgbaIndex + 2] = 255;
    pixels[rgbaIndex + 3] = 255;
  }

  return pixels;
}

function drawRect(
  pixels: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  rectWidth: number,
  rectHeight: number,
): void {
  for (let row = y; row < y + rectHeight; row++) {
    for (let column = x; column < x + rectWidth; column++) {
      const rgbaIndex = (row * width + column) * 4;
      pixels[rgbaIndex] = 0;
      pixels[rgbaIndex + 1] = 0;
      pixels[rgbaIndex + 2] = 0;
      pixels[rgbaIndex + 3] = 255;
    }
  }
}

describe("computeHausdorff", () => {
  it("同一輪郭なら 0 を返す", () => {
    const imageA = createBlankImage(32, 32);
    const imageB = createBlankImage(32, 32);
    drawRect(imageA, 32, 8, 8, 10, 10);
    drawRect(imageB, 32, 8, 8, 10, 10);

    const result = computeHausdorff(imageA, imageB, 32, 32);

    expect(result).toBeCloseTo(0, 6);
  });

  it("輪郭が平行移動すると距離が増える", () => {
    const imageA = createBlankImage(32, 32);
    const imageB = createBlankImage(32, 32);
    drawRect(imageA, 32, 6, 8, 10, 10);
    drawRect(imageB, 32, 14, 8, 10, 10);

    const result = computeHausdorff(imageA, imageB, 32, 32);

    expect(result).toBeGreaterThan(0.15);
    expect(result).toBeLessThan(0.35);
  });

  it("片方にしか輪郭がない場合は 1 を返す", () => {
    const imageA = createBlankImage(24, 24);
    const imageB = createBlankImage(24, 24);
    drawRect(imageA, 24, 6, 6, 8, 8);

    const result = computeHausdorff(imageA, imageB, 24, 24);

    expect(result).toBe(1);
  });

  it("bbox 内だけを評価できる", () => {
    const imageA = createBlankImage(32, 32);
    const imageB = createBlankImage(32, 32);
    drawRect(imageA, 32, 4, 4, 8, 8);
    drawRect(imageB, 32, 4, 4, 8, 8);
    drawRect(imageB, 32, 20, 20, 8, 8);

    const result = computeHausdorff(imageA, imageB, 32, 32, { x: 0, y: 0, w: 16, h: 16 });

    expect(result).toBeCloseTo(0, 6);
  });

  it("高密度な輪郭でも有界サンプリングで有限値を返す", () => {
    const width = 256;
    const height = 256;
    const imageA = createBlankImage(width, height);
    const imageB = createBlankImage(width, height);

    for (let x = 4; x < width - 4; x += 4) {
      drawRect(imageA, width, x, 8, 1, height - 16);
      drawRect(imageB, width, x + 1, 8, 1, height - 16);
    }

    const result = computeHausdorff(imageA, imageB, width, height);

    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });
});

import { expect, it } from "vitest";

import { computeWholeImageStructure } from "./ssim.js";

const WIDTH = 390;
const HEIGHT = 692;

const raster = (width = WIDTH, height = HEIGHT, value = 255): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels.fill(value, offset, offset + 3);
    pixels[offset + 3] = 255;
  }
  return pixels;
};

const paint = (pixels: Uint8ClampedArray, x: number, y: number, w: number, h: number): void => {
  for (let row = y; row < y + h; row += 1) {
    for (let col = x; col < x + w; col += 1) {
      const offset = (row * WIDTH + col) * 4;
      pixels.fill((row + col) % 2 ? 0 : 60, offset, offset + 3);
    }
  }
};

it("measures the entire 390x692 canvas and keeps a 13x11 difference local", () => {
  const baseline = raster();
  const actual = raster();
  paint(actual, 336, 597, 13, 11);
  const result = computeWholeImageStructure(baseline, actual, WIDTH, HEIGHT);
  expect(result.evaluatedPixelCount).toBe(WIDTH * HEIGHT);
  expect(result.excludedPixelCount).toBe(0);
  expect(result.score).toBeGreaterThan(0.99);
  expect(result.score).toBeLessThan(1);
  expect(result.verdict).toBe("pass");
});

it("counts repeated small changes by their measured area", () => {
  const baseline = raster();
  const single = raster();
  paint(single, 336, 597, 13, 11);
  const repeated = raster();
  for (let y = 20; y < HEIGHT - 20; y += 30) {
    for (let x = 20; x < WIDTH - 20; x += 30) paint(repeated, x, y, 13, 11);
  }
  const one = computeWholeImageStructure(baseline, single, WIDTH, HEIGHT);
  const many = computeWholeImageStructure(baseline, repeated, WIDTH, HEIGHT);
  expect(many.score).toBeLessThan(one.score ?? 0);
  expect(many.verdict).not.toBe("pass");
});

it("fails large structural changes even without localized region metadata", () => {
  const actual = raster();
  paint(actual, 0, 0, WIDTH, HEIGHT);
  expect(computeWholeImageStructure(raster(), actual, WIDTH, HEIGHT).verdict).toBe("fail");
});

it("excludes uniform luminance shifts while retaining contrast changes", () => {
  const expected = raster();
  const recolored = raster(WIDTH, HEIGHT, 30);
  expect(computeWholeImageStructure(expected, recolored, WIDTH, HEIGHT).score).toBe(1);
  const patterned = raster();
  paint(patterned, 0, 0, WIDTH, HEIGHT);
  const lowContrast = patterned.map((value, index) => (index % 4 === 3 ? value : 120 + value / 10));
  expect(computeWholeImageStructure(patterned, lowContrast, WIDTH, HEIGHT).verdict).toBe("fail");
});

it("does not call entirely excluded or empty images a structural match", () => {
  const mask = new Uint8Array(WIDTH * HEIGHT).fill(1);
  expect(
    computeWholeImageStructure(raster(), raster(), WIDTH, HEIGHT, undefined, mask),
  ).toMatchObject({
    evaluatedPixelCount: 0,
    excludedPixelCount: WIDTH * HEIGHT,
    score: null,
    verdict: "inconclusive",
  });
  expect(() =>
    computeWholeImageStructure(new Uint8ClampedArray(), new Uint8ClampedArray(), 0, 0),
  ).toThrow();
});

it("weights partial windows and masks by measured pixel count", () => {
  const expected = raster(9, 8);
  const actual = raster(9, 8);
  for (let y = 0; y < 8; y += 1) actual[(y * 9 + 8) * 4] = y % 2 ? 0 : 255;
  const result = computeWholeImageStructure(expected, actual, 9, 8);
  expect(result.evaluatedPixelCount).toBe(72);
  expect(result.score).toBeGreaterThan(8 / 9);
  const mask = new Uint8Array(72);
  for (let y = 0; y < 8; y += 1) mask[y * 9 + 8] = 1;
  expect(computeWholeImageStructure(expected, actual, 9, 8, undefined, mask)).toMatchObject({
    score: 1,
    evaluatedPixelCount: 64,
    excludedPixelCount: 8,
  });
});

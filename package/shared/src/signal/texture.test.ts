import { describe, expect, it } from "vitest";

import { detectHighTextureRegion } from "./texture.js";

function createSolidPixels(width: number, height: number, value: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let index = 0; index < width * height; index++) {
    const rgbaIndex = index * 4;
    pixels[rgbaIndex] = value;
    pixels[rgbaIndex + 1] = value;
    pixels[rgbaIndex + 2] = value;
    pixels[rgbaIndex + 3] = 255;
  }

  return pixels;
}

function createNoisePixels(width: number, height: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  let seed = 17;

  for (let index = 0; index < width * height; index++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const value = seed % 256;
    const rgbaIndex = index * 4;
    pixels[rgbaIndex] = value;
    pixels[rgbaIndex + 1] = value;
    pixels[rgbaIndex + 2] = value;
    pixels[rgbaIndex + 3] = 255;
  }

  return pixels;
}

function createHorizontalStripePixels(width: number, height: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    const value = Math.floor(y / 4) % 2 === 0 ? 32 : 224;

    for (let x = 0; x < width; x++) {
      const rgbaIndex = (y * width + x) * 4;
      pixels[rgbaIndex] = value;
      pixels[rgbaIndex + 1] = value;
      pixels[rgbaIndex + 2] = value;
      pixels[rgbaIndex + 3] = 255;
    }
  }

  return pixels;
}

describe("detectHighTextureRegion", () => {
  it("solid-color region は textureScore が低く photo-like ではない", () => {
    const pixels = createSolidPixels(100, 100, 180);
    const result = detectHighTextureRegion(pixels, 100, 100, { x: 0, y: 0, w: 100, h: 100 });

    expect(result.textureScore).toBeLessThan(0.1);
    expect(result.isPhotoLike).toBe(false);
  });

  it("noise region は textureScore が高く photo-like になる", () => {
    const pixels = createNoisePixels(100, 100);
    const result = detectHighTextureRegion(pixels, 100, 100, { x: 0, y: 0, w: 100, h: 100 });

    expect(result.textureScore).toBeGreaterThan(0.8);
    expect(result.isPhotoLike).toBe(true);
  });

  it("text-block-like stripe region は中間 texture だが photo-like にはならない", () => {
    const pixels = createHorizontalStripePixels(100, 100);
    const result = detectHighTextureRegion(pixels, 100, 100, { x: 0, y: 0, w: 100, h: 100 });

    expect(result.textureScore).toBeGreaterThan(0.15);
    expect(result.textureScore).toBeLessThan(0.6);
    expect(result.isPhotoLike).toBe(false);
  });
});

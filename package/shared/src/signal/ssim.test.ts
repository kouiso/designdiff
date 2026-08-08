import { describe, expect, it } from "vitest";

import { computeSsim, computeSsimForRegion } from "./ssim.js";

const createSolidImage = (width: number, height: number, value: number): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let index = 0; index < width * height; index++) {
    const rgbaIndex = index * 4;
    pixels[rgbaIndex] = value;
    pixels[rgbaIndex + 1] = value;
    pixels[rgbaIndex + 2] = value;
    pixels[rgbaIndex + 3] = 255;
  }

  return pixels;
};

const createHalfDiffImage = (width: number, height: number): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const rgbaIndex = (y * width + x) * 4;
      const value = x < width / 2 ? 0 : 255;
      pixels[rgbaIndex] = value;
      pixels[rgbaIndex + 1] = value;
      pixels[rgbaIndex + 2] = value;
      pixels[rgbaIndex + 3] = 255;
    }
  }

  return pixels;
};

describe("computeSsim", () => {
  it("同一画像は 1.0 を返す", () => {
    const image = createSolidImage(16, 16, 128);
    const result = computeSsim(image, image, 16, 16);

    expect(result).toBeCloseTo(1, 6);
  });

  it("完全反転画像は 0 に近い値を返す", () => {
    const imageA = createSolidImage(16, 16, 0);
    const imageB = createSolidImage(16, 16, 255);
    const result = computeSsim(imageA, imageB, 16, 16);

    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThan(0.001);
  });

  it("既知の差分画像は中間値を返す", () => {
    const imageA = createSolidImage(16, 16, 0);
    const imageB = createHalfDiffImage(16, 16);
    const result = computeSsim(imageA, imageB, 16, 16);

    expect(result).toBeGreaterThan(0.45);
    expect(result).toBeLessThan(0.55);
  });
});

describe("computeSsimForRegion", () => {
  it("指定領域だけを評価し、別領域の差分に引きずられない", () => {
    const imageA = createSolidImage(16, 16, 0);
    const imageB = createSolidImage(16, 16, 0);

    for (let y = 8; y < 16; y++) {
      for (let x = 8; x < 16; x++) {
        const rgbaIndex = (y * 16 + x) * 4;
        imageB[rgbaIndex] = 255;
        imageB[rgbaIndex + 1] = 255;
        imageB[rgbaIndex + 2] = 255;
      }
    }

    const topLeftScore = computeSsimForRegion(imageA, imageB, 16, 16, { x: 0, y: 0, w: 8, h: 8 });
    const bottomRightScore = computeSsimForRegion(imageA, imageB, 16, 16, {
      x: 8,
      y: 8,
      w: 8,
      h: 8,
    });

    expect(topLeftScore).toBeCloseTo(1, 6);
    expect(bottomRightScore).toBeLessThan(0.001);
  });

  it("bbox を画像内にクランプして評価できる", () => {
    const imageA = createSolidImage(16, 16, 64);
    const imageB = createSolidImage(16, 16, 64);
    const result = computeSsimForRegion(imageA, imageB, 16, 16, { x: -4, y: -4, w: 12, h: 12 });

    expect(result).toBeCloseTo(1, 6);
  });

  it("クランプ後に空領域なら 1 を返す", () => {
    const imageA = createSolidImage(16, 16, 64);
    const imageB = createSolidImage(16, 16, 0);
    const result = computeSsimForRegion(imageA, imageB, 16, 16, { x: 20, y: 20, w: 8, h: 8 });

    expect(result).toBe(1);
  });

  it("マスクなしでは端数窓を従来どおり1窓として均等平均する", () => {
    const width = 33;
    const height = 8;
    const imageA = createSolidImage(width, height, 0);
    const imageB = createSolidImage(width, height, 0);

    for (let y = 0; y < height; y++) {
      const offset = (y * width + (width - 1)) * 4;
      imageB[offset] = 255;
      imageB[offset + 1] = 255;
      imageB[offset + 2] = 255;
    }

    const edgeWindowScore = computeSsimForRegion(imageA, imageB, width, height, {
      x: width - 1,
      y: 0,
      w: 1,
      h: height,
    });
    const result = computeSsimForRegion(imageA, imageB, width, height, {
      x: 0,
      y: 0,
      w: width,
      h: height,
    });

    expect(result).toBeCloseTo((4 + edgeWindowScore) / 5, 10);
  });

  it("マスクありでは各窓の有効画素数で重み付けする", () => {
    const width = 16;
    const height = 8;
    const imageA = createSolidImage(width, height, 0);
    const imageB = createSolidImage(width, height, 0);
    const ignoreMask = new Uint8Array(width * height);

    imageB[0] = 255;
    imageB[1] = 255;
    imageB[2] = 255;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < 8; x++) {
        ignoreMask[y * width + x] = 1;
      }
    }
    ignoreMask[0] = 0;

    const differingPixelScore = computeSsimForRegion(imageA, imageB, width, height, {
      x: 0,
      y: 0,
      w: 1,
      h: 1,
    });
    const result = computeSsimForRegion(
      imageA,
      imageB,
      width,
      height,
      { x: 0, y: 0, w: width, h: height },
      ignoreMask,
    );

    expect(result).toBeCloseTo((differingPixelScore + 64) / 65, 10);
  });

  it("マスク内の画素値を統計と分母から除外する", () => {
    const imageA = createSolidImage(16, 16, 32);
    const imageB = createSolidImage(16, 16, 32);
    const ignoreMask = new Uint8Array(16 * 16);

    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 16; x++) {
        const pixel = y * 16 + x;
        const offset = pixel * 4;
        ignoreMask[pixel] = 1;
        imageB[offset] = 255;
        imageB[offset + 1] = 255;
        imageB[offset + 2] = 255;
      }
    }

    expect(
      computeSsimForRegion(imageA, imageB, 16, 16, { x: 0, y: 0, w: 16, h: 16 }, ignoreMask),
    ).toBeCloseTo(1, 6);
  });

  it("広いマスクがあっても対象内の実差分は残す", () => {
    const imageA = createSolidImage(16, 16, 0);
    const imageB = createSolidImage(16, 16, 0);
    const ignoreMask = new Uint8Array(16 * 16).fill(1);

    for (let y = 8; y < 16; y++) {
      for (let x = 8; x < 16; x++) {
        const pixel = y * 16 + x;
        const offset = pixel * 4;
        ignoreMask[pixel] = 0;
        imageB[offset] = 255;
        imageB[offset + 1] = 255;
        imageB[offset + 2] = 255;
      }
    }

    expect(
      computeSsimForRegion(imageA, imageB, 16, 16, { x: 0, y: 0, w: 16, h: 16 }, ignoreMask),
    ).toBeLessThan(0.001);
  });
});

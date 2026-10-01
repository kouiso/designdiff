import { describe, expect, it } from "vitest";

import { classifyTextureResampling } from "./texture-resampling.js";

const SIZE = 40;

// 決定的な擬似写真領域。連続階調のまま高周波を含むパッチを作る。
const noiseField = (seed: number): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const hash = Math.abs(Math.sin(seed * 12.9898 + x * 78.233 + y * 37.719) * 43758.5453) % 1;
      const smooth = Math.sin((x + seed) * 0.35) * 40 + Math.cos((y - seed) * 0.3) * 40;
      const value = Math.max(0, Math.min(255, 128 + smooth + hash * 90 - 45));
      const offset = (y * SIZE + x) * 4;
      pixels[offset] = value;
      pixels[offset + 1] = Math.max(0, Math.min(255, value + smooth * 0.3));
      pixels[offset + 2] = Math.max(0, Math.min(255, value - smooth * 0.2));
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
};

// 隣接画素との線形混合。別スケーラのサブピクセルリサンプルで起きる
// 「構造は同一・画素値だけずれる」差分を近似する。
const resample = (src: Uint8ClampedArray, fraction: number): Uint8ClampedArray => {
  const out = new Uint8ClampedArray(src);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const next = Math.min(SIZE - 1, x + 1);
      for (let channel = 0; channel < 3; channel++) {
        const a = src[(y * SIZE + x) * 4 + channel];
        const b = src[(y * SIZE + next) * 4 + channel];
        out[(y * SIZE + x) * 4 + channel] = a * (1 - fraction) + b * fraction;
      }
    }
  }
  return out;
};

const flat = (value: number): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let pixel = 0; pixel < SIZE * SIZE; pixel++) {
    const offset = pixel * 4;
    pixels[offset] = value;
    pixels[offset + 1] = value;
    pixels[offset + 2] = value;
    pixels[offset + 3] = 255;
  }
  return pixels;
};

const BBOX = { x: 6, y: 6, w: 16, h: 16 };
const classify = (a: Uint8ClampedArray, b: Uint8ClampedArray) =>
  classifyTextureResampling(a, b, SIZE, SIZE, BBOX);

describe("classifyTextureResampling", () => {
  it("同一コンテンツのリサンプル差を texture-resampling として分類する", () => {
    const design = noiseField(3);
    const screenshot = resample(design, 0.5);
    expect(classify(design, screenshot)).toMatchObject({
      classification: "texture-resampling",
    });
  });

  it("片側が写真様でない領域を扱わない", () => {
    expect(classify(noiseField(3), flat(240))).toBeUndefined();
  });

  it("構造が保たれない別コンテンツを扱わない", () => {
    // 別シードのノイズは両側とも写真様だが構造が一致しない。
    expect(classify(noiseField(3), noiseField(17))).toBeUndefined();
  });

  it("差分ゼロの領域を扱わない", () => {
    const design = noiseField(3);
    expect(classify(design, design)).toBeUndefined();
  });
});

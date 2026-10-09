import pixelmatch from "pixelmatch";
import { describe, expect, it } from "vitest";

import { buildAntiAliasedMask } from "./anti-aliased-mask.js";

const WIDTH = 64;
const HEIGHT = 48;

const makeFlat = (r: number, g: number, b: number): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    pixels[i * 4] = r;
    pixels[i * 4 + 1] = g;
    pixels[i * 4 + 2] = b;
    pixels[i * 4 + 3] = 255;
  }
  return pixels;
};

// 白地に黒い縦棒 (両側に 1px のグレー縁つき) を立てたキャンバス。
// 文字の画線に見立てたもので、1px ずらすとグレー縁が AA 相当の差分になる。
// 縁の無い硬い帯だと pixelmatch も AA と判定しない (差分として数える) ため、
// 実際のラスタライズに近い中間調の縁を持たせる。
const makeBarCanvas = (barX: number): Uint8ClampedArray => {
  const pixels = makeFlat(255, 255, 255);
  for (let y = 4; y < HEIGHT - 4; y++) {
    for (const [x, v] of [
      [barX - 1, 128],
      [barX, 0],
      [barX + 1, 0],
      [barX + 2, 0],
      [barX + 3, 0],
      [barX + 4, 128],
    ] as const) {
      const offset = (y * WIDTH + x) * 4;
      pixels[offset] = v;
      pixels[offset + 1] = v;
      pixels[offset + 2] = v;
    }
  }
  return pixels;
};

// 決定的な擬似乱数の写真風キャンバス。シード固定で再現性を持たせる。
const makeNoiseCanvas = (seed: number): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  let state = seed >>> 0;
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    pixels[i * 4] = Math.floor(next() * 256);
    pixels[i * 4 + 1] = Math.floor(next() * 256);
    pixels[i * 4 + 2] = Math.floor(next() * 256);
    pixels[i * 4 + 3] = 255;
  }
  return pixels;
};

// 本家 pixelmatch を diffMask 無しで走らせ、AA 画素 (aaColor 黄) の位置集合を
// そのまま正本として返す。パリティの比較相手。
const pixelmatchAaPositions = (
  img1: Uint8ClampedArray,
  img2: Uint8ClampedArray,
  threshold: number,
): Set<number> => {
  const output = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  pixelmatch(img1, img2, output, WIDTH, HEIGHT, {
    threshold,
    checkerboard: false,
  });
  const positions = new Set<number>();
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    const offset = i * 4;
    if (output[offset] === 255 && output[offset + 1] === 255 && output[offset + 2] === 0) {
      positions.add(i);
    }
  }
  return positions;
};

const maskPositions = (mask: Uint8Array): Set<number> => {
  const positions = new Set<number>();
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 1) positions.add(i);
  }
  return positions;
};

describe("buildAntiAliasedMask", () => {
  it("1px ずれた画線のグレー縁を、本家 pixelmatch の AA 判定と完全一致で拾う", () => {
    const design = makeBarCanvas(24);
    const screenshot = makeBarCanvas(25);

    const mask = buildAntiAliasedMask(design, screenshot, WIDTH, HEIGHT, { threshold: 0.1 });

    // 画線を1pxずらしただけなので、縁には高振幅の差分画素が並ぶ。
    // それらが全て AA として拾われることを本家の出力で担保する。
    expect(maskPositions(mask)).toEqual(pixelmatchAaPositions(design, screenshot, 0.1));
    expect(maskPositions(mask).size).toBeGreaterThan(0);
  });

  it("写真風ノイズ画素同士の比較でも本家の AA 判定と一致する", () => {
    const design = makeNoiseCanvas(42);
    const screenshot = makeNoiseCanvas(77);

    const mask = buildAntiAliasedMask(design, screenshot, WIDTH, HEIGHT, { threshold: 0.1 });

    expect(maskPositions(mask)).toEqual(pixelmatchAaPositions(design, screenshot, 0.1));
  });

  it("ベタ面の一様な色ずれは AA と判定しない (残差の拾うべきずれを黙らせない)", () => {
    const design = makeFlat(255, 255, 255);
    const screenshot = makeFlat(235, 245, 240);

    const mask = buildAntiAliasedMask(design, screenshot, WIDTH, HEIGHT, { threshold: 0.1 });

    expect(maskPositions(mask).size).toBe(0);
    // 一様ずれでは本家も AA を出さないことの確認 (ガード)。
    expect(pixelmatchAaPositions(design, screenshot, 0.1).size).toBe(0);
  });

  it("閾値以下の差分画素は AA 判定の対象にしない", () => {
    const design = makeBarCanvas(24);
    const screenshot = makeBarCanvas(25);

    // threshold を 1 (最大) にすると全差分が閾値以下になり、AA 候補自体が無い。
    const mask = buildAntiAliasedMask(design, screenshot, WIDTH, HEIGHT, { threshold: 1 });

    expect(maskPositions(mask).size).toBe(0);
  });

  it("寸法と合わないバッファは黙って縮退せず弾く", () => {
    const flat = makeFlat(255, 255, 255);

    expect(() => buildAntiAliasedMask(flat, flat.subarray(0, 100), WIDTH, HEIGHT)).toThrow(
      /width \* height \* 4/,
    );
    expect(() => buildAntiAliasedMask(flat, flat, 0, HEIGHT)).toThrow(/positive integers/);
    expect(() => buildAntiAliasedMask(flat, flat, WIDTH, HEIGHT, { threshold: -1 })).toThrow(
      /non-negative finite/,
    );
  });
});

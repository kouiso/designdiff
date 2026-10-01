import { describe, expect, it } from "vitest";

import { classifyEdgeStraddle } from "./edge-straddle.js";

const WIDTH = 48;
const HEIGHT = 32;

// 縦棒の強縁を1本立てたキャンバス。左右で色を変えられる。
const makeEdgeCanvas = (edgeX: number, low: number, high: number): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    pixels[i * 4] = high;
    pixels[i * 4 + 1] = high;
    pixels[i * 4 + 2] = high;
    pixels[i * 4 + 3] = 255;
  }
  for (let y = 6; y < 26; y++) {
    for (let x = edgeX; x < edgeX + 4; x++) {
      const offset = (y * WIDTH + x) * 4;
      pixels[offset] = low;
      pixels[offset + 1] = low;
      pixels[offset + 2] = low;
    }
  }
  return pixels;
};

// 平坦なベタ面キャンバス。縁が無い領域を作る。
const makeFlatCanvas = (value: number): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    pixels[i * 4] = value;
    pixels[i * 4 + 1] = value;
    pixels[i * 4 + 2] = value;
    pixels[i * 4 + 3] = 255;
  }
  return pixels;
};

const BBOX = { x: 8, y: 4, w: 32, h: 24 };

describe("classifyEdgeStraddle", () => {
  it("同じ位置の強縁をラスタライザが±1pxずらした差分を救済する", () => {
    const design = makeEdgeCanvas(20, 0, 255);
    const screenshot = makeEdgeCanvas(21, 0, 255);

    const result = classifyEdgeStraddle(design, screenshot, WIDTH, HEIGHT, BBOX);

    expect(result).toBeDefined();
    expect(result?.classification).toBe("edge-straddle-rasterization");
    expect(result?.straddleCoverage).toBeGreaterThanOrEqual(0.85);
  });

  it("片側にしか存在しない要素の差分は救済しない", () => {
    const design = makeFlatCanvas(255);
    const screenshot = makeEdgeCanvas(20, 0, 255);

    const result = classifyEdgeStraddle(design, screenshot, WIDTH, HEIGHT, BBOX);

    // 縁が片側だけなので straddle coverage が足りず弾かれる。
    expect(result).toBeUndefined();
  });

  it("ベタ面の塗り替え (縁の無い内部画素の差分) は救済しない", () => {
    const design = makeFlatCanvas(255);
    const screenshot = makeFlatCanvas(255);
    // 縁の無い中央領域を暗く塗り替える。
    for (let y = 12; y < 20; y++) {
      for (let x = 16; x < 28; x++) {
        const offset = (y * WIDTH + x) * 4;
        screenshot[offset] = 30;
        screenshot[offset + 1] = 30;
        screenshot[offset + 2] = 30;
      }
    }

    const result = classifyEdgeStraddle(design, screenshot, WIDTH, HEIGHT, BBOX);

    expect(result).toBeUndefined();
  });

  it("端点色が違う (別トークンへの塗り替え様) 差分は救済しない", () => {
    const design = makeEdgeCanvas(20, 0, 255);
    // 同じ縁だが暗側が別色 (0 -> 80)。別トークン相当の端点ずれ。
    const screenshot = makeEdgeCanvas(21, 80, 255);

    const result = classifyEdgeStraddle(design, screenshot, WIDTH, HEIGHT, BBOX);

    expect(result).toBeUndefined();
  });

  it("端点色の小数ずれは許容差内で救済する", () => {
    // 境界をまたぐ2列だけが変わるAAスミア様差分。design の 0|255 の鋭い縁を
    // screenshot が 16|240 ににじませる。端点色のずれは16/15で許容差24内。
    const design = makeEdgeCanvas(20, 0, 255);
    const screenshot = makeEdgeCanvas(20, 0, 255);
    for (let y = 6; y < 26; y++) {
      const left = (y * WIDTH + 19) * 4;
      screenshot[left] = 240;
      screenshot[left + 1] = 240;
      screenshot[left + 2] = 240;
      const right = (y * WIDTH + 20) * 4;
      screenshot[right] = 16;
      screenshot[right + 1] = 16;
      screenshot[right + 2] = 16;
    }

    const result = classifyEdgeStraddle(design, screenshot, WIDTH, HEIGHT, BBOX);

    expect(result).toBeDefined();
    expect(result?.designLowHex).toBe("#000000");
    expect(result?.screenshotLowHex).toBe("#101010");
    expect(result?.screenshotHighHex).toBe("#F0F0F0");
  });

  it("端点を結ぶ線分から外れた別色が混ざる差分は救済しない", () => {
    // 縁のずれ自体は edge-straddle の範囲だが、縁の明暗補間では説明できない
    // 赤系の別色が1画素でも混ざれば実害の可能性を残す。
    const design = makeEdgeCanvas(20, 0, 255);
    const screenshot = makeEdgeCanvas(21, 0, 255);
    const red = (10 * WIDTH + 10) * 4;
    screenshot[red] = 200;
    screenshot[red + 1] = 40;
    screenshot[red + 2] = 40;

    const result = classifyEdgeStraddle(design, screenshot, WIDTH, HEIGHT, BBOX);

    expect(result).toBeUndefined();
  });

  it("差分画素がゼロのとき救済対象を返さない", () => {
    const canvas = makeEdgeCanvas(20, 0, 255);

    const result = classifyEdgeStraddle(canvas, canvas, WIDTH, HEIGHT, BBOX);

    expect(result).toBeUndefined();
  });
});

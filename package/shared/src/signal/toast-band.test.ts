import { describe, expect, it } from "vitest";

import { detectToastBands } from "./toast-band.js";

const W = 200;
const H = 800;

function canvas(rgb: readonly [number, number, number]): Uint8Array {
  const pixels = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    pixels[i * 4] = rgb[0];
    pixels[i * 4 + 1] = rgb[1];
    pixels[i * 4 + 2] = rgb[2];
    pixels[i * 4 + 3] = 255;
  }
  return pixels;
}

function band(
  pixels: Uint8Array,
  y: number,
  height: number,
  rgb: readonly [number, number, number],
): void {
  for (let row = y; row < y + height; row++) {
    for (let x = 0; x < W; x++) {
      const i = (row * W + x) * 4;
      pixels[i] = rgb[0];
      pixels[i + 1] = rgb[1];
      pixels[i + 2] = rgb[2];
    }
  }
}

function noise(pixels: Uint8Array, y: number, height: number): void {
  for (let row = y; row < y + height; row++) {
    for (let x = 0; x < W; x++) {
      const i = (row * W + x) * 4;
      const v = (x * 37 + row * 91) % 256;
      pixels[i] = v;
      pixels[i + 1] = 255 - v;
      pixels[i + 2] = (v * 3) % 256;
    }
  }
}

describe("detectToastBands", () => {
  it("真っ白なだけの画面では何も出さない", () => {
    expect(detectToastBands(canvas([255, 255, 255]), W, H)).toEqual([]);
  });

  it("下部の暗い帯をトースト候補として拾う", () => {
    const pixels = canvas([255, 255, 255]);
    band(pixels, 700, 60, [32, 32, 32]);

    const found = detectToastBands(pixels, W, H);

    expect(found).toHaveLength(1);
    expect(found[0].y).toBe(700);
    expect(found[0].height).toBe(60);
    expect(found[0].position).toBe("bottom");
    expect(found[0].width).toBe(W);
  });

  it("上部の帯は top として返す", () => {
    const pixels = canvas([255, 255, 255]);
    band(pixels, 40, 50, [20, 20, 30]);

    const found = detectToastBands(pixels, W, H);

    expect(found).toHaveLength(1);
    expect(found[0].position).toBe("top");
  });

  it("画面中央の帯は拾わない", () => {
    const pixels = canvas([255, 255, 255]);
    band(pixels, 380, 50, [32, 32, 32]);

    expect(detectToastBands(pixels, W, H)).toEqual([]);
  });

  it("帯が大きすぎればセクションとみなして拾わない", () => {
    const pixels = canvas([255, 255, 255]);
    band(pixels, 600, 200, [32, 32, 32]);

    expect(detectToastBands(pixels, W, H)).toEqual([]);
  });

  it("帯が小さすぎれば拾わない", () => {
    const pixels = canvas([255, 255, 255]);
    band(pixels, 760, 3, [32, 32, 32]);

    expect(detectToastBands(pixels, W, H)).toEqual([]);
  });

  it("周囲と明るさが近い帯は拾わない", () => {
    const pixels = canvas([255, 255, 255]);
    band(pixels, 700, 60, [240, 240, 240]);

    expect(detectToastBands(pixels, W, H)).toEqual([]);
  });

  it("模様のある領域はべた塗りではないので拾わない", () => {
    const pixels = canvas([255, 255, 255]);
    noise(pixels, 700, 60);

    expect(detectToastBands(pixels, W, H)).toEqual([]);
  });

  it("上下に2つあれば両方返す", () => {
    const pixels = canvas([255, 255, 255]);
    band(pixels, 30, 50, [20, 20, 20]);
    band(pixels, 700, 50, [20, 20, 20]);

    const found = detectToastBands(pixels, W, H);

    expect(found).toHaveLength(2);
    expect(found.map((f) => f.position)).toEqual(["top", "bottom"]);
  });

  it("暗い背景に明るい帯でも拾う", () => {
    const pixels = canvas([16, 16, 16]);
    band(pixels, 700, 60, [240, 240, 240]);

    const found = detectToastBands(pixels, W, H);

    expect(found).toHaveLength(1);
    expect(found[0].contrast).toBeGreaterThan(40);
  });

  it("閾値を上げると拾わなくなる", () => {
    const pixels = canvas([255, 255, 255]);
    band(pixels, 700, 60, [180, 180, 180]);

    expect(detectToastBands(pixels, W, H)).toHaveLength(1);
    expect(detectToastBands(pixels, W, H, { minLuminanceContrast: 200 })).toEqual([]);
  });

  it("寸法が不正なら拒否する", () => {
    expect(() => detectToastBands(canvas([255, 255, 255]), 0, H)).toThrow(/寸法が不正/);
  });

  it("画素配列が寸法に足りなければ拒否する", () => {
    expect(() => detectToastBands(new Uint8Array(16), W, H)).toThrow(/足りません/);
  });
});

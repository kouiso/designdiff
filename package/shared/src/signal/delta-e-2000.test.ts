import { describe, expect, it } from "vitest";

import {
  computeMeanDeltaE2000,
  computePerceptibleDiffRatio,
  PERCEPTIBLE_DELTA_E,
} from "./delta-e-2000.js";

function canvas(
  width: number,
  height: number,
  paint: (x: number, y: number) => [number, number, number],
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = paint(x, y);
      const i = (y * width + x) * 4;
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}

const W = 100;
const H = 100;

// 走査ロジックを computePerceptibleDiffRatio と共有させたので、平均側も固定する。
describe("computeMeanDeltaE2000", () => {
  it("returns 0 for identical images", () => {
    const a = canvas(W, H, () => [120, 130, 140]);
    expect(computeMeanDeltaE2000(a, a, 0, 0, W, H, W)).toBe(0);
  });

  it("stays below the perceptible threshold for a one-step shift", () => {
    const a = canvas(W, H, () => [120, 130, 140]);
    const b = canvas(W, H, () => [121, 131, 141]);
    expect(computeMeanDeltaE2000(a, b, 0, 0, W, H, W)).toBeLessThan(PERCEPTIBLE_DELTA_E);
  });

  // 6割だけが大きく違う面。平均は閾値 2 を下回るのに、見える差は過半を占める。
  // 平均ひとつでは拾えないことを、割合の信号と並べて示す。
  it("can fall below the threshold while most of the frame differs visibly", () => {
    const a = canvas(W, H, () => [120, 130, 140]);
    const b = canvas(W, H, (_x, y) => (y < 60 ? [126, 130, 140] : [120, 130, 140]));

    expect(computeMeanDeltaE2000(a, b, 0, 0, W, H, W)).toBeLessThan(PERCEPTIBLE_DELTA_E);
  });
});

// 平均 ΔE は広い無変化領域に引きずられて閾値を下回る。「画面の過半が目に見えて
// 違う」という別の問いに答えるための信号なので、平均とは独立に検証する。
describe("computePerceptibleDiffRatio", () => {
  it("returns 0 for identical images", () => {
    const a = canvas(W, H, () => [120, 130, 140]);
    expect(computePerceptibleDiffRatio(a, a, 0, 0, W, H, W)).toBe(0);
  });

  // 1段の量子化ノイズは ΔE が知覚の境目に届かないので数に入らない。
  // matchRate なら strict profile で全画素が「差分」に数えられる領域。
  it("ignores a one-step shift that is below perception", () => {
    const a = canvas(W, H, () => [120, 130, 140]);
    const b = canvas(W, H, () => [121, 131, 141]);
    expect(computePerceptibleDiffRatio(a, b, 0, 0, W, H, W)).toBe(0);
  });

  it("counts a clearly visible shift across the whole frame", () => {
    const a = canvas(W, H, () => [120, 130, 140]);
    const b = canvas(W, H, () => [190, 90, 90]);
    expect(computePerceptibleDiffRatio(a, b, 0, 0, W, H, W)).toBe(1);
  });

  // 平均では拾えない形: 6割だけが大きく違い、残り4割は完全一致。
  it("reports the visible share even when the mean stays low", () => {
    const a = canvas(W, H, () => [120, 130, 140]);
    const b = canvas(W, H, (_x, y) => (y < 60 ? [190, 90, 90] : [120, 130, 140]));

    const ratio = computePerceptibleDiffRatio(a, b, 0, 0, W, H, W);
    expect(ratio).toBeGreaterThan(0.55);
    expect(ratio).toBeLessThan(0.65);
  });

  it("honours the region bounds", () => {
    const a = canvas(W, H, () => [120, 130, 140]);
    const b = canvas(W, H, (_x, y) => (y < 50 ? [190, 90, 90] : [120, 130, 140]));

    expect(computePerceptibleDiffRatio(a, b, 0, 0, W, 50, W)).toBe(1);
    expect(computePerceptibleDiffRatio(a, b, 0, 50, W, H, W)).toBe(0);
  });
});

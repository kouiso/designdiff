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
  it("rejects empty, mismatched, and partial RGBA buffers", () => {
    const image = canvas(W, H, () => [120, 130, 140]);
    expect(() => computeMeanDeltaE2000(new Uint8ClampedArray(), image, 0, 0, W, H, W)).toThrow(
      /must not be empty/,
    );
    expect(() =>
      computeMeanDeltaE2000(image, image.subarray(0, image.length - 4), 0, 0, W, H, W),
    ).toThrow(/equal lengths/);
    expect(() =>
      computeMeanDeltaE2000(
        image.subarray(0, image.length - 1),
        image.subarray(0, image.length - 1),
        0,
        0,
        W,
        H,
        W,
      ),
    ).toThrow(/complete RGBA/);
  });

  it("rejects a non-positive or unsafe width", () => {
    const image = canvas(W, H, () => [120, 130, 140]);
    for (const width of [0, -1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => computeMeanDeltaE2000(image, image, 0, 0, W, H, width)).toThrow(
        /width must be a positive safe integer/,
      );
    }
  });

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

  it("excludes masked pixels from the mean while retaining an unmasked defect", () => {
    const a = canvas(W, H, () => [20, 20, 20]);
    const b = canvas(W, H, (_x, y) => (y < 90 ? [255, 255, 255] : [200, 20, 20]));
    const ignoreMask = new Uint8Array(W * H);
    for (let y = 0; y < 90; y++) {
      ignoreMask.fill(1, y * W, (y + 1) * W);
    }

    const score = computeMeanDeltaE2000(a, b, 0, 0, W, H, W, ignoreMask);
    expect(score).toBeGreaterThan(PERCEPTIBLE_DELTA_E);
  });

  it("does not let masked content affect the mean", () => {
    const a = canvas(W, H, () => [20, 20, 20]);
    const b = canvas(W, H, (_x, y) => (y < 90 ? [255, 255, 255] : [20, 20, 20]));
    const ignoreMask = new Uint8Array(W * H);
    for (let y = 0; y < 90; y++) {
      ignoreMask.fill(1, y * W, (y + 1) * W);
    }

    expect(computeMeanDeltaE2000(a, b, 0, 0, W, H, W, ignoreMask)).toBe(0);
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

  // 格納された RGB が同じでも、透明度が違えば見た目には出る。pixelmatch は
  // アルファを合成して差として数えるので、こちらが 0 を返すと矛盾を見逃す。
  it("counts an opacity difference that RGB alone cannot see", () => {
    const opaqueBlack = new Uint8ClampedArray(W * H * 4);
    const transparentBlack = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i += 1) {
      opaqueBlack[i * 4 + 3] = 255;
      transparentBlack[i * 4 + 3] = 0;
    }
    // 片側だけ完全透明だと「存在しない画素」ではなく「白に見える画素」になる。
    expect(computePerceptibleDiffRatio(opaqueBlack, transparentBlack, 0, 0, W, H, W)).toBe(1);
  });

  it("skips pixels that are transparent on both sides", () => {
    const a = new Uint8ClampedArray(W * H * 4);
    const b = new Uint8ClampedArray(W * H * 4);
    expect(computePerceptibleDiffRatio(a, b, 0, 0, W, H, W)).toBe(0);
  });

  // 比較の対象外に置いた画素を数えると、比率が薄まって矛盾を見逃す。
  it("keeps masked pixels out of the denominator", () => {
    const a = canvas(W, H, () => [120, 130, 140]);
    const b = canvas(W, H, (_x, y) => (y < 40 ? [190, 90, 90] : [120, 130, 140]));

    // 下60行をマスクすると、残り40行はすべて見える差になる。
    const ignoreMask = new Uint8Array(W * H);
    for (let y = 40; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) ignoreMask[y * W + x] = 1;
    }

    expect(computePerceptibleDiffRatio(a, b, 0, 0, W, H, W)).toBeCloseTo(0.4, 2);
    expect(computePerceptibleDiffRatio(a, b, 0, 0, W, H, W, { ignoreMask })).toBe(1);
  });

  // 間引くと周期的な模様がサンプルの隙間に入り込み、画面の大半が違っても 0 になりうる。
  it("sees a periodic pattern that a fixed lattice would step over", () => {
    const size = 400;
    const a = canvas(size, size, () => [120, 130, 140]);
    const b = canvas(size, size, (x, y) =>
      x % 4 === 0 && y % 4 === 0 ? [120, 130, 140] : [190, 90, 90],
    );

    // 4x4 のうち 1 点だけが一致。残り 15/16 は見える差。
    const ratio = computePerceptibleDiffRatio(a, b, 0, 0, size, size, size);
    expect(ratio).toBeCloseTo(15 / 16, 2);
  });

  // 0 は「見える差が無い」と読まれる。壊れた入力で 0 を返すと無効な比較を合格させる。
  it("rejects inputs that would collapse to nothing instead of returning 0", () => {
    const a = canvas(W, H, () => [120, 130, 140]);
    const empty = new Uint8ClampedArray(0);

    expect(() => computePerceptibleDiffRatio(empty, empty, 0, 0, 10, 10, 10)).toThrow(/empty/);
    // 順序が逆の範囲
    expect(() => computePerceptibleDiffRatio(a, a, 50, 50, 10, 10, W)).toThrow(
      /does not intersect/,
    );
    // 画像の外
    expect(() => computePerceptibleDiffRatio(a, a, 500, 500, 600, 600, W)).toThrow(
      /does not intersect/,
    );
  });

  // 短いマスクは欠けた位置が undefined になり、黙って対象内として数えられる。
  it("rejects an ignore mask that does not cover every pixel", () => {
    const a = canvas(W, H, () => [120, 130, 140]);

    expect(() =>
      computePerceptibleDiffRatio(a, a, 0, 0, W, H, W, { ignoreMask: new Uint8Array(10) }),
    ).toThrow(/must cover every pixel/);
  });

  // 人間レビューへ回すときの証拠になるので、どこが違ったかを書き出せること。
  it("writes the differing pixels into the output mask", () => {
    const a = canvas(W, H, () => [120, 130, 140]);
    const b = canvas(W, H, (_x, y) => (y < 40 ? [190, 90, 90] : [120, 130, 140]));
    const outMask = new Uint8Array(W * H);

    computePerceptibleDiffRatio(a, b, 0, 0, W, H, W, { outMask });

    expect(outMask[0]).toBe(1);
    expect(outMask[(H - 1) * W]).toBe(0);
    expect(outMask.reduce((sum, v) => sum + v, 0)).toBe(40 * W);
  });

  it("honours the region bounds", () => {
    const a = canvas(W, H, () => [120, 130, 140]);
    const b = canvas(W, H, (_x, y) => (y < 50 ? [190, 90, 90] : [120, 130, 140]));

    expect(computePerceptibleDiffRatio(a, b, 0, 0, W, 50, W)).toBe(1);
    expect(computePerceptibleDiffRatio(a, b, 0, 50, W, H, W)).toBe(0);
  });
});

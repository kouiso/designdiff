import { describe, expect, it } from "vitest";

import {
  COARSE_SAMPLE_STEP,
  countSsdOffset,
  detectTranslation,
  resolveAlignment,
  shiftPixels,
} from "./translation.js";

const WIDTH = 120;
const HEIGHT = 90;

/** 全面を base 色で塗り、指定矩形だけ mark 色にした RGBA を作る。 */
function makeImage(
  base: number,
  mark?: { x: number; y: number; w: number; h: number; value: number },
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = base;
    pixels[index + 1] = base;
    pixels[index + 2] = base;
    pixels[index + 3] = 255;
  }
  if (mark) {
    for (let y = mark.y; y < mark.y + mark.h; y++) {
      for (let x = mark.x; x < mark.x + mark.w; x++) {
        const offset = (y * WIDTH + x) * 4;
        pixels[offset] = mark.value;
        pixels[offset + 1] = mark.value;
        pixels[offset + 2] = mark.value;
      }
    }
  }
  return pixels;
}

function makeVerticalPattern(): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) {
    const value = (y * 37) % 251;
    for (let x = 0; x < WIDTH; x++) {
      const offset = (y * WIDTH + x) * 4;
      pixels[offset] = value;
      pixels[offset + 1] = (value + x * 11) % 251;
      pixels[offset + 2] = (value + x * 19) % 251;
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

function shiftDownForSystemInset(
  design: Uint8ClampedArray,
  inset: number,
): { screenshot: Uint8ClampedArray; ignoreMask: Uint8Array } {
  const screenshot = new Uint8ClampedArray(design.length);
  const ignoreMask = new Uint8Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const pixel = y * WIDTH + x;
      const offset = pixel * 4;
      if (y < inset) {
        ignoreMask[pixel] = 1;
        screenshot[offset] = design[offset];
        screenshot[offset + 1] = design[offset + 1];
        screenshot[offset + 2] = design[offset + 2];
        screenshot[offset + 3] = design[offset + 3];
        continue;
      }
      const sourceOffset = ((y - inset) * WIDTH + x) * 4;
      screenshot[offset] = design[sourceOffset];
      screenshot[offset + 1] = design[sourceOffset + 1];
      screenshot[offset + 2] = design[sourceOffset + 2];
      screenshot[offset + 3] = design[sourceOffset + 3];
    }
  }
  return { screenshot, ignoreMask };
}

// 下地を黒にする。白地だと、画像の外へ出た画素の罰が平行移動の得より大きくなり、
// 「ずれているが動かさない方が良い」という別の正しい判断が出てしまう。
describe("detectTranslation", () => {
  it("同じ画像ならずれ 0 を返すこと", () => {
    const image = makeImage(0, { x: 30, y: 20, w: 20, h: 20, value: 255 });

    const result = detectTranslation(image, image, WIDTH, HEIGHT);

    expect(result.dx).toBe(0);
    expect(result.dy).toBe(0);
    expect(result.residual).toBe(0);
  });

  it("横 7px ずらした画像のずれを言い当てること", () => {
    const design = makeImage(0, { x: 30, y: 20, w: 20, h: 20, value: 255 });
    const screenshot = makeImage(0, { x: 37, y: 20, w: 20, h: 20, value: 255 });

    const result = detectTranslation(design, screenshot, WIDTH, HEIGHT);

    expect(result.dx).toBe(7);
    expect(result.dy).toBe(0);
  });

  it("縦横どちらもずれた画像を言い当てること", () => {
    const design = makeImage(0, { x: 30, y: 20, w: 20, h: 20, value: 255 });
    const screenshot = makeImage(0, { x: 24, y: 23, w: 20, h: 20, value: 255 });

    const result = detectTranslation(design, screenshot, WIDTH, HEIGHT);

    expect(result.dx).toBe(-6);
    expect(result.dy).toBe(3);
  });

  it("system UI mask の画素を探索から外し、本文の縦位置を言い当てること", () => {
    const inset = 72;
    const design = makeVerticalPattern();
    const { screenshot, ignoreMask } = shiftDownForSystemInset(design, inset);

    const result = detectTranslation(design, screenshot, WIDTH, HEIGHT, ignoreMask, [
      { dx: 0, dy: inset },
    ]);

    expect(result.dx).toBe(0);
    expect(result.dy).toBe(inset);
  });
});

describe("shiftPixels", () => {
  it("画像の外へ出た画素は透明のままにすること", () => {
    const source = makeImage(200);

    const shifted = shiftPixels(source, WIDTH, HEIGHT, 5, 0);

    // 左端5列は移動元が無いので埋まらない。
    expect(shifted[0]).toBe(0);
    expect(shifted[3]).toBe(0);
    // 移動先には元の色が入る。
    const inside = (10 * WIDTH + 50) * 4;
    expect(shifted[inside]).toBe(200);
    expect(shifted[inside + 3]).toBe(255);
  });
});

describe("countSsdOffset", () => {
  it("画像の外を必ず違いとして数えるかどうかで結果が変わること", () => {
    const design = makeImage(0);
    const screenshot = makeImage(0);

    const lenient = countSsdOffset(
      design,
      screenshot,
      WIDTH,
      HEIGHT,
      20,
      0,
      COARSE_SAMPLE_STEP,
      false,
    );
    const strict = countSsdOffset(
      design,
      screenshot,
      WIDTH,
      HEIGHT,
      20,
      0,
      COARSE_SAMPLE_STEP,
      true,
    );

    // 黒どうしなので緩い数え方では一致に見える。厳しい数え方だと外へ出た分が残る。
    expect(lenient).toBe(0);
    expect(strict).toBeGreaterThan(0);
  });

  it("ignoreMask の画素は差分数と探索母数へ入れないこと", () => {
    const design = makeImage(0);
    const screenshot = makeImage(255);
    const ignoreMask = new Uint8Array(WIDTH * HEIGHT).fill(1);

    expect(
      countSsdOffset(
        design,
        screenshot,
        WIDTH,
        HEIGHT,
        0,
        0,
        COARSE_SAMPLE_STEP,
        false,
        ignoreMask,
      ),
    ).toBe(0);
  });
});

describe("resolveAlignment", () => {
  // 小さな図形のずれでは、動かして画像の外へ出る分の損が勝つ。適用されるのは
  // 画面の大半が同じだけずれている場合だけで、これは意図した歯止め。
  it("画面の大半が同じだけずれていれば適用し、動かした画素を返すこと", () => {
    const design = makeImage(0, { x: 10, y: 10, w: 100, h: 70, value: 255 });
    const screenshot = makeImage(0, { x: 17, y: 10, w: 100, h: 70, value: 255 });

    const result = resolveAlignment(design, screenshot, WIDTH, HEIGHT);

    expect(result.applied).toBe(true);
    expect(result.alignment.translation).toEqual({ x: 7, y: 0 });
    expect(result.alignedDesignPixels).not.toBe(design);
  });

  it("小さな図形だけのずれでは、動かさない方を選ぶこと", () => {
    const design = makeImage(0, { x: 30, y: 20, w: 20, h: 20, value: 255 });
    const screenshot = makeImage(0, { x: 37, y: 20, w: 20, h: 20, value: 255 });

    const result = resolveAlignment(design, screenshot, WIDTH, HEIGHT);

    // ずれ自体は検出しつつ、動かすと損になるので適用しない。
    expect(result.alignment.translation).toEqual({ x: 7, y: 0 });
    expect(result.applied).toBe(false);
    expect(result.alignedDesignPixels).toBe(design);
  });

  it("同じ画像では動かさず、元の画素をそのまま返すこと", () => {
    const image = makeImage(0, { x: 30, y: 20, w: 20, h: 20, value: 255 });

    const result = resolveAlignment(image, image, WIDTH, HEIGHT);

    expect(result.applied).toBe(false);
    expect(result.alignedDesignPixels).toBe(image);
  });

  it("倍率と回転は常に恒等で返すこと", () => {
    const image = makeImage(0, { x: 30, y: 20, w: 20, h: 20, value: 255 });

    const result = resolveAlignment(image, image, WIDTH, HEIGHT);

    expect(result.alignment.scale).toEqual({ x: 1, y: 1 });
    expect(result.alignment.rotation).toBe(0);
  });

  it("system UI mask を除いた本文の縦位置補正を適用すること", () => {
    const inset = 72;
    const design = makeVerticalPattern();
    const { screenshot, ignoreMask } = shiftDownForSystemInset(design, inset);

    const result = resolveAlignment(design, screenshot, WIDTH, HEIGHT, ignoreMask, [
      { dx: 0, dy: inset },
    ]);

    expect(result.applied).toBe(true);
    expect(result.alignment.translation).toEqual({ x: 0, y: inset });
  });
});

describe("countSsdOffset の入力検査", () => {
  it("0 や負の刻みは弾くこと", () => {
    const image = makeImage(0);

    // 走査が終わらずプロセスが固まるより、その場で止める。
    expect(() => countSsdOffset(image, image, WIDTH, HEIGHT, 0, 0, 0)).toThrow(/positive integer/);
    expect(() => countSsdOffset(image, image, WIDTH, HEIGHT, 0, 0, -1)).toThrow(/positive integer/);
  });

  it("画像より短い ignoreMask は弾くこと", () => {
    const image = makeImage(0);

    expect(() =>
      countSsdOffset(
        image,
        image,
        WIDTH,
        HEIGHT,
        0,
        0,
        COARSE_SAMPLE_STEP,
        false,
        new Uint8Array(WIDTH * HEIGHT - 1),
      ),
    ).toThrow(/ignoreMask buffer too small/);
  });

  it("小数ピクセルの追加候補は弾くこと", () => {
    const image = makeImage(0);

    expect(() =>
      detectTranslation(image, image, WIDTH, HEIGHT, undefined, [{ dx: 0, dy: 1.5 }]),
    ).toThrow(/integer pixels/);
  });
});

describe("手がかりの無い画像の扱い", () => {
  it("一様な画像では、動かさない位置を選ぶこと", () => {
    const flat = makeImage(0);

    const result = detectTranslation(flat, flat, WIDTH, HEIGHT);

    // どの位置でも同じ数になる。走査順の先頭を拾うと、無いずれを報告してしまう。
    expect(result.dx).toBe(0);
    expect(result.dy).toBe(0);
  });

  it("一様な画像では位置合わせも適用しないこと", () => {
    const flat = makeImage(0);

    const result = resolveAlignment(flat, flat, WIDTH, HEIGHT);

    expect(result.alignment.translation).toEqual({ x: 0, y: 0 });
    expect(result.applied).toBe(false);
  });
});

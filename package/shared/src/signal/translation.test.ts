import { describe, expect, it } from "vitest";

import {
  COARSE_SAMPLE_STEP,
  SCALE_DETECTION_TOLERANCE,
  SCALE_MIN_AXIS_LENGTH,
  SCALE_SPARSE_SCENE_TOLERANCE,
  buildVerifiedInsetCandidates,
  computeRegionResiduals,
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

const shiftDownForSystemInset = (
  design: Uint8ClampedArray,
  inset: number,
): { screenshot: Uint8ClampedArray; ignoreMask: Uint8Array } => {
  if (!Number.isInteger(inset) || inset < 0 || inset >= HEIGHT) {
    throw new Error(`inset must be an integer from 0 through ${HEIGHT - 1}`);
  }
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
};

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
    expect(result.alignment.applied).toBe(true);
    expect(result.alignment.baselineResidual).toBeGreaterThan(
      result.alignment.correctedResidual ?? 0,
    );
    const sampledCount = WIDTH * HEIGHT;
    expect(result.alignment.correctedResidual).toBe(
      countSsdOffset(design, screenshot, WIDTH, HEIGHT, 7, 0, 1, false) / sampledCount,
    );
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
    expect(result.alignment.applied).toBe(false);
    expect(result.alignment.source).toBe("auto");
    expect(result.alignedDesignPixels).toBe(design);
  });

  it("同じ画像では動かさず、元の画素をそのまま返すこと", () => {
    const image = makeImage(0, { x: 30, y: 20, w: 20, h: 20, value: 255 });

    const result = resolveAlignment(image, image, WIDTH, HEIGHT);

    expect(result.applied).toBe(false);
    expect(result.alignedDesignPixels).toBe(image);
  });

  it("移動量が0でも不一致の残差を測定すること", () => {
    const design = makeImage(0, { x: 30, y: 20, w: 20, h: 20, value: 255 });
    const screenshot = makeImage(0, { x: 30, y: 20, w: 20, h: 20, value: 128 });

    const result = resolveAlignment(design, screenshot, WIDTH, HEIGHT);

    expect(result.alignment.translation).toEqual({ x: 0, y: 0 });
    expect(result.alignment.baselineResidual).toBeGreaterThan(0);
    expect(result.alignment.correctedResidual).toBe(result.alignment.baselineResidual);
  });

  it("同じ画像では倍率を恒等で返し、倍率の原点を載せないこと", () => {
    const image = makeImage(0, { x: 30, y: 20, w: 20, h: 20, value: 255 });

    const result = resolveAlignment(image, image, WIDTH, HEIGHT);

    expect(result.alignment.scale).toEqual({ x: 1, y: 1 });
    expect(result.alignment.scaleOffset).toBeUndefined();
    expect(result.alignment.rotation).toBe(0);
  });

  it("system UI mask を除いた本文の縦位置補正を適用すること", () => {
    const inset = 72;
    const design = makeVerticalPattern();
    const { screenshot, ignoreMask } = shiftDownForSystemInset(design, inset);

    const result = resolveAlignment(
      design,
      screenshot,
      WIDTH,
      HEIGHT,
      ignoreMask,
      buildVerifiedInsetCandidates(inset),
    );

    expect(result.applied).toBe(true);
    expect(result.alignment.translation).toEqual({ x: 0, y: inset });
    expect(result.alignment.source).toBe("verified-system-ui");
  });

  it("system UI inset の±1px候補は自動補正として記録すること", () => {
    const inset = 72;
    const design = makeVerticalPattern();
    const { screenshot, ignoreMask } = shiftDownForSystemInset(design, inset + 1);

    const result = resolveAlignment(
      design,
      screenshot,
      WIDTH,
      HEIGHT,
      ignoreMask,
      buildVerifiedInsetCandidates(inset),
    );

    expect(result.applied).toBe(true);
    expect(result.alignment.translation).toEqual({ x: 0, y: inset + 1 });
    expect(result.alignment.source).toBe("auto");
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

  it("system UI inset fixture は範囲外の値を弾くこと", () => {
    const image = makeVerticalPattern();
    expect(() => shiftDownForSystemInset(image, -1)).toThrow(/integer/);
    expect(() => shiftDownForSystemInset(image, 0.5)).toThrow(/integer/);
    expect(() => shiftDownForSystemInset(image, HEIGHT)).toThrow(/integer/);
  });
});

describe("手がかりの無い画像の扱い", () => {
  it("64px未満の不一致でもdetectTranslationとresolveAlignmentの残差を揃えること", () => {
    const design = new Uint8ClampedArray(4 * 4 * 4);
    const screenshot = new Uint8ClampedArray(4 * 4 * 4);
    design[0] = 255;
    screenshot[0] = 0;
    screenshot[4] = 255;

    const detected = detectTranslation(design, screenshot, 4, 4);
    const resolved = resolveAlignment(design, screenshot, 4, 4);

    expect(detected.residual).toBeGreaterThan(0);
    expect(resolved.alignment.baselineResidual).toBe(detected.residual);
    expect(resolved.alignment.correctedResidual).toBe(detected.residual);
  });

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

describe("位置合わせの画像寸法検査", () => {
  const invalidDimensions = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY];

  it.each(invalidDimensions)("detectTranslationは不正なwidth=%sを弾くこと", (width) => {
    const image = new Uint8ClampedArray(0);

    expect(() => detectTranslation(image, image, width, 1)).toThrow(/positive safe integers/);
  });

  it.each(invalidDimensions)("detectTranslationは不正なheight=%sを弾くこと", (height) => {
    const image = new Uint8ClampedArray(0);

    expect(() => detectTranslation(image, image, 1, height)).toThrow(/positive safe integers/);
  });

  it.each(invalidDimensions)("resolveAlignmentは不正なwidth=%sを弾くこと", (width) => {
    const image = new Uint8ClampedArray(0);

    expect(() => resolveAlignment(image, image, width, 1)).toThrow(/positive safe integers/);
  });

  it.each(invalidDimensions)("resolveAlignmentは不正なheight=%sを弾くこと", (height) => {
    const image = new Uint8ClampedArray(0);

    expect(() => resolveAlignment(image, image, 1, height)).toThrow(/positive safe integers/);
  });
});

// 拡大縮小の検体は、検出器と同じ写し方で作ると検出器の自己採点になる。設計の
// 連続座標で定義した図形を、撮影側の画素ごとに 2x2 点で面積平均して描く。
// 繰り返し模様にすると別の倍率でも重なってしまうので、大きさと位置を不揃いにする。
const SCENE_WIDTH = 400;
const SCENE_HEIGHT = 300;

type Rgb = readonly [number, number, number];

interface SceneRect {
  x: number;
  y: number;
  w: number;
  h: number;
  rgb: Rgb;
}

const SCENE_RECTS: readonly SceneRect[] = [
  { x: 12, y: 10, w: 150, h: 34, rgb: [220, 60, 40] },
  { x: 180, y: 14, w: 96, h: 22, rgb: [40, 200, 90] },
  { x: 300, y: 8, w: 88, h: 58, rgb: [60, 80, 230] },
  { x: 20, y: 62, w: 58, h: 118, rgb: [240, 220, 50] },
  { x: 96, y: 70, w: 184, h: 12, rgb: [200, 200, 200] },
  { x: 96, y: 96, w: 132, h: 7, rgb: [150, 90, 210] },
  { x: 250, y: 88, w: 41, h: 93, rgb: [30, 180, 190] },
  { x: 310, y: 120, w: 70, h: 31, rgb: [250, 140, 20] },
  { x: 110, y: 130, w: 23, h: 23, rgb: [255, 255, 255] },
  { x: 150, y: 140, w: 77, h: 49, rgb: [120, 40, 60] },
  { x: 30, y: 205, w: 210, h: 16, rgb: [90, 160, 40] },
  { x: 262, y: 198, w: 118, h: 84, rgb: [210, 110, 170] },
  { x: 44, y: 238, w: 67, h: 44, rgb: [70, 130, 250] },
  { x: 128, y: 246, w: 99, h: 9, rgb: [230, 230, 120] },
  { x: 140, y: 266, w: 31, h: 20, rgb: [180, 60, 230] },
];

interface SceneTransform {
  sx: number;
  sy: number;
  ox: number;
  oy: number;
}

interface Scene {
  width: number;
  height: number;
  rects: readonly SceneRect[];
  // 図形の無い所の色。縮めた撮影の外側も同じ色で描く。実際の画面は、設計の外も
  // 同じ背景が続くので、黒で埋めると縮小の外側が「たまたま一致」に見えてしまう。
  background: Rgb;
}

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];
const FIXED_SCENE: Scene = {
  width: SCENE_WIDTH,
  height: SCENE_HEIGHT,
  rects: SCENE_RECTS,
  background: BLACK,
};
const IDENTITY_TRANSFORM: SceneTransform = { sx: 1, sy: 1, ox: 0, oy: 0 };

/** 種から同じ並びを毎回作る乱数。テストの失敗を同じ検体で再現できるようにする。 */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * 大きさ・位置・色が不揃いの矩形を並べた画面を作る。
 *
 * 固定の1枚だけで確かめると、その配置でたまたま通る検出器を見逃す。
 * 種を変えた複数の画面で同じ性質を確かめる。
 */
function randomScene(seed: number, width: number, height: number, count: number): Scene {
  const random = seededRandom(seed);
  const rects: SceneRect[] = [];
  for (let index = 0; index < count; index++) {
    const w = 8 + random() * width * 0.25;
    const h = 6 + random() * height * 0.15;
    const x = random() * (width - w);
    const y = random() * (height - h);
    const rgb: Rgb = [
      Math.floor(random() * 255),
      Math.floor(random() * 255),
      Math.floor(random() * 255),
    ];
    rects.push({ x, y, w, h, rgb });
  }
  return { width, height, rects, background: WHITE };
}

function sceneColorAt(scene: Scene, u: number, v: number): Rgb {
  let color = scene.background;
  for (const rect of scene.rects) {
    if (u >= rect.x && u < rect.x + rect.w && v >= rect.y && v < rect.y + rect.h) {
      color = rect.rgb;
    }
  }
  return color;
}

/** 設計の点 (u, v) が撮影の (sx*u+ox, sy*v+oy) に写る画像を描く。 */
function renderScene(transform: SceneTransform, scene: Scene = FIXED_SCENE): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(scene.width * scene.height * 4);
  const subSamples = 2;
  const count = subSamples * subSamples;
  for (let y = 0; y < scene.height; y++) {
    for (let x = 0; x < scene.width; x++) {
      const sum = [0, 0, 0];
      for (let sample = 0; sample < count; sample++) {
        const i = sample % subSamples;
        const j = Math.floor(sample / subSamples);
        const color = sceneColorAt(
          scene,
          (x + (i + 0.5) / subSamples - transform.ox) / transform.sx,
          (y + (j + 0.5) / subSamples - transform.oy) / transform.sy,
        );
        sum[0] += color[0];
        sum[1] += color[1];
        sum[2] += color[2];
      }
      const offset = (y * scene.width + x) * 4;
      pixels[offset] = Math.round(sum[0] / count);
      pixels[offset + 1] = Math.round(sum[1] / count);
      pixels[offset + 2] = Math.round(sum[2] / count);
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

// 400x300 の平行移動探索を1件ごとに回すので、並列実行で CPU が混むと既定の 5 秒を超える。
describe("拡大縮小の検出", { timeout: 30_000 }, () => {
  const design = renderScene(IDENTITY_TRANSFORM);

  it("縦横同じ倍率で拡大した画像の倍率を許容誤差内で返すこと", () => {
    const screenshot = renderScene({ sx: 1.1, sy: 1.1, ox: 0, oy: 0 });

    const result = resolveAlignment(design, screenshot, SCENE_WIDTH, SCENE_HEIGHT);

    expect(Math.abs(result.alignment.scale.x - 1.1)).toBeLessThanOrEqual(SCALE_DETECTION_TOLERANCE);
    expect(Math.abs(result.alignment.scale.y - 1.1)).toBeLessThanOrEqual(SCALE_DETECTION_TOLERANCE);
    expect(result.alignment.scaleOffset).toBeDefined();
  });

  it("縦横で違う倍率と平行移動が同時にある画像を言い当てること", () => {
    const screenshot = renderScene({ sx: 0.92, sy: 1.07, ox: 14, oy: -9 });

    const result = resolveAlignment(design, screenshot, SCENE_WIDTH, SCENE_HEIGHT);

    expect(Math.abs(result.alignment.scale.x - 0.92)).toBeLessThanOrEqual(
      SCALE_DETECTION_TOLERANCE,
    );
    expect(Math.abs(result.alignment.scale.y - 1.07)).toBeLessThanOrEqual(
      SCALE_DETECTION_TOLERANCE,
    );
    // 原点は倍率の誤差に画像の幅を掛けた分まで動く。2px 以内なら同じ写し方と読める。
    expect(Math.abs((result.alignment.scaleOffset?.x ?? Number.NaN) - 14)).toBeLessThanOrEqual(2);
    expect(Math.abs((result.alignment.scaleOffset?.y ?? Number.NaN) + 9)).toBeLessThanOrEqual(2);
  });

  it("横だけ縮めた画像では縦の倍率を1のまま返すこと", () => {
    const screenshot = renderScene({ sx: 0.88, sy: 1, ox: 0, oy: 0 });

    const result = resolveAlignment(design, screenshot, SCENE_WIDTH, SCENE_HEIGHT);

    expect(Math.abs(result.alignment.scale.x - 0.88)).toBeLessThanOrEqual(
      SCALE_DETECTION_TOLERANCE,
    );
    expect(result.alignment.scale.y).toBe(1);
  });

  it("平行移動だけの画像では倍率を恒等で返すこと", () => {
    const screenshot = renderScene({ sx: 1, sy: 1, ox: 7, oy: -4 });

    const result = resolveAlignment(design, screenshot, SCENE_WIDTH, SCENE_HEIGHT);

    expect(result.alignment.translation).toEqual({ x: 7, y: -4 });
    expect(result.alignment.scale).toEqual({ x: 1, y: 1 });
    expect(result.alignment.scaleOffset).toBeUndefined();
  });

  it("倍率を検出しても、平行移動の値と適用する画素は変えないこと", () => {
    const screenshot = renderScene({ sx: 1.08, sy: 1.08, ox: 0, oy: 0 });

    const detected = detectTranslation(design, screenshot, SCENE_WIDTH, SCENE_HEIGHT);
    const result = resolveAlignment(design, screenshot, SCENE_WIDTH, SCENE_HEIGHT);

    expect(result.alignment.scale.x).not.toBe(1);
    expect(result.alignment.translation).toEqual({ x: detected.dx, y: detected.dy });
    expect(result.alignment.residual).toBe(detected.residual);
    // 平行移動の門を通る検体にして、適用した画素が平行移動だけで決まることを確かめる。
    expect(result.applied).toBe(true);
    const expected = shiftPixels(design, SCENE_WIDTH, SCENE_HEIGHT, detected.dx, detected.dy);
    // 48万要素の配列を toEqual で比べると、差分表示の準備だけで秒単位かかる。
    let mismatched = 0;
    for (let index = 0; index < expected.length; index++) {
      if (result.alignedDesignPixels[index] !== expected[index]) mismatched++;
    }
    expect(result.alignedDesignPixels.length).toBe(expected.length);
    expect(mismatched).toBe(0);
  });

  it("一様な画像では倍率を恒等で返すこと", () => {
    const flat = makeImage(0);

    const result = resolveAlignment(flat, flat, WIDTH, HEIGHT);

    expect(result.alignment.scale).toEqual({ x: 1, y: 1 });
    expect(result.alignment.scaleOffset).toBeUndefined();
  });

  it("全画素を ignoreMask で外した画像では倍率を恒等で返すこと", () => {
    const screenshot = renderScene({ sx: 1.1, sy: 1.1, ox: 0, oy: 0 });
    const ignoreMask = new Uint8Array(SCENE_WIDTH * SCENE_HEIGHT).fill(1);

    const result = resolveAlignment(design, screenshot, SCENE_WIDTH, SCENE_HEIGHT, ignoreMask);

    expect(result.alignment.scale).toEqual({ x: 1, y: 1 });
    expect(result.alignment.scaleOffset).toBeUndefined();
  });
});

describe("computeRegionResiduals", () => {
  it("領域ごとに、全体の残差と同じ単位で不一致の割合を返すこと", () => {
    const design = makeImage(0);
    const screenshot = makeImage(0, { x: 10, y: 10, w: 20, h: 15, value: 255 });

    const residuals = computeRegionResiduals(design, screenshot, WIDTH, HEIGHT, [
      { regionId: "left", bbox: { x: 0, y: 0, w: 60, h: 45 } },
      { regionId: "right", bbox: { x: 60, y: 0, w: 60, h: 45 } },
    ]);

    expect(residuals).toEqual([
      { regionId: "left", residual: (20 * 15) / (60 * 45) },
      { regionId: "right", residual: 0 },
    ]);
  });

  it("画像全体を1つの領域にすると、動かさない位置の全体の残差と一致すること", () => {
    const design = makeImage(0, { x: 30, y: 20, w: 20, h: 20, value: 255 });
    const screenshot = makeImage(0, { x: 36, y: 25, w: 20, h: 20, value: 200 });

    const residuals = computeRegionResiduals(design, screenshot, WIDTH, HEIGHT, [
      { regionId: "whole", bbox: { x: 0, y: 0, w: WIDTH, h: HEIGHT } },
    ]);

    expect(residuals).toEqual([
      {
        regionId: "whole",
        residual: countSsdOffset(design, screenshot, WIDTH, HEIGHT, 0, 0, 1) / (WIDTH * HEIGHT),
      },
    ]);
    expect(residuals[0]?.residual).toBeGreaterThan(0);
  });

  it("ignoreMask の画素は分子にも分母にも入れないこと", () => {
    const design = makeImage(0);
    const screenshot = makeImage(0, { x: 0, y: 0, w: 10, h: 45, value: 255 });
    const ignoreMask = new Uint8Array(WIDTH * HEIGHT);
    for (let y = 0; y < 45; y++) {
      for (let x = 0; x < 10; x++) ignoreMask[y * WIDTH + x] = 1;
    }

    const residuals = computeRegionResiduals(
      design,
      screenshot,
      WIDTH,
      HEIGHT,
      [{ regionId: "left", bbox: { x: 0, y: 0, w: 60, h: 45 } }],
      ignoreMask,
    );

    expect(residuals).toEqual([{ regionId: "left", residual: 0 }]);
  });

  it("画像の外へはみ出た領域は画像の内側だけで数えること", () => {
    const design = makeImage(0);
    const screenshot = makeImage(255);

    const residuals = computeRegionResiduals(design, screenshot, WIDTH, HEIGHT, [
      { regionId: "edge", bbox: { x: 100, y: 80, w: 50, h: 50 } },
    ]);

    expect(residuals).toEqual([{ regionId: "edge", residual: 1 }]);
  });

  it("測れる画素が無い領域は 0 と書かずに載せないこと", () => {
    const image = makeImage(0);
    const ignoreMask = new Uint8Array(WIDTH * HEIGHT).fill(1);

    const outside = computeRegionResiduals(image, image, WIDTH, HEIGHT, [
      { regionId: "outside", bbox: { x: WIDTH + 5, y: 0, w: 10, h: 10 } },
      { regionId: "empty", bbox: { x: 10, y: 10, w: 0, h: 10 } },
      { regionId: "inside", bbox: { x: 0, y: 0, w: 10, h: 10 } },
    ]);
    const masked = computeRegionResiduals(
      image,
      image,
      WIDTH,
      HEIGHT,
      [{ regionId: "masked", bbox: { x: 0, y: 0, w: 10, h: 10 } }],
      ignoreMask,
    );

    expect(outside).toEqual([{ regionId: "inside", residual: 0 }]);
    expect(masked).toEqual([]);
  });

  it("寸法や画素の並びが壊れている場合は弾くこと", () => {
    const image = makeImage(0);
    const regions = [{ regionId: "a", bbox: { x: 0, y: 0, w: 10, h: 10 } }];

    expect(() => computeRegionResiduals(image, image, 0, HEIGHT, regions)).toThrow(
      /positive safe integers/,
    );
    expect(() =>
      computeRegionResiduals(image.subarray(0, 8), image, WIDTH, HEIGHT, regions),
    ).toThrow(/buffer too small/);
    expect(() =>
      computeRegionResiduals(image, image, WIDTH, HEIGHT, [
        { regionId: "nan", bbox: { x: Number.NaN, y: 0, w: 10, h: 10 } },
      ]),
    ).toThrow(/finite/);
  });
});

// 白地の画面で縮めると、撮影の右と下に設計の外の帯ができる。帯の扱いが
// 候補ごとに違うと、正しい倍率の候補だけが損をする (#437 の反証で見つかった)。
describe("白地の画面での拡大縮小の検出", { timeout: 60_000 }, () => {
  const SEEDS = [2000, 2001, 2002, 2003, 2004];

  it.each([0.9, 0.95])("縦横 %s 倍に縮めた画像の両軸の倍率を許容誤差内で返すこと", (scale) => {
    for (const seed of SEEDS) {
      const scene = randomScene(seed, SCENE_WIDTH, SCENE_HEIGHT, 30);
      const design = renderScene(IDENTITY_TRANSFORM, scene);
      const screenshot = renderScene({ sx: scale, sy: scale, ox: 0, oy: 0 }, scene);

      const { alignment } = resolveAlignment(design, screenshot, SCENE_WIDTH, SCENE_HEIGHT);

      expect({ seed, x: Math.abs(alignment.scale.x - scale) <= SCALE_DETECTION_TOLERANCE }).toEqual(
        { seed, x: true },
      );
      expect({ seed, y: Math.abs(alignment.scale.y - scale) <= SCALE_DETECTION_TOLERANCE }).toEqual(
        { seed, y: true },
      );
      expect(alignment.scaleStatus).toEqual({ x: "detected", y: "detected" });
    }
  });

  it("縮小と平行移動が同時にある画像でも両軸の倍率を返すこと", () => {
    const scene = randomScene(1007, SCENE_WIDTH, SCENE_HEIGHT, 30);
    const design = renderScene(IDENTITY_TRANSFORM, scene);
    const screenshot = renderScene({ sx: 0.9605, sy: 0.9605, ox: 19, oy: -4 }, scene);

    const { alignment } = resolveAlignment(design, screenshot, SCENE_WIDTH, SCENE_HEIGHT);

    expect(Math.abs(alignment.scale.x - 0.9605)).toBeLessThanOrEqual(SCALE_DETECTION_TOLERANCE);
    expect(Math.abs(alignment.scale.y - 0.9605)).toBeLessThanOrEqual(SCALE_DETECTION_TOLERANCE);
  });

  it("平行移動だけの白地の画像では、両軸とも測ったうえで倍率無しと返すこと", () => {
    const scene = randomScene(2005, SCENE_WIDTH, SCENE_HEIGHT, 30);
    const design = renderScene(IDENTITY_TRANSFORM, scene);
    const screenshot = renderScene({ sx: 1, sy: 1, ox: 9, oy: -6 }, scene);

    const { alignment } = resolveAlignment(design, screenshot, SCENE_WIDTH, SCENE_HEIGHT);

    expect(alignment.scale).toEqual({ x: 1, y: 1 });
    expect(alignment.scaleOffset).toBeUndefined();
    expect(alignment.scaleStatus).toEqual({ x: "none", y: "none" });
  });

  // 範囲の外の倍率は、範囲の中の別の倍率で一部だけ重なって 15% の門を通ってしまう。
  // 外れた値を自信ありげに返すより、測れなかったと返す方が読み手を誤らせない。
  it.each([
    { sx: 1.27, sy: 1.27 },
    { sx: 1.3, sy: 1.3 },
    { sx: 4 / 3, sy: 4 / 3 },
    { sx: 1.3, sy: 1 },
  ])("範囲の外の倍率 ($sx, $sy) は倍率として返さないこと", ({ sx, sy }) => {
    const scene = randomScene(7, SCENE_WIDTH, SCENE_HEIGHT, 40);
    const design = renderScene(IDENTITY_TRANSFORM, scene);
    const screenshot = renderScene({ sx, sy, ox: 0, oy: 0 }, scene);

    const { alignment } = resolveAlignment(design, screenshot, SCENE_WIDTH, SCENE_HEIGHT);

    expect(alignment.scale).toEqual({ x: 1, y: 1 });
    expect(alignment.scaleOffset).toBeUndefined();
    expect(alignment.scaleStatus?.x).toBe("unmeasured");
    if (sy !== 1) expect(alignment.scaleStatus?.y).toBe("unmeasured");
  });

  it.each([
    { width: 40, height: 30 },
    { width: 64, height: 48 },
  ])("小さい画像 ($width x $height) では倍率を測らなかったと返すこと", ({ width, height }) => {
    const scene = randomScene(3, width, height, 4);
    const design = renderScene(IDENTITY_TRANSFORM, scene);
    const screenshot = renderScene({ sx: 1.1, sy: 1.1, ox: 0, oy: 0 }, scene);

    const { alignment } = resolveAlignment(design, screenshot, width, height);

    expect(alignment.scale).toEqual({ x: 1, y: 1 });
    expect(alignment.scaleStatus).toEqual({ x: "unmeasured", y: "unmeasured" });
  });

  it("片方の軸だけ短い画像では、長い軸だけを測ること", () => {
    const width = SCENE_WIDTH;
    const height = SCALE_MIN_AXIS_LENGTH - 1;
    const scene = randomScene(11, width, height, 20);
    const design = renderScene(IDENTITY_TRANSFORM, scene);
    const screenshot = renderScene({ sx: 1.1, sy: 1, ox: 0, oy: 0 }, scene);

    const { alignment } = resolveAlignment(design, screenshot, width, height);

    expect(Math.abs(alignment.scale.x - 1.1)).toBeLessThanOrEqual(SCALE_DETECTION_TOLERANCE);
    expect(alignment.scale.y).toBe(1);
    expect(alignment.scaleStatus).toEqual({ x: "detected", y: "unmeasured" });
  });
});

// 矩形6枚の輪郭の少ない画面では、192px の軸の倍率が 0.01 を超えて外れる検体がある。
// 0.01 を保証と書いた版 (9cee34a2) への反証で見つかった。外れ幅を文書の値に固定し、
// 「0.01 は輪郭の多い画面の目安」であることを保つ。
describe("輪郭の少ない画面での倍率の検出", { timeout: 60_000 }, () => {
  const SPARSE_CASES = [
    { seed: 8200, scale: 1.1 },
    { seed: 8203, scale: 1.2 },
    { seed: 8200, scale: 0.82 },
  ];

  function errorsFor(seed: number, scale: number) {
    const scene = randomScene(seed, 192, 300, 6);
    const design = renderScene(IDENTITY_TRANSFORM, scene);
    const screenshot = renderScene({ sx: scale, sy: scale, ox: 0, oy: 0 }, scene);
    const { alignment } = resolveAlignment(design, screenshot, 192, 300);
    return {
      alignment,
      x: Math.abs(alignment.scale.x - scale),
      y: Math.abs(alignment.scale.y - scale),
    };
  }

  it("矩形6枚の画面は検出でき、誤差は文書の疎な画面の幅に収まること", () => {
    for (const { seed, scale } of SPARSE_CASES) {
      const { alignment, x, y } = errorsFor(seed, scale);
      expect({ seed, scale, status: alignment.scaleStatus }).toEqual({
        seed,
        scale,
        status: { x: "detected", y: "detected" },
      });
      expect({ seed, scale, within: x <= SCALE_SPARSE_SCENE_TOLERANCE }).toEqual({
        seed,
        scale,
        within: true,
      });
      expect({ seed, scale, within: y <= SCALE_SPARSE_SCENE_TOLERANCE }).toEqual({
        seed,
        scale,
        within: true,
      });
    }
  });

  it("疎な画面の幅は、輪郭の多い画面の 0.01 より広いこと", () => {
    // 0.01 が疎な画面にも効くと読まれないよう、外れる検体が残る間は幅を分けておく。
    // 推定が良くなってこの検体が 0.01 に収まったら、文書の幅を狭めてこの検査を外す。
    const worst = Math.max(...SPARSE_CASES.map(({ seed, scale }) => errorsFor(seed, scale).x));
    expect(worst).toBeGreaterThan(SCALE_DETECTION_TOLERANCE);
    expect(SCALE_SPARSE_SCENE_TOLERANCE).toBeGreaterThan(SCALE_DETECTION_TOLERANCE);
  });
});

describe("computeRegionResiduals と平行移動で空いた帯", () => {
  it("適用した平行移動で空いた帯は数えず、帯の外だけで割合を出すこと", () => {
    const width = SCENE_WIDTH;
    const height = SCENE_HEIGHT;
    const content = randomScene(5, width, height, 25).rects.map((rect) => ({
      ...rect,
      x: Math.max(70, rect.x),
    }));
    const scene: Scene = {
      width,
      height,
      rects: [{ x: 0, y: 0, w: width, h: 30, rgb: [20, 40, 90] }, ...content],
      background: WHITE,
    };
    const design = renderScene(IDENTITY_TRANSFORM, scene);
    const screenshot = renderScene({ sx: 1, sy: 1, ox: 12, oy: 0 }, scene);
    const resolved = resolveAlignment(design, screenshot, width, height);
    expect(resolved.applied).toBe(true);
    expect(resolved.alignment.translation).toEqual({ x: 12, y: 0 });

    const residuals = computeRegionResiduals(
      resolved.alignedDesignPixels,
      screenshot,
      width,
      height,
      [
        { regionId: "sidebar", bbox: { x: 0, y: 30, w: 60, h: 240 } },
        { regionId: "header", bbox: { x: 0, y: 0, w: width, h: 30 } },
        { regionId: "strip-only", bbox: { x: 0, y: 40, w: 12, h: 20 } },
      ],
      undefined,
      resolved.alignment.translation,
    );

    expect(residuals).toEqual([
      { regionId: "sidebar", residual: 0 },
      { regionId: "header", residual: 0 },
    ]);
  });

  it("1画素幅の領域と画素より小さい領域も、間引く画像で落とさずに数えること", () => {
    const width = 1200;
    const height = 1000;
    const design = new Uint8ClampedArray(width * height * 4);
    const screenshot = new Uint8ClampedArray(width * height * 4);
    // 奇数の列と行だけを違う色にして、間引きの格子に乗らない画素だけが違う形にする。
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        const value = x === 101 || y === 201 || (x === 10 && y === 10) ? 255 : 0;
        screenshot[offset] = value;
        screenshot[offset + 1] = value;
        screenshot[offset + 2] = value;
        screenshot[offset + 3] = 255;
        design[offset + 3] = 255;
      }
    }

    const residuals = computeRegionResiduals(design, screenshot, width, height, [
      { regionId: "odd-column", bbox: { x: 101, y: 0, w: 1, h: height } },
      { regionId: "odd-row", bbox: { x: 0, y: 201, w: width, h: 1 } },
      { regionId: "fraction", bbox: { x: 10.4, y: 10.4, w: 0.5, h: 0.5 } },
    ]);

    expect(residuals).toEqual([
      { regionId: "odd-column", residual: 1 },
      { regionId: "odd-row", residual: 1 },
      { regionId: "fraction", residual: 1 },
    ]);
  });
});

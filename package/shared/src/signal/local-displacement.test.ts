import { describe, expect, it } from "vitest";

import { classifyLocalDisplacement } from "./local-displacement.js";

// 実画面 (Figma 正本 vs Flutter 実測) で観測した細線パターンの合成レプリカ。
// 色は実測値。元画面は非公開リポジトリにあるため、幾何と色だけを再現する。
const WIDTH = 80;
const HEIGHT = 60;
type Rgb = readonly [number, number, number];
const WHITE: Rgb = [255, 255, 255];
const BORDER: Rgb = [0xcc, 0xeb, 0xd8];
const CARD_FILL: Rgb = [0xeb, 0xf8, 0xf0];
const PINK_LINE: Rgb = [0xec, 0xb7, 0xb4];
const GRAY_BORDER: Rgb = [0xd9, 0xd9, 0xd9];
const CARET_GREEN: Rgb = [0x19, 0xc4, 0x7a];

const canvas = (fill: Rgb = WHITE): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    pixels.set([fill[0], fill[1], fill[2], 255], i * 4);
  }
  return pixels;
};

const paint = (
  pixels: Uint8ClampedArray,
  x: number,
  y: number,
  w: number,
  h: number,
  rgb: Rgb,
): void => {
  for (let row = y; row < y + h; row++) {
    for (let col = x; col < x + w; col++) {
      pixels.set([rgb[0], rgb[1], rgb[2], 255], (row * WIDTH + col) * 4);
    }
  }
};

// 上辺1pxの枠線 + 内側の塗りを持つカード。
const card = (pixels: Uint8ClampedArray, top: number): void => {
  paint(pixels, 10, top, 60, 1, BORDER);
  paint(pixels, 10, top + 1, 60, 20, CARD_FILL);
};

describe("classifyLocalDisplacement", () => {
  it("カード上辺の枠線が1pxずれただけの差分を変位として証明する", () => {
    const design = canvas();
    const screenshot = canvas();
    card(design, 20);
    card(screenshot, 21);

    const evidence = classifyLocalDisplacement(design, screenshot, WIDTH, HEIGHT, {
      x: 10,
      y: 20,
      w: 60,
      h: 2,
    });

    expect(evidence).toMatchObject({ classification: "local-displacement", dx: 0, dy: 1 });
    expect(evidence?.alignedDeltaE).toBeLessThan(0.5);
    expect(evidence?.unalignedDeltaE).toBeGreaterThan(2);
  });

  it("1px幅の縦線が3pxずれた差分を証明する (上限ちょうど)", () => {
    const design = canvas();
    const screenshot = canvas();
    paint(design, 40, 10, 1, 40, PINK_LINE);
    paint(screenshot, 37, 10, 1, 40, PINK_LINE);

    const evidence = classifyLocalDisplacement(design, screenshot, WIDTH, HEIGHT, {
      x: 37,
      y: 10,
      w: 1,
      h: 40,
    });

    expect(evidence).toMatchObject({ dx: -3, dy: 0 });
  });

  it("上限を超える4pxのずれは証明しない", () => {
    const design = canvas();
    const screenshot = canvas();
    paint(design, 40, 10, 1, 40, PINK_LINE);
    paint(screenshot, 36, 10, 1, 40, PINK_LINE);

    expect(
      classifyLocalDisplacement(design, screenshot, WIDTH, HEIGHT, { x: 36, y: 10, w: 1, h: 40 }),
    ).toBeUndefined();
  });

  it("screenshot 側にだけある細い要素 (離れた位置のカーソル) は証明しない", () => {
    // 正本ではカーソルが11px右にあり、窓の外。ずらし評価の窓は常に region を
    // 含むので、どのオフセットでも緑の画素が不一致として残る。
    const design = canvas();
    const screenshot = canvas();
    paint(design, 51, 20, 2, 20, CARET_GREEN);
    paint(screenshot, 40, 20, 2, 20, CARET_GREEN);

    expect(
      classifyLocalDisplacement(design, screenshot, WIDTH, HEIGHT, { x: 40, y: 20, w: 2, h: 20 }),
    ).toBeUndefined();
  });

  it("位置が同じで線の色だけ違う差分は証明しない", () => {
    const design = canvas();
    const screenshot = canvas();
    paint(design, 10, 30, 60, 1, GRAY_BORDER);
    paint(screenshot, 10, 30, 60, 1, PINK_LINE);

    expect(
      classifyLocalDisplacement(design, screenshot, WIDTH, HEIGHT, { x: 10, y: 30, w: 60, h: 1 }),
    ).toBeUndefined();
  });

  it("ずれた先で色も変わっている線は証明しない", () => {
    const design = canvas();
    const screenshot = canvas();
    paint(design, 10, 30, 60, 1, GRAY_BORDER);
    paint(screenshot, 10, 31, 60, 1, PINK_LINE);

    expect(
      classifyLocalDisplacement(design, screenshot, WIDTH, HEIGHT, { x: 10, y: 30, w: 60, h: 2 }),
    ).toBeUndefined();
  });

  it("画像端の領域でも片側だけの要素を窓の外へ逃がさない", () => {
    const design = canvas();
    const screenshot = canvas();
    paint(screenshot, 0, 20, 2, 20, CARET_GREEN);

    expect(
      classifyLocalDisplacement(design, screenshot, WIDTH, HEIGHT, { x: 0, y: 20, w: 2, h: 20 }),
    ).toBeUndefined();
  });

  it("太い領域は対象外にする", () => {
    const design = canvas();
    const screenshot = canvas();
    paint(design, 20, 20, 20, 20, GRAY_BORDER);
    paint(screenshot, 21, 20, 20, 20, GRAY_BORDER);

    expect(
      classifyLocalDisplacement(design, screenshot, WIDTH, HEIGHT, { x: 20, y: 20, w: 21, h: 20 }),
    ).toBeUndefined();
  });

  it("長い線の一部が欠けている差分は、線全体がずれていても証明しない", () => {
    // 長い線ほど欠落が窓全体の割合では薄まる。欠落は線に沿って連なるので
    // 残差の塊の大きさで弾けることを確かめる。
    const width = 1100;
    const height = 20;
    const make = (): Uint8ClampedArray => new Uint8ClampedArray(width * height * 4).fill(255);
    const line = (pixels: Uint8ClampedArray, x0: number, x1: number, y: number): void => {
      for (let x = x0; x < x1; x++) pixels.set([...GRAY_BORDER, 255], (y * width + x) * 4);
    };
    const design = make();
    const screenshot = make();
    line(design, 50, 1050, 8);
    line(screenshot, 50, 500, 10);
    line(screenshot, 510, 1050, 10);
    const bbox = { x: 50, y: 8, w: 1000, h: 3 };

    expect(classifyLocalDisplacement(design, screenshot, width, height, bbox)).toBeUndefined();

    // 欠落が無ければ同じ線は証明できる (欠落以外の条件で落ちていないことの確認)。
    line(screenshot, 500, 510, 10);
    expect(classifyLocalDisplacement(design, screenshot, width, height, bbox)).toMatchObject({
      dx: 0,
      dy: 2,
    });
  });

  it("4K 幅の全幅区切り線も証明の対象にする", () => {
    const width = 3840;
    const height = 16;
    const design = new Uint8ClampedArray(width * height * 4).fill(255);
    const screenshot = new Uint8ClampedArray(width * height * 4).fill(255);
    for (let x = 0; x < width; x++) {
      design.set([...BORDER, 255], (6 * width + x) * 4);
      screenshot.set([...BORDER, 255], (7 * width + x) * 4);
    }

    expect(
      classifyLocalDisplacement(design, screenshot, width, height, { x: 0, y: 6, w: width, h: 2 }),
    ).toMatchObject({ dx: 0, dy: 1 });
  });

  it("探索幅が整数 1..3 以外なら走査せずに例外にする", () => {
    const design = canvas();
    const screenshot = canvas();
    const bbox = { x: 10, y: 10, w: 10, h: 1 };
    for (const maxShift of [0, 4, 1.5, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(() =>
        classifyLocalDisplacement(design, screenshot, WIDTH, HEIGHT, bbox, undefined, maxShift),
      ).toThrow(RangeError);
    }
  });
});

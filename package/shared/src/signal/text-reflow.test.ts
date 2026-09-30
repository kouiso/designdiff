import { describe, expect, it } from "vitest";

import { classifyTextReflow } from "./text-reflow.js";

const WIDTH = 30;
const HEIGHT = 30;
const WHITE = 255;

const paint = (pixels: Uint8ClampedArray, x: number, y: number): void => {
  const offset = (y * WIDTH + x) * 4;
  pixels[offset] = 0;
  pixels[offset + 1] = 0;
  pixels[offset + 2] = 0;
};

// 3x6 のベタ棒をグリフの見立てにする。1本が ~18px の墨 (= 半解像マスクで
// 6ブロック前後) になり、連結成分として安定して数えられる大きさ。
const paintBar = (pixels: Uint8ClampedArray, x0: number, y0: number): void => {
  for (let y = y0; y < y0 + 6; y++) {
    for (let x = x0; x < x0 + 3; x++) paint(pixels, x, y);
  }
};

const blank = (): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4).fill(WHITE);
  for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel++) pixels[pixel * 4 + 3] = 255;
  return pixels;
};

// 7本の棒を2行に並べる。折り返し差は「行末の棒が次行の先頭に移る」形。
const designBars: (readonly [number, number])[] = [
  [3, 3],
  [9, 3],
  [15, 3],
  [21, 3],
  [3, 15],
  [9, 15],
  [15, 15],
];
const reflowedBars: (readonly [number, number])[] = [
  [3, 3],
  [9, 3],
  [15, 3],
  [3, 15],
  [9, 15],
  [15, 15],
  [21, 15],
];

const makeBlock = (bars: (readonly [number, number])[]): Uint8ClampedArray => {
  const pixels = blank();
  for (const [x, y] of bars) paintBar(pixels, x, y);
  return pixels;
};

const classify = (design: Uint8ClampedArray, screenshot: Uint8ClampedArray) =>
  classifyTextReflow(design, screenshot, WIDTH, HEIGHT, { x: 0, y: 0, w: WIDTH, h: HEIGHT });

describe("classifyTextReflow", () => {
  it("行またぎで配置が変わった同一文字列を折り返し差として分類する", () => {
    expect(classify(makeBlock(designBars), makeBlock(reflowedBars))).toMatchObject({
      classification: "text-block-reflow",
      designLineCount: 2,
      screenshotLineCount: 2,
      designComponentCount: 7,
      screenshotComponentCount: 7,
    });
  });

  it("行内でトラッキングだけが変わった同一文字列も分類する", () => {
    const tracked: (readonly [number, number])[] = [
      [3, 3],
      [10, 3],
      [17, 3],
      [23, 3],
      [4, 15],
      [11, 15],
      [18, 15],
    ];
    expect(classify(makeBlock(designBars), makeBlock(tracked))).toMatchObject({
      classification: "text-block-reflow",
    });
  });

  it("成分数が違うブロック (別の文字列) を扱わない", () => {
    const different: (readonly [number, number])[] = [...designBars, [21, 15], [3, 24]];
    expect(classify(makeBlock(designBars), makeBlock(different))).toBeUndefined();
  });

  it("インク量差が大きいブロック (太さ違い) を扱わない", () => {
    const screenshot = blank();
    for (const [x, y] of designBars) {
      paintBar(screenshot, x, y);
      paintBar(screenshot, x + 3, y);
    }
    expect(classify(makeBlock(designBars), screenshot)).toBeUndefined();
  });

  it("色相の違う画素が混ざった領域を扱わない", () => {
    const screenshot = makeBlock(reflowedBars);
    const colored = (1 * WIDTH + 1) * 4;
    screenshot[colored] = 200;
    screenshot[colored + 1] = 40;
    screenshot[colored + 2] = 40;
    expect(classify(makeBlock(designBars), screenshot)).toBeUndefined();
  });

  it("前景の無い領域 (要素欠落) を扱わない", () => {
    expect(classify(makeBlock(designBars), blank())).toBeUndefined();
  });

  it("ベタ面トークン差を扱わない", () => {
    const design = blank();
    const screenshot = blank();
    for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel++) {
      for (let channel = 0; channel < 3; channel++) screenshot[pixel * 4 + channel] = 248;
    }
    expect(classify(design, screenshot)).toBeUndefined();
  });

  it("完全一致のブロック (差分なし) を扱わない", () => {
    expect(classify(makeBlock(designBars), makeBlock(designBars))).toBeUndefined();
  });
});

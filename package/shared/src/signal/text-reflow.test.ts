import { describe, expect, it } from "vitest";

import { RegionScoreSchema } from "../schema.js";

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
  it.each([
    [253, 255, false] as const,
    [255, 253, false] as const,
    [253, 255, true] as const,
    [255, 253, true] as const,
  ])("背景%s対%sの丸め差と太字化%sを区別する", (designBackground, screenshotBackground, thick) => {
    const size = 128;
    const fixture = (background: number, bold = false) => {
      const pixels = new Uint8ClampedArray(size * size * 4).fill(background);
      for (let index = 0; index < size * size; index++) pixels[index * 4 + 3] = 255;
      for (const [x, y] of designBars)
        for (let dy = 0; dy < 6; dy++)
          for (let dx = 0; dx < (bold ? 6 : 3); dx++) {
            const index = ((y + dy) * size + x * 3 + dx) * 4;
            pixels.fill(0, index, index + 3);
          }
      return pixels;
    };
    const result = classifyTextReflow(
      fixture(designBackground),
      fixture(screenshotBackground, thick),
      size,
      size,
      {
        x: 0,
        y: 0,
        w: size,
        h: size,
      },
    );
    if (thick) expect(result).toBeUndefined();
    else expect(result).toMatchObject({ classification: "text-block-reflow", inkCoverageDelta: 0 });
  });

  it.each([
    [253, 255, 126, 127],
    [255, 253, 127, 126],
  ])("背景%i対%iで半被覆の成分%i対%iを失わない", (designBg, screenshotBg, designEdge, screenshotEdge) => {
    const size = 80;
    const fixture = (background: number, edge: number) => {
      const pixels = new Uint8ClampedArray(size * size * 4).fill(background);
      for (let index = 0; index < size * size; index++) pixels[index * 4 + 3] = 255;
      // 黒い成分で前景軸を固定し、半被覆の独立成分を既知の2個目として置く。
      for (const x of [10, 40]) {
        for (let y = 20; y < 32; y++) {
          for (let dx = 0; dx < 8; dx++) {
            const index = (y * size + x + dx) * 4;
            pixels.fill(x === 10 ? 0 : edge, index, index + 3);
          }
        }
      }
      return pixels;
    };
    const result = classifyTextReflow(
      fixture(designBg, designEdge),
      fixture(screenshotBg, screenshotEdge),
      size,
      size,
      { x: 0, y: 0, w: size, h: size },
    );
    expect(result).toMatchObject({
      classification: "text-block-reflow",
      designComponentCount: 2,
      screenshotComponentCount: 2,
      designLineCount: 1,
      screenshotLineCount: 1,
    });
    expect(result?.inkCoverageDelta).toBeLessThan(0.00002);
  });

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

  // designdiff#235: 両側の連結成分数が0だと成分差が 0/0 = NaN になり、
  // しきい値比較をすり抜けて「折り返し」と誤認されていた。
  it("グリフと数えられる墨が無い点描だけの領域を扱わない", () => {
    const design = blank();
    const screenshot = blank();
    for (const x of [5, 12, 19]) {
      paint(design, x, 5);
      paint(screenshot, x, 20);
    }
    expect(classify(design, screenshot)).toBeUndefined();
  });

  it("分類できた証拠は RegionScore の textReflow スキーマを満たす", () => {
    const evidence = classify(makeBlock(designBars), makeBlock(reflowedBars));
    expect(evidence).toBeDefined();
    const parsed = RegionScoreSchema.shape.textReflow.safeParse({
      ...evidence,
      memberRegionIds: ["region-0"],
    });
    expect(parsed.success).toBe(true);
    expect(Number.isFinite(evidence?.inkCoverageDelta)).toBe(true);
  });
});

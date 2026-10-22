import { describe, expect, it } from "vitest";

import { detectOpaqueStrokeChange } from "./glyph-edge-raster.js";

const SIZE = 80;
const BOX = { x: 8, y: 8, w: 64, h: 64 };
const pixels = (
  strokeWidth: number,
  transpose = false,
  shift = 0,
  background = 255,
  length = 17,
) => {
  const result = new Uint8ClampedArray(SIZE * SIZE * 4).fill(background);
  for (let index = 0; index < SIZE * SIZE; index++) result[index * 4 + 3] = 255;
  for (const center of [20, 40, 60]) {
    for (let row = 20; row < 20 + length; row++) {
      for (
        let column = center - Math.floor(strokeWidth / 2);
        column < center - Math.floor(strokeWidth / 2) + strokeWidth;
        column++
      ) {
        const x = (transpose ? row : column) + shift;
        const y = transpose ? column : row;
        if (x < 0 || x >= SIZE || y < 0 || y >= SIZE)
          throw new RangeError("Stroke control is outside image");
        result.fill(51, (y * SIZE + x) * 4, (y * SIZE + x) * 4 + 3);
      }
    }
  }
  expect(Array.from(result).filter((value, index) => index % 4 === 0 && value === 51)).toHaveLength(
    3 * strokeWidth * length,
  );
  return result;
};

describe("不透明ストロークの幅変化", () => {
  it.each([
    [5, 7, false],
    [7, 5, false],
    [7, 9, false],
    [9, 7, false],
    [5, 7, true],
    [7, 5, true],
    [7, 9, true],
    [9, 7, true],
  ] as const)("%i→%i、転置%sの実幅差を測る", (designWidth, shotWidth, transpose) => {
    const evidence = detectOpaqueStrokeChange(
      pixels(designWidth, transpose),
      pixels(shotWidth, transpose),
      SIZE,
      SIZE,
      BOX,
    );
    expect(evidence).toMatchObject({
      axis: transpose ? "y" : "x",
      designWidthPx: designWidth,
      screenshotWidthPx: shotWidth,
    });
    expect(evidence?.changedPixelCount).toBeGreaterThanOrEqual(10);
  });

  it.each([
    [255, 251],
    [251, 255],
  ] as const)("独自背景%i/%iでも幅を変えた対照を拒否する", (designBg, shotBg) => {
    expect(
      detectOpaqueStrokeChange(
        pixels(5, false, 0, designBg),
        pixels(7, false, 0, shotBg),
        SIZE,
        SIZE,
        BOX,
      ),
    ).toMatchObject({ designWidthPx: 5, screenshotWidthPx: 7 });
  });

  it.each([0, 1, 2])("同じ幅の%i px移動を太線化と呼ばない", (shift) => {
    expect(
      detectOpaqueStrokeChange(pixels(5), pixels(5, false, shift), SIZE, SIZE, BOX),
    ).toBeUndefined();
  });

  it("片側の差分クラスタでも両端を調べて幅変化を見つける", () => {
    expect(
      detectOpaqueStrokeChange(pixels(5), pixels(7), SIZE, SIZE, { x: 17, y: 20, w: 1, h: 17 }),
    ).toMatchObject({ designWidthPx: 5, screenshotWidthPx: 7 });
  });

  it("halo内の別要素の変化を元bboxへ帰属しない", () => {
    expect(
      detectOpaqueStrokeChange(pixels(5), pixels(7), SIZE, SIZE, { x: 28, y: 20, w: 1, h: 17 }),
    ).toBeUndefined();
  });

  it("マスクで隠れた背景アンカーを完全な輪郭の証拠にしない", () => {
    const mask = new Uint8Array(SIZE * SIZE);
    for (const center of [20, 40, 60]) {
      for (let y = 20; y < 37; y++) {
        mask[y * SIZE + center - 4] = 1;
        mask[y * SIZE + center + 4] = 1;
      }
    }
    expect(detectOpaqueStrokeChange(pixels(5), pixels(7), SIZE, SIZE, BOX, mask)).toBeUndefined();
  });

  it.each([9, 10])("片側増幅の変更%i画素は既存の10画素境界を守る", (length) => {
    const design = pixels(5, false, 0, 255, length);
    const shot = Uint8ClampedArray.from(design);
    for (let y = 20; y < 20 + length; y++)
      shot.fill(51, (y * SIZE + 23) * 4, (y * SIZE + 23) * 4 + 3);
    const evidence = detectOpaqueStrokeChange(design, shot, SIZE, SIZE, BOX);
    if (length === 9) expect(evidence).toBeUndefined();
    else
      expect(evidence).toMatchObject({
        designWidthPx: 5,
        screenshotWidthPx: 6,
        changedPixelCount: 10,
      });
  });

  it("画像端で切れたストロークを完全幅と主張しない", () => {
    const design = new Uint8ClampedArray(SIZE * SIZE * 4).fill(255);
    const shot = Uint8ClampedArray.from(design);
    for (let y = 20; y < 37; y++) {
      for (let x = 0; x < 7; x++) {
        const index = (y * SIZE + x) * 4;
        if (x < 5) design.fill(51, index, index + 3);
        shot.fill(51, index, index + 3);
      }
    }
    expect(
      detectOpaqueStrokeChange(design, shot, SIZE, SIZE, { x: 5, y: 20, w: 2, h: 17 }),
    ).toBeUndefined();
  });
});

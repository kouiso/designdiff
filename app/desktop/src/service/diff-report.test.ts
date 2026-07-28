import { describe, expect, it } from "vitest";

import { buildDiffReport } from "./diff-report";

const fillSolid = (
  width: number,
  height: number,
  rgb: [number, number, number],
): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const index = i * 4;
    pixels[index] = rgb[0];
    pixels[index + 1] = rgb[1];
    pixels[index + 2] = rgb[2];
    pixels[index + 3] = 255;
  }
  return pixels;
};

describe("buildDiffReport", () => {
  it("3x3 の意味ある領域ごとにスコアを返す", () => {
    const width = 6;
    const height = 6;
    const designPixels = fillSolid(width, height, [100, 100, 100]);
    const screenshotPixels = fillSolid(width, height, [100, 100, 100]);

    const report = buildDiffReport({ designPixels, screenshotPixels, width, height });

    expect(report.regionScores).toHaveLength(9);
    expect(report.regionScores.map((region) => region.regionId)).toEqual([
      "top-left",
      "top-center",
      "top-right",
      "middle-left",
      "middle-center",
      "middle-right",
      "bottom-left",
      "bottom-center",
      "bottom-right",
    ]);
  });

  it("差分が集中した領域だけ issue に現れる", () => {
    const width = 6;
    const height = 6;
    const designPixels = fillSolid(width, height, [80, 80, 80]);
    const screenshotPixels = fillSolid(width, height, [80, 80, 80]);

    // top-left(0-1,0-1) 領域だけ大きく色差を入れる
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        const index = (y * width + x) * 4;
        screenshotPixels[index] = 250;
        screenshotPixels[index + 1] = 250;
        screenshotPixels[index + 2] = 250;
      }
    }

    const report = buildDiffReport({ designPixels, screenshotPixels, width, height });
    const topLeftScore = report.regionScores.find((region) => region.regionId === "top-left");
    const topCenterScore = report.regionScores.find((region) => region.regionId === "top-center");

    expect(topLeftScore).toBeDefined();
    expect(topCenterScore).toBeDefined();
    expect((topLeftScore?.structure ?? 1) < (topCenterScore?.structure ?? 0)).toBe(true);

    expect(report.issues.some((issue) => issue.regionId === "top-left")).toBe(true);
    expect(report.issues.every((issue) => issue.regionId === "top-left")).toBe(true);
  });
});

describe("形と位置合わせを実際に使うこと", () => {
  const WIDTH = 120;
  const HEIGHT = 90;

  // 範囲外の矩形は、別の行の画素を書き換えたり黙って捨てられたりする。
  // 入力と違う絵のままテストが通ると、通ったこと自体が嘘になる。
  function assertRectInside(rect: { x: number; y: number; w: number; h: number }): void {
    const values = [rect.x, rect.y, rect.w, rect.h];
    if (!values.every((value) => Number.isInteger(value))) {
      throw new Error(`fixture rect must be integers: ${JSON.stringify(rect)}`);
    }
    if (rect.w <= 0 || rect.h <= 0) {
      throw new Error(`fixture rect must be positive: ${JSON.stringify(rect)}`);
    }
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > WIDTH || rect.y + rect.h > HEIGHT) {
      throw new Error(`fixture rect is outside ${WIDTH}x${HEIGHT}: ${JSON.stringify(rect)}`);
    }
  }

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
      assertRectInside(mark);
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

  it("同じ画像なら輪郭の食い違いは 0 のままであること", () => {
    const image = makeImage(0, { x: 30, y: 20, w: 40, h: 40, value: 255 });

    const report = buildDiffReport({
      designPixels: image,
      screenshotPixels: image,
      width: WIDTH,
      height: HEIGHT,
    });

    expect(report.regionScores.every((score) => score.shape === 0)).toBe(true);
  });

  it("設計にだけ縁がある領域では輪郭の食い違いが出ること", () => {
    const design = makeImage(0, { x: 10, y: 10, w: 30, h: 30, value: 255 });
    const screenshot = makeImage(0);

    const report = buildDiffReport({
      designPixels: design,
      screenshotPixels: screenshot,
      width: WIDTH,
      height: HEIGHT,
    });

    expect(report.regionScores.some((score) => score.shape > 0)).toBe(true);
  });

  it("画面の大半が同じだけずれていれば、位置を合わせた結果を返すこと", () => {
    const design = makeImage(0, { x: 10, y: 10, w: 100, h: 70, value: 255 });
    const screenshot = makeImage(0, { x: 17, y: 10, w: 100, h: 70, value: 255 });

    const report = buildDiffReport({
      designPixels: design,
      screenshotPixels: screenshot,
      width: WIDTH,
      height: HEIGHT,
    });

    expect(report.alignment.translation).toEqual({ x: 7, y: 0 });
  });

  it("配置の値は意図した 0 のままであること", () => {
    const image = makeImage(0, { x: 30, y: 20, w: 40, h: 40, value: 255 });

    const report = buildDiffReport({
      designPixels: image,
      screenshotPixels: image,
      width: WIDTH,
      height: HEIGHT,
    });

    expect(report.regionScores.every((score) => score.layout === 0)).toBe(true);
  });

  it("画素の並びが足りない場合は寸法を添えて弾くこと", () => {
    const short = new Uint8ClampedArray(10);

    expect(() =>
      buildDiffReport({
        designPixels: short,
        screenshotPixels: short,
        width: WIDTH,
        height: HEIGHT,
      }),
    ).toThrow(
      new RegExp(
        `Pixel buffer too small for ${WIDTH}x${HEIGHT}: design=10, screenshot=10, expected>=${WIDTH * HEIGHT * 4}`,
      ),
    );
  });

  it("寸法そのものが壊れている場合も弾くこと", () => {
    const image = makeImage(0);

    for (const [width, height] of [
      [0, HEIGHT],
      [WIDTH, -1],
      [Number.NaN, HEIGHT],
      [12.5, HEIGHT],
    ]) {
      expect(() =>
        buildDiffReport({
          designPixels: image,
          screenshotPixels: image,
          width,
          height,
        }),
      ).toThrow(/Invalid image dimensions/);
    }
  });

  it("大きくずれた画面は、位置を合わせても合格にしないこと", () => {
    // 位置を合わせて測ると、ずれていた事実そのものは数値から消える。
    const design = makeImage(0, { x: 0, y: 10, w: 100, h: 70, value: 255 });
    const screenshot = makeImage(0, { x: 15, y: 10, w: 100, h: 70, value: 255 });

    const report = buildDiffReport({
      designPixels: design,
      screenshotPixels: screenshot,
      width: WIDTH,
      height: HEIGHT,
    });

    expect(report.issues.some((issue) => issue.kind === "position")).toBe(true);
    expect(report.aggregateVerdict).toBe("fail");
  });
});

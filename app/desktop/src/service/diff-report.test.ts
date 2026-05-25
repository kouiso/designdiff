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

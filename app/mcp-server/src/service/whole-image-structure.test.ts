import { expect, it } from "vitest";

import { buildDiffReport } from "./diff-report-builder.js";

const WIDTH = 390;
const HEIGHT = 692;
const BOX = { x: 336, y: 597, w: 13, h: 11 };

const image = (): Uint8ClampedArray => {
  return new Uint8ClampedArray(WIDTH * HEIGHT * 4).fill(255);
};

const paint = (pixels: Uint8ClampedArray, box = BOX): void => {
  for (let y = box.y; y < box.y + box.h; y += 1) {
    for (let x = box.x; x < box.x + box.w; x += 1) {
      const offset = (y * WIDTH + x) * 4;
      pixels.fill((x + y) % 2 ? 0 : 60, offset, offset + 3);
    }
  }
};

const report = (
  designPixels: Uint8ClampedArray,
  screenshotPixels: Uint8ClampedArray,
  boxes = [BOX],
) => {
  return buildDiffReport({
    designPixels,
    screenshotPixels,
    width: WIDTH,
    height: HEIGHT,
    diffRegions: boxes,
    resolvedAlignment: {
      alignment: {
        translation: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        confidence: 1,
        residual: 0,
      },
      alignedDesignPixels: designPixels,
      applied: false,
    },
  });
};

it("preserves the 13x11 local critical and aggregate FAIL while reporting whole-image structure", () => {
  const baseline = image();
  const actual = image();
  paint(actual);
  const result = report(baseline, actual);
  expect(result.structuralAssessment).toMatchObject({
    verdict: "pass",
    evaluatedPixelCount: WIDTH * HEIGHT,
  });
  expect(result.structuralAssessment?.score).toBeGreaterThan(0.99);
  expect(result.aggregateVerdict).toBe("fail");
  expect(
    result.issues.some(
      (issue) => issue.severity === "critical" && issue.bbox.w === BOX.w && issue.bbox.h === BOX.h,
    ),
  ).toBe(true);
  expect(
    result.regionScores.some((region) => region.bbox.x === BOX.x && region.bbox.y === BOX.y),
  ).toBe(true);
  expect(report(baseline, actual, [BOX, BOX]).structuralAssessment).toEqual(
    result.structuralAssessment,
  );
});

it("retains the color gate independently from a uniform structural pass", () => {
  const actual = image();
  for (let offset = 0; offset < actual.length; offset += 4) actual.fill(30, offset, offset + 3);
  const result = report(image(), actual, [{ x: 0, y: 0, w: WIDTH, h: HEIGHT }]);
  expect(result.structuralAssessment).toMatchObject({ score: 1, verdict: "pass" });
  expect(result.aggregateVerdict).toBe("fail");
  expect(
    result.issues.some((issue) => issue.kind === "color" && issue.severity === "critical"),
  ).toBe(true);
});

it("does not hide widespread structural changes when region metadata covers only a small part", () => {
  const actual = image();
  paint(actual, { x: 0, y: 0, w: WIDTH, h: HEIGHT });
  expect(report(image(), actual).structuralAssessment?.verdict).toBe("fail");
});

it("fails critical alignment even when corrected pixels have identical structure", () => {
  const pixels = image();
  const result = buildDiffReport({
    designPixels: pixels,
    screenshotPixels: pixels,
    width: WIDTH,
    height: HEIGHT,
    resolvedAlignment: {
      alignment: {
        translation: { x: 2, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        confidence: 1,
        residual: 0,
      },
      alignedDesignPixels: pixels,
      applied: true,
    },
  });
  expect(result.structuralAssessment).toMatchObject({ score: 1, verdict: "fail" });
  expect(result.aggregateVerdict).toBe("fail");
});

it("retains an unknown assessment when all comparison pixels are masked", () => {
  const pixels = image();
  const result = buildDiffReport({
    designPixels: pixels,
    screenshotPixels: pixels,
    width: WIDTH,
    height: HEIGHT,
    ignoreMask: new Uint8Array(WIDTH * HEIGHT).fill(1),
  });
  expect(result.structuralAssessment).toMatchObject({
    score: null,
    verdict: "inconclusive",
    evaluatedPixelCount: 0,
  });
});

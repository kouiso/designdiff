import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import {
  MAX_ANTIALIAS_BLUR_SIGMA,
  findCriticalRawDiffRegions,
  normalizeAntialiasPair,
  parseAntialiasBlurSigma,
  resolveCrossRendererVerdict,
} from "./visual-normalization.mjs";

test("antialias blur sigma is bounded", () => {
  assert.equal(parseAntialiasBlurSigma(undefined), 0);
  assert.equal(parseAntialiasBlurSigma("4.5"), 4.5);
  assert.throws(
    () => parseAntialiasBlurSigma(String(MAX_ANTIALIAS_BLUR_SIGMA + 0.1)),
    /must be between/u,
  );
});

test("antialias normalization preserves image dimensions", async () => {
  const input = await sharp({
    create: {
      width: 12,
      height: 8,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  const normalized = await normalizeAntialiasPair(input, input, 1);
  const design = await sharp(normalized.designBuffer).metadata();
  const screenshot = await sharp(normalized.screenshotBuffer).metadata();
  assert.deepEqual([design.width, design.height], [12, 8]);
  assert.deepEqual([screenshot.width, screenshot.height], [12, 8]);
});

test("raw guard preserves dense content-loss signals before blur", () => {
  const criticalRegions = findCriticalRawDiffRegions({
    totalPixelCount: 100_000,
    diffRegions: [
      {
        bounds: { x: 10, y: 10, width: 50, height: 20 },
        diffPixelCount: 800,
      },
      {
        bounds: { x: 0, y: 0, width: 100, height: 10 },
        diffPixelCount: 100,
      },
    ],
  });
  assert.equal(criticalRegions.length, 1);
  assert.equal(criticalRegions[0].density, 0.8);
});

test("cross-renderer verdict preserves aggregate results and fails guard violations", () => {
  const base = {
    aggregateVerdict: "pass",
    hasViewportMismatch: false,
    rawGuardPassed: true,
  };
  assert.equal(resolveCrossRendererVerdict(base), "pass");
  assert.equal(resolveCrossRendererVerdict({ ...base, hasViewportMismatch: true }), "fail");
  assert.equal(resolveCrossRendererVerdict({ ...base, rawGuardPassed: false }), "fail");
});

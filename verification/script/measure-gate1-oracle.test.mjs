import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { loadImage, measurePixels } from "./measure-gate1-oracle.mjs";

const image = (values, width = values.length) => ({
  data: Buffer.from(values.flatMap((v) => [v, v, v])),
  width,
  height: values.length / width,
});

test("strict >40 cutoff, exact differences and partial tile denominator", () => {
  const result = measurePixels(image([0, 0, 0]), image([0, 40, 41]));
  assert.equal(result.metrics?.ratios["0"], 2 / 3);
  assert.equal(result.metrics?.ratios["40"], 1 / 3);
  assert.equal(result.metrics?.maxTile32Ratio, 1 / 3);
  assert.equal(result.metrics?.deltaHistogram[40], 1);
});

test("symmetric neighborhood metric tolerates a shift but retains missing ink", () => {
  const shifted = measurePixels(image([255, 0, 255, 255]), image([255, 255, 0, 255]));
  assert.equal(shifted.legacyRunnerRatio, 0.5);
  assert.equal(shifted.metrics?.symmetricUnexplained1pxRatio, 0);
  const missing = measurePixels(image([255, 0, 255, 255]), image([255, 255, 255, 255]));
  assert.equal(missing.metrics?.symmetricUnexplained1pxRatio, 0.25);
  const reversed = measurePixels(image([255, 255, 255, 255]), image([255, 0, 255, 255]));
  assert.equal(reversed.metrics?.symmetricUnexplained1pxRatio, 0.25);
});

test("dimension mismatch is explicitly non-comparable, invalid buffers throw", () => {
  assert.deepEqual(measurePixels(image([0, 0]), image([0, 0], 1)), {
    dimensionsMatch: false,
    legacyRunnerRatio: 1,
    metrics: null,
  });
  assert.throws(() => measurePixels(image([]), image([])), /Invalid RGB/);
  assert.throws(
    () => measurePixels({ data: Buffer.alloc(1), width: 1, height: 1 }, image([0])),
    /Invalid RGB/,
  );
});

test("alpha is rejected instead of silently discarded", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "gate1-alpha-"));
  try {
    const file = path.join(dir, "transparent.png");
    await sharp(Buffer.from([0, 0, 0, 0]), { raw: { width: 1, height: 1, channels: 4 } })
      .png()
      .toFile(file);
    await assert.rejects(loadImage(file), /non-opaque/);
    await assert.rejects(loadImage(path.join(dir, "missing.png")), /ENOENT/);
  } finally {
    await rm(dir, { recursive: true });
  }
});

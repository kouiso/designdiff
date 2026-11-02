import assert from "node:assert/strict";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { loadImage, measurePixels, validateRgbImage } from "./measure-gate1-oracle.mjs";

/** @param {number[]} values */
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

test("RGB dimensions reject fractional and excessive images before processing", () => {
  for (const [width, height] of [
    [1.5, 200],
    [4_000_001, 1],
    [NaN, 1],
    [1, Infinity],
  ]) {
    assert.throws(
      () => validateRgbImage({ data: Buffer.alloc(900), width, height }),
      /Invalid RGB/,
    );
  }
});

test("encoded files have byte bounds and only complete still PNGs are accepted", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "gate1-png-guard-"));
  try {
    const valid = await sharp(Buffer.from([0, 0, 0]), { raw: { width: 1, height: 1, channels: 3 } })
      .png()
      .toBuffer();
    const png = path.join(dir, "valid.png");
    await writeFile(png, valid);
    assert.deepEqual((await loadImage(png)).data, Buffer.from([0, 0, 0]));
    const sparse = path.join(dir, "oversized.png");
    const handle = await open(sparse, "w");
    try {
      await handle.truncate(16 * 1024 * 1024 + 1);
    } finally {
      await handle.close();
    }
    await assert.rejects(loadImage(sparse), /regular file of/);
    await assert.rejects(loadImage(dir), /regular file of/);
    const invalid = path.join(dir, "invalid.png");
    await writeFile(invalid, Buffer.from("this is not a PNG"));
    await assert.rejects(loadImage(invalid), /PNG signature/);
    await writeFile(invalid, valid.subarray(0, valid.length - 1));
    await assert.rejects(loadImage(invalid), /truncated PNG/);
    await writeFile(invalid, Buffer.concat([valid, Buffer.from([0])]));
    await assert.rejects(loadImage(invalid), /trailing bytes/);
    const animation = Buffer.alloc(20);
    animation.writeUInt32BE(8, 0);
    animation.write("acTL", 4, "ascii");
    animation.writeUInt32BE(2, 8);
    await writeFile(invalid, Buffer.concat([valid.subarray(0, 33), animation, valid.subarray(33)]));
    await assert.rejects(loadImage(invalid), /Animated PNG/);
  } finally {
    await rm(dir, { recursive: true });
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { probeOverlap } from "./probe-gate1-overlap.mjs";

const patterned = () => {
  const width = 4;
  const height = 400;
  const data = Buffer.alloc(width * height * 3, 255);
  let state = 7;
  for (let y = 0; y < height; y += 1) {
    state = (state * 48271) % 2147483647;
    for (let x = 0; x < state % 5; x += 1)
      data.fill(0, (y * width + x) * 3, (y * width + x + 1) * 3);
  }
  return { data, width, height };
};

test("independent row profile finds a known 20px displacement and raw bytes confirm it", () => {
  const a = patterned();
  const b = { ...a, data: Buffer.alloc(a.data.length, 255) };
  a.data.copy(b.data, 20 * a.width * 3, 0, (a.height - 20) * a.width * 3);
  const result = probeOverlap(a, b);
  for (const band of result.bands) {
    assert.equal(band.shift, 20);
    assert.equal(band.rawAtProfileBest, 0);
    assert.ok(band.rawAtZero > 0);
    assert.equal(band.tiedBestCount, 1);
  }
});

test("flat identical images remain ambiguous, zero differences have no fabricated fractions", () => {
  const a = { data: Buffer.alloc(400 * 3, 255), width: 1, height: 400 };
  const result = probeOverlap(a, a);
  assert.equal(result.changedPixels, 0);
  assert.equal(result.edgeAssociatedFraction, null);
  assert.equal(result.neutralChannelChangeFraction, null);
  assert.equal(result.bands[0].tiedBestCount, 161);
  assert.equal(result.bands[0].shift, 0);
  assert.throws(() => probeOverlap(a, { ...a, height: 399 }), /Dimension/);
  assert.throws(() => probeOverlap({ ...a, data: Buffer.alloc(1) }, a), /Invalid/);
});

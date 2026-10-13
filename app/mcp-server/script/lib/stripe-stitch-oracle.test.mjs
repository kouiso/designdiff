import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { STRIPE_COLORS, verifyStripeStitch } from "./stripe-stitch-oracle.mjs";

const WIDTH = 60;
const SECTION_ROWS = 200;
const DARK = [0x11, 0x11, 0x11];

// ページと同じく、各区画は「色帯と暗色帯の繰り返し」で、先頭と末尾は色で終わる。
const sectionRows = (colorId, rows) => {
  const out = [];
  for (let y = 0; y < rows; y += 1) {
    out.push(Math.floor(y / 20) % 2 === 0 ? STRIPE_COLORS[colorId] : DARK);
  }
  out[0] = STRIPE_COLORS[colorId];
  out[rows - 1] = STRIPE_COLORS[colorId];
  return out;
};

const buildPng = async (rows) => {
  const data = Buffer.alloc(WIDTH * rows.length * 3);
  rows.forEach(([r, g, b], y) => {
    for (let x = 0; x < WIDTH; x += 1) {
      data.set([r, g, b], (y * WIDTH + x) * 3);
    }
  });
  return sharp(data, { raw: { width: WIDTH, height: rows.length, channels: 3 } })
    .png()
    .toBuffer();
};

const stitched = (order, rowsFor = () => SECTION_ROWS) =>
  order.flatMap((id, index) => sectionRows(id, rowsFor(index)));

describe("verifyStripeStitch", () => {
  it("8色が順序どおり同じ高さで並ぶ結合画像は合格", async () => {
    const result = await verifyStripeStitch(await buildPng(stitched([0, 1, 2, 3, 4, 5, 6, 7])));
    expect(result.reasons).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.sequence).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("区画が欠けた結合は不合格にする", async () => {
    const result = await verifyStripeStitch(await buildPng(stitched([0, 1, 3, 4, 5, 6, 7])));
    expect(result.ok).toBe(false);
    expect(result.reasons.join("\n")).toContain("stripe 2 missing");
  });

  it("フレームが重複して区画が繰り返される結合は不合格にする", async () => {
    const result = await verifyStripeStitch(
      await buildPng(stitched([0, 1, 2, 2, 3, 4, 5, 6, 7])),
    );
    expect(result.ok).toBe(false);
  });

  it("区画が入れ替わった結合は不合格にする", async () => {
    const result = await verifyStripeStitch(await buildPng(stitched([0, 2, 1, 3, 4, 5, 6, 7])));
    expect(result.ok).toBe(false);
    expect(result.reasons.join("\n")).toContain("precedes");
  });

  it("内側の区画が伸びた（重なりの取りこぼし）結合は不合格にする", async () => {
    const result = await verifyStripeStitch(
      await buildPng(stitched([0, 1, 2, 3, 4, 5, 6, 7], (index) => (index === 3 ? 320 : SECTION_ROWS))),
    );
    expect(result.ok).toBe(false);
    expect(result.reasons.join("\n")).toContain("stretched or truncated");
  });
});

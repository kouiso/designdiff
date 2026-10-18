import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { STRIPE_COLORS, verifyStripeStitch } from "./stripe-stitch-oracle.mjs";

const WIDTH = 60;
const SECTION_ROWS = 200;
const DARK = [0x11, 0x11, 0x11];

// ページと同じく、各区画は「色帯と暗色帯の繰り返し」で、先頭と末尾は色で終わる。
// 実ページの CSS は色帯 (40+8i)px・暗帯 40px の交互なので、フィクスチャも
// 同じ比率を縮尺 SCALE でなぞる (帯高が区画番号に依らないことが縮尺推定の支点)。
const SCALE = 0.25;
const sectionRows = (colorId, rows) => {
  const colorBand = Math.round((40 + colorId * 8) * SCALE);
  const period = colorBand + Math.round(40 * SCALE);
  const out = [];
  for (let y = 0; y < rows; y += 1) {
    out.push(y % period < colorBand ? STRIPE_COLORS[colorId] : DARK);
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
    // 同じ色が2区画ぶん続くので、区画の高さが伸びた結合として検出される。
    expect(result.reasons.join("\n")).toContain("stretched or truncated");
  });

  it("境目で暗色と混ざった (アンチエイリアス) 数行が別の縞色に見えても、順序を誤判定しない", async () => {
    // 黄 (3) と暗色の境目に、茶 (6) に近い 50% ブレンド行を 2 行挟む。
    const blend = STRIPE_COLORS[3].map((value, index) => Math.round((value + DARK[index]) / 2));
    const rows = [];
    [0, 1, 2, 3, 4, 5, 6, 7].forEach((id, index) => {
      const section = sectionRows(id, SECTION_ROWS);
      if (id === 3) section.splice(20, 0, blend, blend);
      rows.push(...section);
      void index;
    });
    const result = await verifyStripeStitch(await buildPng(rows));
    expect(result.reasons).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("区画が暗色で終わる・始まる (実ページの縞の位相) 結合も合格する", async () => {
    const darkEdged = (id, trimTop, trimBottom) => {
      const rows = sectionRows(id, SECTION_ROWS);
      for (let y = 0; y < trimTop; y += 1) rows[y] = DARK;
      for (let y = SECTION_ROWS - trimBottom; y < SECTION_ROWS; y += 1) rows[y] = DARK;
      return rows;
    };
    const rows = [0, 1, 2, 3, 4, 5, 6, 7].flatMap((id) =>
      id === 0 ? darkEdged(id, 40, 0) : id === 6 ? darkEdged(id, 0, 8) : sectionRows(id, SECTION_ROWS),
    );
    const result = await verifyStripeStitch(await buildPng(rows));
    expect(result.reasons).toEqual([]);
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

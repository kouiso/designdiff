import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { judgePageRender, waitForPageRender, x07ScrollGate } from "./page-render-oracle.mjs";
import { STRIPE_COLORS } from "./stripe-stitch-oracle.mjs";

const DARK = [0x11, 0x11, 0x11];
const CHROME_GRAY = [0xd9, 0xd9, 0xd9];

// 検証ページと同じ構成の画面: 区画の色帯と暗帯の繰り返し。先頭に
// ブラウザ UI 相当の灰色帯を載せて、実機の検体に近い形にする。
const stripeScreen = (width, height, { colorId = 0, chromeRows = 0 } = {}) => {
  const colorBand = 40 + colorId * 8;
  const period = colorBand + 40;
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    const [r, g, b] =
      y < chromeRows ? CHROME_GRAY : y % period < colorBand ? STRIPE_COLORS[colorId] : DARK;
    for (let x = 0; x < width; x += 1) data.set([r, g, b], (y * width + x) * 3);
  }
  return data;
};

const solidScreen = (width, height, [r, g, b]) => {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data.set([r, g, b], (y * width + x) * 3);
  }
  return data;
};

// 白地に小さい彩色アイコンだけの画面 (ブラウザのエラーページ相当)。
const errorScreen = (width, height) => {
  const data = solidScreen(width, height, [0xf2, 0xf2, 0xf2]);
  for (let y = Math.floor(height * 0.4); y < Math.floor(height * 0.44); y += 1) {
    for (let x = Math.floor(width * 0.45); x < Math.floor(width * 0.55); x += 1) {
      data.set([0xdb, 0x44, 0x37], (y * width + x) * 3);
    }
  }
  return data;
};

const info3 = (width, height) => ({ width, height, channels: 3 });

describe("judgePageRender", () => {
  it.each([
    [320, 640],
    [360, 800],
    [720, 1280],
    [1080, 2400],
  ])("描画済み fixture %ix%i (ブラウザ UI 付き) → rendered", (width, height) => {
    const data = stripeScreen(width, height, { chromeRows: Math.floor(height * 0.12) });
    const result = judgePageRender(data, info3(width, height));
    expect(result.rendered).toBe(true);
    expect(result.stripeRatio).toBeGreaterThanOrEqual(0.15);
  });

  it("白紙 → rendered にならない", () => {
    const data = solidScreen(360, 800, [0xff, 0xff, 0xff]);
    expect(judgePageRender(data, info3(360, 800)).rendered).toBe(false);
  });

  it("ブラウザ起動画面相当の無彩色画面 → rendered にならない", () => {
    const data = solidScreen(360, 800, CHROME_GRAY);
    expect(judgePageRender(data, info3(360, 800)).rendered).toBe(false);
  });

  it("エラーページ相当 (白地 + 小さい彩色アイコン) → rendered にならない", () => {
    const data = errorScreen(360, 800);
    const result = judgePageRender(data, info3(360, 800));
    expect(result.rendered).toBe(false);
    expect(result.reason).toContain("below threshold");
  });

  it("fixture でない色画面は fixturePage:false では rendered、fixture 判定では落ちる", () => {
    // 縞でない一般的な彩色ページ: 全面が fixture 色以外の彩色。
    const data = solidScreen(360, 800, [0x20, 0x80, 0x40]);
    expect(judgePageRender(data, info3(360, 800), { fixturePage: false }).rendered).toBe(true);
    expect(judgePageRender(data, info3(360, 800), { fixturePage: true }).rendered).toBe(false);
  });
});

describe("waitForPageRender + x07ScrollGate", () => {
  const toPng = (data, width, height) =>
    sharp(data, { raw: { width, height, channels: 3 } })
      .png()
      .toBuffer();

  it("描画済みの検体が返る → rendered:true で gate は進行を許す", async () => {
    const shot = await toPng(stripeScreen(320, 640), 320, 640);
    const wait = await waitForPageRender({
      captureScreen: () => Promise.resolve(shot),
      deadlineMs: 5_000,
      intervalMs: 10,
    });
    expect(wait.rendered).toBe(true);
    expect(x07ScrollGate(wait).proceed).toBe(true);
  });

  it("timeout → 標本数・理由・最後の検体を残し、gate は X07 を NOT_RUN で止める", async () => {
    const blank = await toPng(solidScreen(320, 640, [0xff, 0xff, 0xff]), 320, 640);
    const wait = await waitForPageRender({
      captureScreen: () => Promise.resolve(blank),
      deadlineMs: 60,
      intervalMs: 10,
    });
    expect(wait.rendered).toBe(false);
    expect(wait.attempts).toBeGreaterThanOrEqual(1);
    expect(wait.sampleCount).toBeGreaterThan(0);
    expect(wait.reason).toContain("below threshold");
    expect(wait.lastShot).toBe(blank);

    const gate = x07ScrollGate(wait);
    expect(gate.proceed).toBe(false);
    expect(gate.record.status).toBe("NOT_RUN");
  });
});

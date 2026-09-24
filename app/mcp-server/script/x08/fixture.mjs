// X08 共通検体。全実行面 (MCP / desktop / Chrome拡張 / Figma plugin) に
// 同一バイト列の PNG ペアを与え、差分画素・領域・diff 画像が一致するかを見る。
// AA 判定の揺れを避けるため、縁の硬い矩形だけで構成する (SVG は使わない)。

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

export const X08_W = 96;
export const X08_H = 96;

// 設計側の矩形
const RECT_A = { x: 16, y: 16, w: 32, h: 24, fill: "#111111" };
const RECT_B = { x: 56, y: 48, w: 24, h: 32, fill: "#888888" };
// 実装側: RECT_A と同じ位置・同寸法で色だけ違う + 追加矩形
const RECT_A_IMPL = { ...RECT_A, fill: "#990000" };
const RECT_C_IMPL = { x: 4, y: 64, w: 8, h: 8, fill: "#0000cc" };

const rectPng = async ({ x, y, w, h, fill }) => ({
  input: await sharp({
    create: { width: w, height: h, channels: 3, background: fill },
  })
    .png()
    .toBuffer(),
  left: x,
  top: y,
});

export const writeX08Fixture = async (dir) => {
  const base = () =>
    sharp({
      create: { width: X08_W, height: X08_H, channels: 3, background: "#ffffff" },
    });
  const designPath = join(dir, "x08-design.png");
  const screenshotPath = join(dir, "x08-screenshot.png");
  await base()
    .composite([await rectPng(RECT_A), await rectPng(RECT_B)])
    .png()
    .toFile(designPath);
  await base()
    .composite([
      await rectPng(RECT_A_IMPL),
      await rectPng(RECT_B),
      await rectPng(RECT_C_IMPL),
    ])
    .png()
    .toFile(screenshotPath);
  return {
    designPath,
    screenshotPath,
    // 独立 oracle: 差分画素は RECT_A (32*24=768) + RECT_C (8*8=64) = 832。
    expectedDiffPixelCount: RECT_A.w * RECT_A.h + RECT_C_IMPL.w * RECT_C_IMPL.h,
    expectedRegions: [
      { x: RECT_A.x, y: RECT_A.y, width: RECT_A.w, height: RECT_A.h },
      { x: RECT_C_IMPL.x, y: RECT_C_IMPL.y, width: RECT_C_IMPL.w, height: RECT_C_IMPL.h },
    ],
  };
};

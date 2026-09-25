import { fileURLToPath } from "node:url";

import sharp from "sharp";
import { expect, it } from "vitest";

import { buildDiffReport } from "./diff-report-builder.js";

it("実描画した同じ文字の色変更を位置・寸法変更と断定しない", async () => {
  const base = new URL("../../../../docs/evidence/mcp-stdio-issue-verification/", import.meta.url);
  const [design, screenshot] = await Promise.all([
    sharp(fileURLToPath(new URL("input-typography-design.png", base)))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
    sharp(fileURLToPath(new URL("input-typography-impl-oracle.png", base)))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
  ]);
  expect(design.info.width).toBe(screenshot.info.width);
  expect(design.info.height).toBe(screenshot.info.height);
  let changedPixels = 0;
  for (let index = 0; index < design.data.length; index += 4) {
    const changed = [0, 1, 2, 3].some(
      (channel) => design.data[index + channel] !== screenshot.data[index + channel],
    );
    if (!changed) continue;
    changedPixels++;
    const pixel = index / 4;
    const x = pixel % design.info.width;
    const y = Math.floor(pixel / design.info.width);
    expect(x >= 76 && x < 89 && y >= 87 && y < 98).toBe(true);
  }
  expect(changedPixels).toBe(131);
  const report = buildDiffReport({
    designPixels: new Uint8ClampedArray(design.data),
    screenshotPixels: new Uint8ClampedArray(screenshot.data),
    width: design.info.width,
    height: design.info.height,
    diffRegions: [{ x: 77, y: 87, w: 11, h: 10 }],
  });
  expect(report.issues.some((issue) => issue.kind === "color")).toBe(true);
  expect(
    report.issues.filter((issue) => issue.kind === "position" || issue.kind === "size"),
  ).toEqual([]);
});

it.each(["shift", "resize"])("文字色変更に加えた実際の%sを見逃さない", async (change) => {
  const base = new URL("../../../../docs/evidence/mcp-stdio-issue-verification/", import.meta.url);
  const [design, screenshot] = await Promise.all([
    sharp(fileURLToPath(new URL("input-typography-design.png", base)))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
    sharp(fileURLToPath(new URL("input-typography-impl-oracle.png", base)))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
  ]);
  const { width, height } = design.info;
  const moved = new Uint8ClampedArray(screenshot.data);
  // 実描画済みの文字矩形だけを動かし、周囲やボタンの画素を維持する。
  const glyph = { x: 76, y: 87, width: 13, height: 11 };
  expect(glyph.x + glyph.width + 1).toBeLessThan(width);
  expect(glyph.y + glyph.height).toBeLessThan(height);
  for (let y = 0; y < glyph.height; y++) {
    for (let x = 0; x < glyph.width + 1; x++) {
      const target = ((glyph.y + y) * width + glyph.x + x) * 4;
      const sourceX =
        change === "shift" ? x - 1 : Math.floor((x * glyph.width) / (glyph.width + 1));
      const source = ((glyph.y + y) * width + glyph.x + sourceX) * 4;
      for (let channel = 0; channel < 4; channel++) {
        moved[target + channel] =
          sourceX < 0 || sourceX >= glyph.width ? 255 : screenshot.data[source + channel];
      }
    }
  }
  const report = buildDiffReport({
    designPixels: new Uint8ClampedArray(design.data),
    screenshotPixels: moved,
    width,
    height,
    diffRegions: [{ x: 75, y: 86, w: 16, h: 13 }],
  });
  expect(report.issues.some((issue) => issue.kind === "position" || issue.kind === "size")).toBe(
    true,
  );
});

it("補正済み画像で採点した色差は同じ補正済み座標で幾何確認する", async () => {
  const base = new URL("../../../../docs/evidence/mcp-stdio-issue-verification/", import.meta.url);
  const [design, screenshot] = await Promise.all([
    sharp(fileURLToPath(new URL("input-typography-design.png", base)))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
    sharp(fileURLToPath(new URL("input-typography-impl-oracle.png", base)))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
  ]);
  const { width, height } = design.info;
  const original = new Uint8ClampedArray(design.data);
  for (let y = 87; y < 98; y++) {
    for (let x = 76; x < 90; x++) {
      const target = (y * width + x) * 4;
      const source = (y * width + x - 1) * 4;
      for (let channel = 0; channel < 4; channel++)
        original[target + channel] = x === 76 ? 255 : design.data[source + channel];
    }
  }
  const report = buildDiffReport({
    designPixels: original,
    screenshotPixels: new Uint8ClampedArray(screenshot.data),
    width,
    height,
    diffRegions: [{ x: 77, y: 87, w: 11, h: 10 }],
    resolvedAlignment: {
      alignment: {
        translation: { x: -1, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        confidence: 1,
        residual: 0,
      },
      alignedDesignPixels: new Uint8ClampedArray(design.data),
      applied: true,
    },
  });
  expect(report.issues.some((issue) => issue.kind === "color")).toBe(true);
  expect(
    report.issues.filter((issue) => issue.kind === "position" || issue.kind === "size"),
  ).toEqual([]);
});

it("前景が背景に同化したとき位置・寸法変更とは断定しない", () => {
  const width = 48;
  const height = 48;
  const design = new Uint8ClampedArray(width * height * 4).fill(255);
  const screenshot = new Uint8ClampedArray(design);
  for (let y = 16; y < 32; y++) {
    for (let x = 16; x < 32; x++) {
      const offset = (y * width + x) * 4;
      design[offset] = 0;
      design[offset + 1] = 0;
      design[offset + 2] = 0;
    }
  }
  const report = buildDiffReport({
    designPixels: design,
    screenshotPixels: screenshot,
    width,
    height,
    diffRegions: [{ x: 14, y: 14, w: 20, h: 20 }],
    resolvedAlignment: {
      alignment: {
        translation: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        confidence: 1,
        residual: 0,
      },
      alignedDesignPixels: design,
      applied: false,
    },
  });
  expect(report.issues.some((issue) => issue.kind === "color")).toBe(true);
  expect(report.aggregateVerdict).toBe("fail");
  expect(
    report.issues.filter((issue) => issue.kind === "position" || issue.kind === "size"),
  ).toEqual([]);
});

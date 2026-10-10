// 同幅・異高のフルページ比較で、design を contain 縮小すると幅まで縮んで全列が
// 横にずれ、同一の内容まで差分に出ていた不具合の regression test。
// sharp / pixelmatch は本物を使い、差分の位置は合成画像の正解と突き合わせる。
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { compareImages, resolveScreenshotBottomPaddingRows } from "./image-compare-service.js";

const WIDTH = 200;

// 縦縞と横帯を重ねた模様。1px でも横にずれると縞の位相が変わり差分になるため、
// 縮小による列のずれを確実に検出できる。
const pagePixel = (x: number, y: number): [number, number, number, number] => {
  const stripe = Math.floor(x / 3) % 2 === 0 ? 30 : 220;
  const band = Math.floor(y / 10) % 3;
  return [stripe, band === 0 ? 60 : 160, band === 2 ? 40 : 200, 255];
};

const extraRowPixel = (): [number, number, number, number] => [200, 30, 30, 255];

const buildPng = async (
  width: number,
  height: number,
  pixelAt: (x: number, y: number) => [number, number, number, number],
): Promise<Buffer> => {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data.set(pixelAt(x, y), (y * width + x) * 4);
    }
  }
  return sharp(data, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
};

const readDiffRows = async (
  diffImageBase64: string,
): Promise<{ width: number; height: number; diffRows: Set<number>; diffCount: number }> => {
  const { data, info } = await sharp(Buffer.from(diffImageBase64, "base64"))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const diffRows = new Set<number>();
  let diffCount = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * 4 + 3] > 0) {
        diffRows.add(y);
        diffCount += 1;
      }
    }
  }
  return { width: info.width, height: info.height, diffRows, diffCount };
};

describe("compareImages — 同幅・異高は縮小せず上端揃えで比較する", () => {
  it("同一内容に design だけ下端の行がある場合、差分は足りない行だけに出る", async () => {
    const screenshotHeight = 200;
    const designHeight = 220;
    const design = await buildPng(WIDTH, designHeight, (x, y) =>
      y < screenshotHeight ? pagePixel(x, y) : extraRowPixel(),
    );
    const screenshot = await buildPng(WIDTH, screenshotHeight, pagePixel);

    const result = await compareImages({
      designBase64: design.toString("base64"),
      screenshotBase64: screenshot.toString("base64"),
    });

    const missingRows = designHeight - screenshotHeight;
    expect(result.normalization).toMatchObject({
      designNativeWidth: WIDTH,
      designNativeHeight: designHeight,
      screenshotWidth: WIDTH,
      screenshotHeight,
      containResized: false,
      appliedScale: 1,
      screenshotBottomPaddingRows: missingRows,
    });
    expect(result.ignoreRegionResolution?.effectiveCanvas).toEqual({
      width: WIDTH,
      height: designHeight,
    });
    expect(result.diffPixelCount).toBe(WIDTH * missingRows);
    expect(result.totalPixelCount).toBe(WIDTH * designHeight);
    expect(result.subThresholdDiffPixelCount).toBeUndefined();

    const diff = await readDiffRows(result.diffImageBase64 ?? "");
    expect(diff.width).toBe(WIDTH);
    expect(diff.height).toBe(designHeight);
    expect(diff.diffCount).toBe(WIDTH * missingRows);
    expect(Math.min(...diff.diffRows)).toBe(screenshotHeight);
    expect(Math.max(...diff.diffRows)).toBe(designHeight - 1);
    for (const region of result.diffRegions) {
      expect(region.bounds.y).toBeGreaterThanOrEqual(screenshotHeight);
    }
  });

  it("design 側の足りない行が白地でも、撮影側に無い行として差分に数える", async () => {
    const screenshotHeight = 200;
    const designHeight = 210;
    const design = await buildPng(WIDTH, designHeight, (x, y) =>
      y < screenshotHeight ? pagePixel(x, y) : [255, 255, 255, 255],
    );
    const screenshot = await buildPng(WIDTH, screenshotHeight, pagePixel);

    const result = await compareImages({
      designBase64: design.toString("base64"),
      screenshotBase64: screenshot.toString("base64"),
    });

    expect(result.diffPixelCount).toBe(WIDTH * (designHeight - screenshotHeight));
    expect(result.subThresholdDiffPixelCount).toBeUndefined();
  });

  it("ignore region で覆った足りない行は差分にも分母にも入れない", async () => {
    const screenshotHeight = 200;
    const designHeight = 220;
    const design = await buildPng(WIDTH, designHeight, (x, y) =>
      y < screenshotHeight ? pagePixel(x, y) : extraRowPixel(),
    );
    const screenshot = await buildPng(WIDTH, screenshotHeight, pagePixel);

    const result = await compareImages({
      designBase64: design.toString("base64"),
      screenshotBase64: screenshot.toString("base64"),
      ignoreRegions: [{ x: 0, y: 210, width: WIDTH, height: 10 }],
    });

    expect(result.diffPixelCount).toBe(WIDTH * 10);
    expect(result.totalPixelCount).toBe(WIDTH * designHeight - WIDTH * 10);
  });

  it("フルページ design と単一ビューポート撮影 (高さ比 > 1.4) は従来どおり contain 正規化する", async () => {
    const screenshotHeight = 200;
    const designHeight = 400;
    const design = await buildPng(WIDTH, designHeight, pagePixel);
    const screenshot = await buildPng(WIDTH, screenshotHeight, pagePixel);

    const result = await compareImages({
      designBase64: design.toString("base64"),
      screenshotBase64: screenshot.toString("base64"),
    });

    expect(result.normalization?.containResized).toBe(true);
    expect(result.normalization?.appliedScale).toBeCloseTo(0.5, 5);
    expect(result.normalization).not.toHaveProperty("screenshotBottomPaddingRows");
    expect(result.ignoreRegionResolution?.effectiveCanvas).toEqual({
      width: WIDTH,
      height: screenshotHeight,
    });
  });

  it("幅が元から違う入力は、幅合わせ後に同幅でも従来どおり contain 正規化する", async () => {
    const design = await buildPng(WIDTH * 2, 440, pagePixel);
    const screenshot = await buildPng(WIDTH, 200, pagePixel);

    const result = await compareImages({
      designBase64: design.toString("base64"),
      screenshotBase64: screenshot.toString("base64"),
    });

    expect(result.normalization?.containResized).toBe(true);
    expect(result.normalization).not.toHaveProperty("screenshotBottomPaddingRows");
  });
});

describe("resolveScreenshotBottomPaddingRows", () => {
  const base = {
    designNativeWidth: 1512,
    screenshotNativeWidth: 1512,
    designWidth: 1512,
    designHeight: 3697,
    screenshotWidth: 1512,
    screenshotHeight: 3658,
    cropRequested: false,
  };

  it("同幅で design が軽く縦に長いときだけ差の行数を返す", () => {
    expect(resolveScreenshotBottomPaddingRows(base)).toBe(39);
  });

  it("高さ比が full_page_vs_viewport の閾値ちょうどまでは対象、超えたら対象外", () => {
    expect(
      resolveScreenshotBottomPaddingRows({ ...base, designHeight: 1400, screenshotHeight: 1000 }),
    ).toBe(400);
    expect(
      resolveScreenshotBottomPaddingRows({ ...base, designHeight: 1401, screenshotHeight: 1000 }),
    ).toBe(0);
  });

  it("design が短い・同じ高さ・crop 指定・元の幅違い・不正寸法・作業上限超えは対象外", () => {
    expect(resolveScreenshotBottomPaddingRows({ ...base, designHeight: 3600 })).toBe(0);
    expect(resolveScreenshotBottomPaddingRows({ ...base, designHeight: 3658 })).toBe(0);
    expect(resolveScreenshotBottomPaddingRows({ ...base, cropRequested: true })).toBe(0);
    expect(resolveScreenshotBottomPaddingRows({ ...base, designNativeWidth: 1513 })).toBe(0);
    expect(resolveScreenshotBottomPaddingRows({ ...base, designWidth: 1500 })).toBe(0);
    expect(resolveScreenshotBottomPaddingRows({ ...base, screenshotHeight: 0 })).toBe(0);
    expect(resolveScreenshotBottomPaddingRows({ ...base, screenshotHeight: Number.NaN })).toBe(0);
    expect(
      resolveScreenshotBottomPaddingRows({
        ...base,
        designNativeWidth: 6000,
        screenshotNativeWidth: 6000,
        designWidth: 6000,
        screenshotWidth: 6000,
        designHeight: 4100,
        screenshotHeight: 3900,
      }),
    ).toBe(0);
  });
});

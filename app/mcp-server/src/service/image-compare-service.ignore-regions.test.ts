// PR #57 — compareImages: ignoreRegions マスク機能の integration test。
// pixelmatch / sharp は本物を使用。極小画像で実挙動を検証する。
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { CompareDesignResultSchema } from "@figdiff/shared";

import { compareImages } from "./image-compare-service.js";

// 単色 PNG を base64 で返す
async function solidPng(
  width: number,
  height: number,
  rgba: { r: number; g: number; b: number; alpha: number },
): Promise<string> {
  const buf = await sharp({
    create: { width, height, channels: 4, background: rgba },
  })
    .png()
    .toBuffer();
  return buf.toString("base64");
}

describe("compareImages — ignoreRegions マスク", () => {
  it("ignoreRegions が画像全体を覆う場合、matchRate=100 になり diffPixelCount=0 になること", async () => {
    const design = await solidPng(20, 20, { r: 255, g: 0, b: 0, alpha: 1 });
    const screenshot = await solidPng(20, 20, { r: 0, g: 0, b: 255, alpha: 1 });

    const result = await compareImages({
      designBase64: design,
      screenshotBase64: screenshot,
      threshold: 0.1,
      ignoreRegions: [{ x: 0, y: 0, width: 20, height: 20, label: "全体マスク" }],
    });

    expect(result.matchRate).toBe(100);
    expect(result.diffPixelCount).toBe(0);
    expect(result.totalPixelCount).toBe(0);
    expect(result.diffRegions).toEqual([]);
    // bot review: totalPixelCount=0 が CompareDesignResultSchema 違反で
    // runtime crash する回帰を防ぐ。schema が nonnegative を許容することを確認。
    expect(() => CompareDesignResultSchema.parse(result)).not.toThrow();
  });

  it("design / screenshot の寸法不一致で contain resize が走るケースでも mask が diffReport に効くこと (paddingMask 経路)", async () => {
    // design 20x10、screenshot 20x20 → contain で paddingMask 発生
    const design = await solidPng(20, 10, { r: 255, g: 0, b: 0, alpha: 1 });
    const screenshot = await solidPng(20, 20, { r: 0, g: 0, b: 255, alpha: 1 });

    const result = await compareImages({
      designBase64: design,
      screenshotBase64: screenshot,
      threshold: 0.1,
      ignoreRegions: [{ x: 0, y: 0, width: 20, height: 20, label: "全体マスク" }],
    });

    // 全面マスクなので diffReport にも差分は出ないはず
    expect(result.diffPixelCount).toBe(0);
    expect(result.matchRate).toBe(100);
  });

  it("ignoreRegions 指定なしの場合は通常通り全ピクセル差分が検出されること", async () => {
    const design = await solidPng(10, 10, { r: 255, g: 0, b: 0, alpha: 1 });
    const screenshot = await solidPng(10, 10, { r: 0, g: 0, b: 255, alpha: 1 });

    const result = await compareImages({
      designBase64: design,
      screenshotBase64: screenshot,
      threshold: 0.1,
    });

    expect(result.totalPixelCount).toBe(100);
    expect(result.diffPixelCount).toBeGreaterThan(0);
    expect(result.matchRate).toBeLessThan(100);
  });

  it("ignoreRegions が一部を覆う場合、覆われた範囲だけ分母 / 差分から引かれること", async () => {
    // 20x10 = 200 ピクセル。全面差分。10x10 を mask → 残 100 ピクセル分は差分のまま。
    const design = await solidPng(20, 10, { r: 255, g: 0, b: 0, alpha: 1 });
    const screenshot = await solidPng(20, 10, { r: 0, g: 0, b: 255, alpha: 1 });

    const result = await compareImages({
      designBase64: design,
      screenshotBase64: screenshot,
      threshold: 0.1,
      ignoreRegions: [{ x: 0, y: 0, width: 10, height: 10, label: "左半分" }],
    });

    expect(result.totalPixelCount).toBe(100);
    expect(result.diffPixelCount).toBeGreaterThan(0);
    expect(result.diffPixelCount).toBeLessThanOrEqual(100);
    expect(result.matchRate).toBeLessThan(100);
  });

  it("画像境界を超える ignoreRegions は画像内にクリップされること (右下にはみ出し)", async () => {
    const design = await solidPng(10, 10, { r: 255, g: 0, b: 0, alpha: 1 });
    const screenshot = await solidPng(10, 10, { r: 0, g: 0, b: 255, alpha: 1 });

    // 5,5 から 100x100 = 5..10 範囲だけが有効 (25 ピクセル)
    const result = await compareImages({
      designBase64: design,
      screenshotBase64: screenshot,
      threshold: 0.1,
      ignoreRegions: [{ x: 5, y: 5, width: 100, height: 100 }],
    });

    expect(result.totalPixelCount).toBe(75); // 100 - 25
  });

  it("重複する ignoreRegions は同一ピクセルを 1 度だけ count すること", async () => {
    const design = await solidPng(10, 10, { r: 255, g: 0, b: 0, alpha: 1 });
    const screenshot = await solidPng(10, 10, { r: 0, g: 0, b: 255, alpha: 1 });

    const result = await compareImages({
      designBase64: design,
      screenshotBase64: screenshot,
      threshold: 0.1,
      ignoreRegions: [
        { x: 0, y: 0, width: 5, height: 5 }, // 25 px
        { x: 2, y: 2, width: 5, height: 5 }, // 25 px、9 px overlap
      ],
    });

    // 25 + 25 - 9 (overlap) = 41 px が ignore。残 59 px。
    expect(result.totalPixelCount).toBe(59);
  });

  it("ignoreRegions が空配列の場合は通常通り扱われること", async () => {
    const design = await solidPng(10, 10, { r: 255, g: 0, b: 0, alpha: 1 });
    const screenshot = await solidPng(10, 10, { r: 0, g: 0, b: 255, alpha: 1 });

    const result = await compareImages({
      designBase64: design,
      screenshotBase64: screenshot,
      threshold: 0.1,
      ignoreRegions: [],
    });

    expect(result.totalPixelCount).toBe(100);
    expect(result.diffPixelCount).toBeGreaterThan(0);
  });
});

describe("redactImageBase64ForPublicExport", () => {
  it("public export 用画像の ignoreRegions 内ピクセルを不透明な黒に置き換えること", async () => {
    const { redactImageBase64ForPublicExport } = await import("./image-compare-service.js");
    const source = await solidPng(6, 6, { r: 255, g: 0, b: 0, alpha: 1 });

    const redacted = await redactImageBase64ForPublicExport(source, [
      { x: 2, y: 2, width: 2, height: 2, label: "customer-logo" },
    ]);

    const before = await sharp(Buffer.from(source, "base64")).ensureAlpha().raw().toBuffer();
    const after = await sharp(Buffer.from(redacted, "base64")).ensureAlpha().raw().toBuffer();
    const insideOffset = (2 * 6 + 2) * 4;
    const outsideOffset = (0 * 6 + 0) * 4;

    expect([...before.slice(insideOffset, insideOffset + 4)]).toEqual([255, 0, 0, 255]);
    expect([...after.slice(insideOffset, insideOffset + 4)]).toEqual([0, 0, 0, 255]);
    expect([...after.slice(outsideOffset, outsideOffset + 4)]).toEqual([255, 0, 0, 255]);
  });

  it("ignoreRegions 未設定では public export 用画像を変更しないこと", async () => {
    const { redactImageBase64ForPublicExport } = await import("./image-compare-service.js");
    const source = await solidPng(3, 3, { r: 10, g: 20, b: 30, alpha: 1 });

    await expect(redactImageBase64ForPublicExport(source, undefined)).resolves.toBe(source);
  });
});

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { clusterDiffPixels, comparePixels, resolveAlignment } from "@figdiff/shared";

import { buildDiffReport } from "./diff-report-builder.js";
import { compareImages } from "./image-compare-service.js";

function rgbaBuffer(width: number, height: number, pixelAt: (x: number, y: number) => number[]) {
  const buffer = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const [red, green, blue, alpha] = pixelAt(x, y);
      buffer[offset] = red;
      buffer[offset + 1] = green;
      buffer[offset + 2] = blue;
      buffer[offset + 3] = alpha;
    }
  }
  return buffer;
}

async function pngFromRgba(width: number, height: number, data: Buffer) {
  return sharp(data, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}

describe("compareImages real sharp integration", () => {
  it("detects a high-variance new top band after compositing without treating raw pixels as encoded image data", async () => {
    const width = 20;
    const designHeight = 40;
    const screenshotHeight = 50;
    const bandHeight = screenshotHeight - designHeight;
    const designPixels = rgbaBuffer(width, designHeight, (_x, y) => {
      const tone = y % 2 === 0 ? 40 : 180;
      return [tone, 90, 220 - tone, 255];
    });
    const screenshotPixels = rgbaBuffer(width, screenshotHeight, (x, y) => {
      if (y < bandHeight) {
        const tone = (x + y) % 2 === 0 ? 0 : 255;
        return [tone, 255 - tone, 120, 255];
      }
      const sourceOffset = ((y - bandHeight) * width + x) * 4;
      return [
        designPixels[sourceOffset],
        designPixels[sourceOffset + 1],
        designPixels[sourceOffset + 2],
        designPixels[sourceOffset + 3],
      ];
    });

    const designPng = await pngFromRgba(width, designHeight, designPixels);
    const screenshotPng = await pngFromRgba(width, screenshotHeight, screenshotPixels);

    const result = await compareImages({
      designBase64: designPng.toString("base64"),
      screenshotBase64: screenshotPng.toString("base64"),
    });
    expect(result.diffPixelCount).toBeGreaterThan(0);
  });
});

// Issue #58: 位置ずれ補正が適用される検体で、局所差分クラスタの採点 bbox が
// 補正後の座標系とずれていないことを固定する。かつて pixelmatch は未補正画素に
// 掛けられており、そのクラスタ座標が補正後画素の採点にそのまま使われていた
// 時期があったため、再発するとここで検出できる。
describe("compareImages shift + localized diff scoring (Issue #58)", () => {
  const WIDTH = 400;
  const HEIGHT = 300;
  const SHIFT_Y = 10;
  const PATCH = { x: 200, y: 150, w: 30, h: 30 };

  // 一様色では平行移動が一意に定まらないため、帯状パターンを敷いて
  // resolveAlignment が 10px のずれを確実に採用する検体にする。
  const baseDesignPixel = (x: number, y: number): number[] => {
    const band = Math.floor(y / 20) % 2 === 0 ? 30 : 0;
    const checker = (Math.floor(x / 25) + Math.floor(y / 25)) % 2 === 0 ? 15 : 0;
    return [60 + band + checker, 80 + band, 160 + checker, 255];
  };

  async function buildSpecimen() {
    const designPixels = rgbaBuffer(WIDTH, HEIGHT, (x, y) => baseDesignPixel(x, y));
    const screenshotPixels = rgbaBuffer(WIDTH, HEIGHT, (x, y) => {
      // 先頭 SHIFT_Y 行は端末の status bar 相当の新規コンテンツ。
      if (y < SHIFT_Y) {
        return [200, 200, 200, 255];
      }
      // 局所差分パッチ: デザインの帯パターンと全く違う色。
      if (x >= PATCH.x && x < PATCH.x + PATCH.w && y >= PATCH.y && y < PATCH.y + PATCH.h) {
        return [255, 0, 0, 255];
      }
      // それ以外はデザインを SHIFT_Y だけ下へずらした写像。
      const srcOffset = ((y - SHIFT_Y) * WIDTH + x) * 4;
      return [
        designPixels[srcOffset],
        designPixels[srcOffset + 1],
        designPixels[srcOffset + 2],
        designPixels[srcOffset + 3],
      ];
    });
    const designPng = await pngFromRgba(WIDTH, HEIGHT, designPixels);
    const screenshotPng = await pngFromRgba(WIDTH, HEIGHT, screenshotPixels);
    return {
      designPixels,
      screenshotPixels,
      designBase64: designPng.toString("base64"),
      screenshotBase64: screenshotPng.toString("base64"),
    };
  }

  it("補正後座標系で局所差分を正しい位置に採点すること", async () => {
    const { designBase64, screenshotBase64 } = await buildSpecimen();
    const result = await compareImages({ designBase64, screenshotBase64 });
    const report = result.diffReport;

    // 前提: この検体では必ず位置ずれ補正が働く。働かなければ検体の作りが
    // 変わっているので、ここで先に失敗させて検査の前提を明示する。
    expect(report?.alignment.applied).toBe(true);
    expect(report?.alignment.translation).toEqual({ x: 0, y: SHIFT_Y });

    const clusterScores = (report?.regionScores ?? []).filter((score) =>
      score.regionId.startsWith("diff-cluster-"),
    );
    // この検体はパッチ由来のクラスタが厳密に1件のみ生成されることを前提に
    // 上の計測結果（表）を記録している。2件以上あれば別のクラスタ(誤検出)が
    // 混ざっている証拠なので、まずここで検出する。
    expect(clusterScores).toHaveLength(1);
    // ずれ補正で空いた上端 SHIFT_Y 行の帯は全体の translation_offset 課題として
    // 集計済みのため、局所採点には残らない。
    expect(clusterScores.every((score) => score.bbox.y >= SHIFT_Y)).toBe(true);
    // 局所差分は実際のパッチ位置を覆う1件のクラスタとして採点される。
    // 補正前座標のまま採点されるバグが残っていれば、ここはずれた範囲か、
    // ずれ由来の巨大な幻影クラスタになる。
    const patchScore = clusterScores.find(
      (score) =>
        score.bbox.x <= PATCH.x &&
        score.bbox.y <= PATCH.y &&
        score.bbox.x + score.bbox.w >= PATCH.x + PATCH.w &&
        score.bbox.y + score.bbox.h >= PATCH.y + PATCH.h,
    );
    expect(patchScore).toBeDefined();
    expect(patchScore?.bbox.w).toBeLessThan(200);
    expect(patchScore?.structure).toBeLessThan(0.95);
    expect(patchScore?.color).toBeGreaterThan(2);

    // 誤検出側: パッチから外れた空領域を採点したクラスタが無いこと。
    // 補正前クラスタを流用すると、ずれ由来の帯が全て「差分」として採点対象に残る。
    const offPatchClusters = clusterScores.filter(
      (score) => score.bbox.x + score.bbox.w <= PATCH.x || score.bbox.y + score.bbox.h <= PATCH.y,
    );
    expect(offPatchClusters).toHaveLength(0);

    expect(report?.aggregateVerdict).toBe("fail");
    expect(
      report?.issues.some((issue) => issue.kind === "color" && issue.severity === "critical"),
    ).toBe(true);
    expect(report?.issues.some((issue) => issue.evidence?.signal === "translation_offset")).toBe(
      true,
    );
  });

  it("補正前クラスタを流用すると同じ検体で採点が薄まること (回帰の形状記録)", () => {
    // この test は buildDiffReport 単体を直接呼び、旧パイプライン
    // (pixelmatch は未補正画素→クラスタ座標を補正後採点へ流用) を再現して、
    // 現行の「補正後画素で再クラスタリング」との差を計測する。
    return buildSpecimen().then(({ designPixels, screenshotPixels }) => {
      const design = Uint8ClampedArray.from(designPixels);
      const screenshot = Uint8ClampedArray.from(screenshotPixels);

      const preAlignmentDiff = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
      comparePixels(design, screenshot, preAlignmentDiff, WIDTH, HEIGHT, {
        threshold: 0.1,
        diffMask: true,
      });
      const preAlignClusters = clusterDiffPixels(preAlignmentDiff, WIDTH, HEIGHT).map((region) => ({
        x: region.bounds.x,
        y: region.bounds.y,
        w: region.bounds.width,
        h: region.bounds.height,
        diffPixelCount: region.diffPixelCount,
      }));
      const oldReport = buildDiffReport({
        designPixels: design,
        screenshotPixels: screenshot,
        width: WIDTH,
        height: HEIGHT,
        diffRegions: preAlignClusters,
      });

      // 補正で空いた上端の行は透明画素になる。製品と同じ白合成で採点しないと、
      // 旧/新パイプラインの比較そのものが製品とは別の物差しになる。
      const resolved = resolveAlignment(design, screenshot, WIDTH, HEIGHT);
      const postDiff = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
      comparePixels(resolved.alignedDesignPixels, screenshot, postDiff, WIDTH, HEIGHT, {
        threshold: 0.1,
        diffMask: true,
      });
      const postAlignClusters = clusterDiffPixels(postDiff, WIDTH, HEIGHT).map((region) => ({
        x: region.bounds.x,
        y: region.bounds.y,
        w: region.bounds.width,
        h: region.bounds.height,
        diffPixelCount: region.diffPixelCount,
      }));
      const newReport = buildDiffReport({
        designPixels: resolved.alignedDesignPixels,
        screenshotPixels: screenshot,
        width: WIDTH,
        height: HEIGHT,
        resolvedAlignment: resolved,
        diffRegions: postAlignClusters,
      });

      const coversPatch = (bbox: { x: number; y: number; w: number; h: number }) =>
        bbox.x <= PATCH.x &&
        bbox.y <= PATCH.y &&
        bbox.x + bbox.w >= PATCH.x + PATCH.w &&
        bbox.y + bbox.h >= PATCH.y + PATCH.h;
      const oldPatchScore = oldReport.regionScores.find(
        (score) => score.regionId.startsWith("diff-cluster-") && coversPatch(score.bbox),
      );
      const newPatchScore = newReport.regionScores.find(
        (score) => score.regionId.startsWith("diff-cluster-") && coversPatch(score.bbox),
      );

      // 旧方式ではパッチがずれ由来の巨大クラスタに飲まれ、色差は 46 から 2 へ
      // 薄まり、構造スコアも合格域へ戻る。座標系を揃えた現行方式では鮮明に残る。
      expect(oldPatchScore?.color).toBeLessThan(5);
      expect(oldPatchScore?.structure).toBeGreaterThan(0.95);
      expect(newPatchScore?.color).toBeGreaterThan(10);
      expect(newPatchScore?.structure).toBeLessThan(0.95);
    });
  });
});

// Issue #58 follow-up: 1px の輪郭だけが変化したクラスタは、bbox が未変化の
// 内部画素を大きく含むため、平均ベースの採点 (color / structure) が薄まる
// 疑いがあった。同じ差分画素数・同じ色対で「疎な輪郭」と「密な塊」を比べて
// 実測したところ、輪郭側の color は約 1/23 (45.07 → 1.99) に薄まり、
// critical 閾値 2 を下回って issue 0件の pass になった。対応として採点値は
// 変えず、クラスタ行へ diffPixelDensity (diff 画素数 / bbox 面積) を付けて、
// 読む側が薄まり具合を判断できるようにした。このテストはその測定結果を
// 固定する。
describe("compareImages sparse outline cluster dilution (Issue #58)", () => {
  const WIDTH = 200;
  const HEIGHT = 160;
  const BACKGROUND = [245, 245, 245, 255];
  const DESIGN_COLOR = [30, 120, 200, 255];
  const SCREENSHOT_COLOR = [200, 60, 60, 255];
  // 外周 2*(102+80)-4 = 360px。対照の密な塊も同じ 360px (20x18) にして、
  // 差分の総量を揃えた上で形状だけを変える。
  const BOX = { x: 40, y: 40, w: 102, h: 80 };
  const BLOCK = { x: 40, y: 40, w: 20, h: 18 };

  const isOnBorder = (x: number, y: number, rect: { x: number; y: number; w: number; h: number }) =>
    x >= rect.x &&
    x < rect.x + rect.w &&
    y >= rect.y &&
    y < rect.y + rect.h &&
    (x === rect.x || x === rect.x + rect.w - 1 || y === rect.y || y === rect.y + rect.h - 1);
  const isInside = (x: number, y: number, rect: { x: number; y: number; w: number; h: number }) =>
    x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;

  const runPair = async (changedPixelAt: (x: number, y: number) => boolean) => {
    const designPixels = rgbaBuffer(WIDTH, HEIGHT, (x, y) =>
      changedPixelAt(x, y) ? DESIGN_COLOR : BACKGROUND,
    );
    const screenshotPixels = rgbaBuffer(WIDTH, HEIGHT, (x, y) =>
      changedPixelAt(x, y) ? SCREENSHOT_COLOR : BACKGROUND,
    );
    const designPng = await pngFromRgba(WIDTH, HEIGHT, designPixels);
    const screenshotPng = await pngFromRgba(WIDTH, HEIGHT, screenshotPixels);
    return compareImages({
      designBase64: designPng.toString("base64"),
      screenshotBase64: screenshotPng.toString("base64"),
    });
  };

  it("疎な輪郭クラスタの採点が密な対照より薄まり、密度シグナルで読み分けられること", async () => {
    const outline = await runPair((x, y) => isOnBorder(x, y, BOX));
    const solid = await runPair((x, y) => isInside(x, y, BLOCK));

    // 前提: 両検体は同じ 360 画素の差分を持つ。ここが崩れると比較が成立しない。
    expect(outline.diffPixelCount).toBe(360);
    expect(solid.diffPixelCount).toBe(360);

    const clusterScoreOf = (result: typeof outline) =>
      result.diffReport?.regionScores.find((score) => score.regionId.startsWith("diff-cluster-"));
    const regionOf = (result: typeof outline) => result.diffRegions[0];
    const outlineScore = clusterScoreOf(outline);
    const solidScore = clusterScoreOf(solid);

    // 実測 (記録): 輪郭 = bbox 102x80 / 差分 360px / 密度 0.0441 /
    // color 1.989 / structure ≈1.000。塊 = bbox 20x18 / 360px / 密度 1 /
    // color 45.07 / structure ≈1.000。
    expect(outline.diffRegions).toHaveLength(1);
    expect(solid.diffRegions).toHaveLength(1);
    expect(outlineScore?.bbox).toMatchObject({ x: BOX.x, y: BOX.y, w: BOX.w, h: BOX.h });
    expect(solidScore?.bbox).toMatchObject({ x: BLOCK.x, y: BLOCK.y, w: BLOCK.w, h: BLOCK.h });
    expect(regionOf(outline)?.diffPixelCount).toBe(360);
    expect(regionOf(solid)?.diffPixelCount).toBe(360);

    // 密度シグナル: 輪郭は約 4.4%、塊は 100%。
    expect(outlineScore?.diffPixelDensity).toBeCloseTo(360 / (BOX.w * BOX.h), 10);
    expect(solidScore?.diffPixelDensity).toBe(1);

    // 薄まりの固定: 輪郭の color は critical 閾値 2 を下回り (実測 1.989)、
    // 塊は同じ色対で 45 超。同じ差分が形状だけで約 23 倍薄まる。
    expect(outlineScore?.color).toBeLessThan(2);
    expect(solidScore?.color).toBeGreaterThan(40);
    // 内部が未変化なので SSIM / Hausdorff は両検体ともほぼ無傷。
    expect(outlineScore?.structure).toBeGreaterThan(0.95);
    expect(solidScore?.structure).toBeGreaterThan(0.95);

    // 順位への影響の固定: 輪郭は critical issue を持たず pass、塊は
    // color critical で fail。同じ欠陥量でも輪郭は検出されずに流れる。
    expect(
      outline.diffReport?.issues.some(
        (issue) => issue.regionId === outlineScore?.regionId && issue.severity === "critical",
      ),
    ).toBe(false);
    expect(outline.diffReport?.aggregateVerdict).toBe("pass");
    expect(
      solid.diffReport?.issues.some(
        (issue) => issue.regionId === solidScore?.regionId && issue.severity === "critical",
      ),
    ).toBe(true);
    expect(solid.diffReport?.aggregateVerdict).toBe("fail");
  });
});

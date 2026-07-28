import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FigmaNode } from "@figdiff/shared";

const FALLBACK_FRAME_WIDTH = 16;
const FALLBACK_FRAME_HEIGHT = 16;
const FALLBACK_NODE_ID = "1:100";
const BLUE_RGB = { r: 66, g: 133, b: 244 };
const WHITE_RGB = { r: 255, g: 255, b: 255 };
const HEAVY_FRAME_SIZE = 200;
const TINY_REGION_COUNT = 30;
const TINY_REGION_SIZE = 4;
const TINY_REGION_Y_STEP = 2;
const SECTION_REGION_COUNT = 28;
const SECTION_REGION_WIDTH = 180;
const SECTION_REGION_HEIGHT = 8;
const SECTION_REGION_Y_STEP = 7;
const EXPECTED_CAPPED_REGION_COUNT = 24;
const INTERMEDIATE_DIFF_SIZE = 16;
const INTERMEDIATE_DIFF_LIMIT = 14;
const INTERMEDIATE_DIFF_RGB = 180;
const PASS_STRUCTURE_THRESHOLD = 0.95;

async function createSolidRgba(
  width: number,
  height: number,
  color: { r: number; g: number; b: number },
): Promise<Uint8ClampedArray> {
  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: {
        r: color.r,
        g: color.g,
        b: color.b,
        alpha: 1,
      },
    },
  })
    .raw()
    .toBuffer();

  return Uint8ClampedArray.from(buffer);
}

describe("buildDiffReport", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("@figdiff/shared");
  });

  it("同一画像なら verdict が pass になること", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const pixels = await createSolidRgba(16, 16, { r: 66, g: 133, b: 244 });

    const result = buildDiffReport({
      designPixels: pixels,
      screenshotPixels: pixels,
      width: 16,
      height: 16,
    });

    expect(result.aggregateVerdict).toBe("pass");
    expect(result.regionScores).toHaveLength(1);
    expect(result.regionScores[0].regionId).toBe("whole-frame");
    expect(result.regionScores[0].structure).toBe(1);
    expect(result.regionScores[0].color).toBe(0);
    expect(result.regionScores[0].textureScore).toBeLessThan(0.1);
    expect(result.regionScores[0].shape).toBe(0);
    expect(result.weightedAggregate?.weightedStructure).toBe(1);
    expect(result.issues).toEqual([]);
  });

  it("大きく異なる画像なら structure 起因で fail になること", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const designPixels = await createSolidRgba(16, 16, { r: 0, g: 0, b: 0 });
    const screenshotPixels = await createSolidRgba(16, 16, { r: 255, g: 255, b: 255 });

    const result = buildDiffReport({
      designPixels,
      screenshotPixels,
      width: 16,
      height: 16,
      figmaFileKey: "FILE_KEY_123",
      figmaNodeId: "12:34",
      figmaPageName: "Landing Page",
    });

    expect(result.aggregateVerdict).toBe("fail");
    expect(result.regionScores[0].structure).toBeLessThan(0.8);
    expect(result.weightedAggregate?.weightedStructure).toBeLessThan(0.8);
    expect(result.rationale).toContain("critical severity issue");
    // 両方とも内部が完全に一様な単色ブロック（黒 vs 白）— エッジ（局所的な
    // 輝度勾配）が一切無いため shape (Hausdorff) は 0。幾何学的な歪みは無く
    // 純粋な色差のみなので "position"/"size" は発火しない（発火したら
    // issue-kind precision のバグ = 色変化だけで geometric kind が誤発火）。
    expect(result.regionScores[0].shape).toBe(0);
    expect(result.issues.map((issue) => issue.kind)).toContain("color");
    expect(result.issues.map((issue) => issue.kind)).not.toContain("position");
    expect(result.issues.map((issue) => issue.kind)).not.toContain("size");
    expect(result.issues.map((issue) => issue.severity)).toContain("critical");
    for (const issue of result.issues) {
      expect(issue.evidence.figmaFileKey).toBe("FILE_KEY_123");
      expect(issue.evidence.figmaNodeId).toBe("12:34");
      expect(issue.evidence.figmaPageName).toBe("Landing Page");
    }
  });

  it("figmaRootNode.children があれば section ごとの regionScore を返す", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const designPixels = await createSolidRgba(32, 24, { r: 255, g: 255, b: 255 });
    const screenshotPixels = Uint8ClampedArray.from(designPixels);

    for (let y = 16; y < 24; y++) {
      for (let x = 0; x < 32; x++) {
        const index = (y * 32 + x) * 4;
        screenshotPixels[index] = 0;
        screenshotPixels[index + 1] = 0;
        screenshotPixels[index + 2] = 0;
      }
    }

    const figmaRootNode: FigmaNode = {
      id: "root",
      name: "Frame",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 32, height: 24 },
      absoluteRenderBounds: null,
      fills: [],
      strokes: [],
      effects: [],
      children: [
        {
          id: "header",
          name: "Header",
          type: "FRAME",
          absoluteBoundingBox: { x: 0, y: 0, width: 32, height: 8 },
          absoluteRenderBounds: null,
          fills: [],
          strokes: [],
          effects: [],
          children: [],
        },
        {
          id: "body",
          name: "Body",
          type: "FRAME",
          absoluteBoundingBox: { x: 0, y: 8, width: 32, height: 8 },
          absoluteRenderBounds: null,
          fills: [],
          strokes: [],
          effects: [],
          children: [],
        },
        {
          id: "footer",
          name: "Footer",
          type: "FRAME",
          absoluteBoundingBox: { x: 0, y: 16, width: 32, height: 8 },
          absoluteRenderBounds: null,
          fills: [],
          strokes: [],
          effects: [],
          children: [],
        },
      ],
    };

    const result = buildDiffReport({
      designPixels,
      screenshotPixels,
      width: 32,
      height: 24,
      figmaRootNode,
    });

    // 子の行3件に加えて、比較対象そのものを指す行が1件付く。
    const sectionScores = result.regionScores.filter((score) => score.scope !== "root");
    expect(sectionScores).toHaveLength(3);
    expect(result.regionScores.filter((score) => score.scope === "root")).toHaveLength(1);
    expect(sectionScores.map((score) => score.figmaNodeId)).toEqual(["header", "body", "footer"]);
    expect(
      result.regionScores.find((score) => score.regionId === "footer")?.structure,
    ).toBeLessThan(0.8);
    expect(result.regionScores.find((score) => score.regionId === "footer")?.shape).toBeDefined();
    expect(result.regionScores.find((score) => score.regionId === "header")?.structure).toBeCloseTo(
      1,
      6,
    );
    expect(result.regionScores.every((score) => score.textureScore !== undefined)).toBe(true);
  });
  it("whole-frame fallback でも figmaNodeId を保持すること", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const pixels = await createSolidRgba(FALLBACK_FRAME_WIDTH, FALLBACK_FRAME_HEIGHT, BLUE_RGB);

    const result = buildDiffReport({
      designPixels: pixels,
      screenshotPixels: pixels,
      width: FALLBACK_FRAME_WIDTH,
      height: FALLBACK_FRAME_HEIGHT,
      figmaNodeId: FALLBACK_NODE_ID,
    });

    expect(result.regionScores).toHaveLength(1);
    expect(result.regionScores[0].figmaNodeId).toBe(FALLBACK_NODE_ID);
  });

  it("極小領域を除外しつつ heavy page の上下セクションを保持すること", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const designPixels = await createSolidRgba(HEAVY_FRAME_SIZE, HEAVY_FRAME_SIZE, WHITE_RGB);
    const screenshotPixels = Uint8ClampedArray.from(designPixels);

    const figmaRootNode: FigmaNode = {
      id: "root",
      name: "Frame",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: HEAVY_FRAME_SIZE, height: HEAVY_FRAME_SIZE },
      absoluteRenderBounds: null,
      fills: [],
      strokes: [],
      effects: [],
      children: [
        ...Array.from({ length: TINY_REGION_COUNT }, (_, index) => ({
          id: `tiny-${index}`,
          name: `Tiny ${index}`,
          type: "FRAME" as const,
          absoluteBoundingBox: {
            x: 0,
            y: index * TINY_REGION_Y_STEP,
            width: TINY_REGION_SIZE,
            height: TINY_REGION_SIZE,
          },
          absoluteRenderBounds: null,
          fills: [],
          strokes: [],
          effects: [],
          children: [],
        })),
        ...Array.from({ length: SECTION_REGION_COUNT }, (_, index) => ({
          id: `section-${index}`,
          name: `Section ${index}`,
          type: "FRAME" as const,
          absoluteBoundingBox: {
            x: 0,
            y: index * SECTION_REGION_Y_STEP,
            width: SECTION_REGION_WIDTH,
            height: SECTION_REGION_HEIGHT,
          },
          absoluteRenderBounds: null,
          fills: [],
          strokes: [],
          effects: [],
          children: [],
        })),
      ],
    };

    const result = buildDiffReport({
      designPixels,
      screenshotPixels,
      width: HEAVY_FRAME_SIZE,
      height: HEAVY_FRAME_SIZE,
      figmaRootNode,
    });

    // 最後の1件は比較対象そのものを指す行。上限は section の行に対して効く。
    const sectionScores = result.regionScores.filter((score) => score.scope !== "root");
    const rootScores = result.regionScores.filter((score) => score.scope === "root");
    expect(sectionScores).toHaveLength(EXPECTED_CAPPED_REGION_COUNT);
    expect(rootScores).toHaveLength(1);
    expect(sectionScores.every((score) => score.regionId.startsWith("section-"))).toBe(true);
    expect(sectionScores[0].regionId).toBe("section-0");
    expect(sectionScores.at(-1)?.regionId).toBe(`section-${SECTION_REGION_COUNT - 1}`);
  });

  it("pass 閾値未達の中間差分は pass にならないこと", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const designPixels = await createSolidRgba(
      INTERMEDIATE_DIFF_SIZE,
      INTERMEDIATE_DIFF_SIZE,
      WHITE_RGB,
    );
    const screenshotPixels = Uint8ClampedArray.from(designPixels);

    for (let y = 0; y < INTERMEDIATE_DIFF_LIMIT; y++) {
      for (let x = 0; x < INTERMEDIATE_DIFF_LIMIT; x++) {
        const index = (y * INTERMEDIATE_DIFF_SIZE + x) * 4;
        screenshotPixels[index] = INTERMEDIATE_DIFF_RGB;
        screenshotPixels[index + 1] = INTERMEDIATE_DIFF_RGB;
        screenshotPixels[index + 2] = INTERMEDIATE_DIFF_RGB;
      }
    }

    const result = buildDiffReport({
      designPixels,
      screenshotPixels,
      width: INTERMEDIATE_DIFF_SIZE,
      height: INTERMEDIATE_DIFF_SIZE,
    });

    expect(result.regionScores).toHaveLength(1);
    expect(result.regionScores[0].color).toBeGreaterThan(0);
    expect(result.regionScores[0].structure).toBeLessThan(PASS_STRUCTURE_THRESHOLD);
    expect(result.aggregateVerdict).not.toBe("pass");
  });
});

// #269: ΔE2000 は知覚距離なので、単色トークンが1段ズレただけでは閾値 2 に届かず
// critical に上がらない。pixelmatch は全画素を差分と数えるので、判定器が「一致」、
// 画素が「全部違う」と言う状態が生まれ、matchRate 0% の PASS になっていた。
describe("buildDiffReport — flat fill colour (#269)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("@figdiff/shared");
  });

  it("fails a one-token fill drift that delta-E leaves far below its threshold", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const designPixels = await createSolidRgba(64, 64, { r: 0x22, g: 0xaa, b: 0x88 });
    const screenshotPixels = await createSolidRgba(64, 64, { r: 0x28, g: 0xaa, b: 0x88 });

    const result = buildDiffReport({
      designPixels,
      screenshotPixels,
      width: 64,
      height: 64,
    });

    // ΔE 単独では pass 側に落ちる値であることを同時に示す。
    expect(result.regionScores[0].color).toBeLessThan(2);
    expect(result.regionScores[0].flatColorMismatch).toEqual({
      designHex: "#22AA88",
      screenshotHex: "#28AA88",
      maxChannelDelta: 6,
    });
    expect(result.aggregateVerdict).toBe("fail");
    expect(result.issues[0]).toMatchObject({
      kind: "color",
      severity: "critical",
      evidence: { signal: "flat_region_color" },
    });
  });

  it("keeps an identical flat fill passing", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const pixels = await createSolidRgba(64, 64, { r: 0x22, g: 0xaa, b: 0x88 });

    const result = buildDiffReport({
      designPixels: pixels,
      screenshotPixels: pixels,
      width: 64,
      height: 64,
    });

    expect(result.regionScores[0].flatColorMismatch).toBeUndefined();
    expect(result.aggregateVerdict).toBe("pass");
  });
});

describe("buildDiffReport coordinate-space fixes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("@figdiff/shared");
  });

  it("paddingMask を渡すと letterbox 余白を whole-frame SSIM から除外すること (finding 3)", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const width = 32;
    const height = 32;
    // content rect = 上 24 行。下 8 行は contain-resize の余白で比較対象外。
    const contentHeight = 24;

    const designPixels = await createSolidRgba(width, height, WHITE_RGB);
    const screenshotPixels = Uint8ClampedArray.from(designPixels);
    // 余白帯 (24..31 行) を design 側だけ黒にする = 余白の偽差分。
    for (let y = contentHeight; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4;
        designPixels[index] = 0;
        designPixels[index + 1] = 0;
        designPixels[index + 2] = 0;
      }
    }

    const withMask = buildDiffReport({
      designPixels,
      screenshotPixels,
      width,
      height,
      paddingMask: { left: 0, top: 0, width, height: contentHeight },
    });

    const withoutMask = buildDiffReport({
      designPixels,
      screenshotPixels,
      width,
      height,
    });

    // 余白を除外すれば content は一致 → SSIM ≈ 1。除外しないと余白の差分で下がる。
    expect(withMask.regionScores[0].regionId).toBe("whole-frame");
    expect(withMask.regionScores[0].structure).toBeGreaterThan(
      withoutMask.regionScores[0].structure,
    );
    expect(withMask.regionScores[0].structure).toBeCloseTo(1, 6);
    expect(withMask.regionScores[0].color).toBe(0);
    expect(withoutMask.regionScores[0].color).toBeGreaterThan(0);
  });

  it("cropRegion を渡すと section 写像が crop 原点ぶんシフトすること (finding 2)", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const width = 64;
    const height = 64;
    const designPixels = await createSolidRgba(width, height, WHITE_RGB);
    const screenshotPixels = Uint8ClampedArray.from(designPixels);

    // Figma フレーム: 64x128。フル幅 64 / フル高さ 128 → scale 1。
    // crop で上 64px を削った (crop 後 height = 64)。
    const figmaRootNode: FigmaNode = {
      id: "root",
      name: "Frame",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 64, height: 128 },
      absoluteRenderBounds: null,
      fills: [],
      strokes: [],
      effects: [],
      children: [
        {
          id: "lower",
          name: "Lower",
          type: "FRAME",
          // Figma canvas y=64..128。crop 原点 y=64 を引くと screenshot y=0..64。
          absoluteBoundingBox: { x: 0, y: 64, width: 64, height: 64 },
          absoluteRenderBounds: null,
          fills: [],
          strokes: [],
          effects: [],
          children: [],
        },
      ],
    };

    const result = buildDiffReport({
      designPixels,
      screenshotPixels,
      width,
      height,
      figmaRootNode,
      cropRegion: { x: 0, y: 64, width: 64, height: 64 },
      fullFrame: { width: 64, height: 128 },
    });

    const lower = result.regionScores.find((score) => score.regionId === "lower");
    expect(lower).toBeDefined();
    // crop 原点を引いた後、lower section は screenshot 上端 (y≈0) に来る。
    expect(lower?.bbox.y).toBe(0);
    expect(lower?.bbox.h).toBeGreaterThan(0);
  });

  it("cropRegion 無しでは crop シフトが起きず従来の写像になること", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const width = 64;
    const height = 128;
    const designPixels = await createSolidRgba(width, height, WHITE_RGB);
    const screenshotPixels = Uint8ClampedArray.from(designPixels);

    const figmaRootNode: FigmaNode = {
      id: "root",
      name: "Frame",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 64, height: 128 },
      absoluteRenderBounds: null,
      fills: [],
      strokes: [],
      effects: [],
      children: [
        {
          id: "lower",
          name: "Lower",
          type: "FRAME",
          absoluteBoundingBox: { x: 0, y: 64, width: 64, height: 64 },
          absoluteRenderBounds: null,
          fills: [],
          strokes: [],
          effects: [],
          children: [],
        },
      ],
    };

    const result = buildDiffReport({
      designPixels,
      screenshotPixels,
      width,
      height,
      figmaRootNode,
    });

    const lower = result.regionScores.find((score) => score.regionId === "lower");
    expect(lower).toBeDefined();
    // crop 無し: lower section は screenshot y=64 に来る (シフトなし)。
    expect(lower?.bbox.y).toBe(64);
  });
});

describe("buildDiffReport global alignment shift severity", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("@figdiff/shared");
  });

  // 縦に画面全体を貫く色付きバー (識別可能な特徴が無いと detectTranslation が
  // オフセットを検出できない — 単色画像はどこにシフトしても同じに見えるため)。
  // 背景は黒 (0,0,0): countSsdOffset の OOB 判定は「screenshot 側が可視 (RGB二乗和
  // が閾値超)」で diff を数える。背景を白にすると OOB 帯 (シフト分の左右端) が
  // 常に可視とみなされ大きなペナルティになり、改善ゲート (alwaysPenalizeOob=true)
  // で補正が採用されなくなる。バーを画面全体の高さにすることで、baseline の
  // ミスマッチ量が OOB ペナルティを安定して上回り、補正が正しく採用される。
  async function createShiftedPattern(
    width: number,
    height: number,
    dx: number,
  ): Promise<{ design: Uint8ClampedArray; screenshot: Uint8ClampedArray }> {
    const barLeft = Math.floor(width / 4);
    const barWidth = Math.floor(width / 4);

    const build = (offsetX: number): Uint8ClampedArray => {
      const pixels = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          const inBar = x >= barLeft + offsetX && x < barLeft + offsetX + barWidth;
          if (inBar) {
            pixels[idx] = 66;
            pixels[idx + 1] = 133;
            pixels[idx + 2] = 244;
          } else {
            pixels[idx] = 0;
            pixels[idx + 1] = 0;
            pixels[idx + 2] = 0;
          }
          pixels[idx + 3] = 255;
        }
      }
      return pixels;
    };

    return { design: build(0), screenshot: build(dx) };
  }

  it("小さい許容範囲内のシフト(1px)はグローバルシフトのcritical化を発火させないこと", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const width = 100;
    const height = 100;
    const { design, screenshot } = await createShiftedPattern(width, height, 1);

    const result = buildDiffReport({
      designPixels: design,
      screenshotPixels: screenshot,
      width,
      height,
    });

    // 1px の補正境界には shape/structure ベースの既存ロジックが軽微な
    // position issue (major) を出しうる — それ自体は正しい既存挙動。
    // ここで確認したいのは「新設のグローバルシフトcritical化 (evidence.signal
    // === "translation_offset") が、閾値未満のシフトで誤発火しないこと」のみ。
    const globalShiftIssue = result.issues.find(
      (issue) => issue.evidence.signal === "translation_offset",
    );
    expect(globalShiftIssue).toBeUndefined();
  });

  it("採用された大きな(>=10px)グローバルシフトは position issue が critical になり aggregateVerdict が fail すること", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const width = 100;
    const height = 100;
    const { design, screenshot } = await createShiftedPattern(width, height, 15);

    const result = buildDiffReport({
      designPixels: design,
      screenshotPixels: screenshot,
      width,
      height,
    });

    // 補正が採用されている (アライメント検知が機能している証拠)。
    expect(Math.abs(result.alignment.translation.x)).toBeGreaterThanOrEqual(10);

    const positionIssue = result.issues.find((issue) => issue.kind === "position");
    expect(positionIssue).toBeDefined();
    expect(positionIssue?.severity).toBe("critical");

    // これが今回の修正の核心: 補正後の region score は綺麗に見えても、
    // critical position issue が computeVerdict の hasCriticalIssue を
    // 通じて verdict を fail にする（グローバルシフトが黙って消えない）。
    expect(result.aggregateVerdict).toBe("fail");
  });
});

// テストデータと期待値で同じ値を参照する。分散させると検証対象が黙ってずれる。
const SCOPE_FIXTURE_NODE_IDS = { root: "scope-root", banner: "scope-banner" };

describe("比較対象そのものの行が他の判断へ漏れないこと", () => {
  const makeNode = (
    id: string,
    box: { x: number; y: number; width: number; height: number },
  ): FigmaNode => ({
    id,
    name: id,
    type: "FRAME",
    absoluteBoundingBox: box,
    absoluteRenderBounds: null,
    fills: [],
    strokes: [],
    effects: [],
    children: [],
  });

  it("子が全部合格なら、背景だけの色差で不合格にしないこと", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const size = 200;
    // 子は上端の帯だけ。そこは一致させ、残りの背景だけ大きく色を変える。
    const designPixels = await createSolidRgba(size, size, WHITE_RGB);
    const screenshotPixels = Uint8ClampedArray.from(designPixels);
    for (let y = 60; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const index = (y * size + x) * 4;
        screenshotPixels[index] = BLUE_RGB.r;
        screenshotPixels[index + 1] = BLUE_RGB.g;
        screenshotPixels[index + 2] = BLUE_RGB.b;
      }
    }

    const report = buildDiffReport({
      designPixels,
      screenshotPixels,
      width: size,
      height: size,
      figmaRootNode: {
        ...makeNode(SCOPE_FIXTURE_NODE_IDS.root, { x: 0, y: 0, width: size, height: size }),
        children: [
          makeNode(SCOPE_FIXTURE_NODE_IDS.banner, { x: 0, y: 0, width: size, height: 40 }),
        ],
      },
    });

    // 合否を決める不具合が、比較対象そのものの行から作られていないこと。
    expect(report.issues.every((issue) => issue.regionId !== "whole-frame")).toBe(true);
  });
});

// テストデータと期待値で同じ値を参照する。分散させると検証対象が黙ってずれる。
const ISSUE_56_FIXTURE_NODE_IDS = { root: "issue-56-root", child: "issue-56-child" };

describe("diffRegions による局所採点 (Issue #56)", () => {
  const FRAME_SIZE = 300;
  const LOCAL_DIFF_SIZE = 40;
  const LOCAL_DIFF_X = 130;
  const LOCAL_DIFF_Y = 130;

  it("figmaRootNode が無い比較で、小面積の局所差分が whole-frame 平均に薄まらないこと", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const designPixels = await createSolidRgba(FRAME_SIZE, FRAME_SIZE, WHITE_RGB);
    const screenshotPixels = Uint8ClampedArray.from(designPixels);
    for (let y = LOCAL_DIFF_Y; y < LOCAL_DIFF_Y + LOCAL_DIFF_SIZE; y++) {
      for (let x = LOCAL_DIFF_X; x < LOCAL_DIFF_X + LOCAL_DIFF_SIZE; x++) {
        const index = (y * FRAME_SIZE + x) * 4;
        screenshotPixels[index] = 20;
        screenshotPixels[index + 1] = 20;
        screenshotPixels[index + 2] = 20;
      }
    }

    const withoutClusterHint = buildDiffReport({
      designPixels,
      screenshotPixels,
      width: FRAME_SIZE,
      height: FRAME_SIZE,
    });

    // クラスタ情報を渡さない従来経路: whole-frame 1行の面積重み平均に薄まり、
    // 40x40 (面積比 1.78%) は 0.95 の pass 閾値を超えてしまう。これが #56 の症状。
    expect(withoutClusterHint.weightedAggregate?.weightedStructure ?? 0).toBeGreaterThanOrEqual(
      PASS_STRUCTURE_THRESHOLD,
    );

    const withClusterHint = buildDiffReport({
      designPixels,
      screenshotPixels,
      width: FRAME_SIZE,
      height: FRAME_SIZE,
      diffRegions: [{ x: LOCAL_DIFF_X, y: LOCAL_DIFF_Y, w: LOCAL_DIFF_SIZE, h: LOCAL_DIFF_SIZE }],
    });

    // クラスタを採点単位に使うと、局所差分がそのまま structure へ反映され pass 閾値を割る。
    // aggregateVerdict (FigDiff 自身の合否) ではなく、weightedStructure・
    // regionScores・issues という独立した個々の信号で検証する。
    expect(withClusterHint.weightedAggregate?.weightedStructure ?? 1).toBeLessThan(
      PASS_STRUCTURE_THRESHOLD,
    );
    const expectedClusterRegionId = `diff-cluster-${LOCAL_DIFF_X}-${LOCAL_DIFF_Y}`;
    const clusterRegion = withClusterHint.regionScores.find(
      (score) => score.regionId === expectedClusterRegionId,
    );
    expect(clusterRegion).toBeDefined();
    expect(clusterRegion?.bbox).toEqual({
      x: LOCAL_DIFF_X,
      y: LOCAL_DIFF_Y,
      w: LOCAL_DIFF_SIZE,
      h: LOCAL_DIFF_SIZE,
    });
    expect(clusterRegion?.color).toBeGreaterThanOrEqual(2);
    expect(
      withClusterHint.issues.some(
        (issue) => issue.regionId === expectedClusterRegionId && issue.kind === "color",
      ),
    ).toBe(true);
  });

  it("figmaRootNode がある比較では diffRegions を渡しても子ノード優先の挙動を変えないこと", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const designPixels = await createSolidRgba(FRAME_SIZE, FRAME_SIZE, WHITE_RGB);
    const screenshotPixels = Uint8ClampedArray.from(designPixels);

    const report = buildDiffReport({
      designPixels,
      screenshotPixels,
      width: FRAME_SIZE,
      height: FRAME_SIZE,
      figmaRootNode: {
        id: ISSUE_56_FIXTURE_NODE_IDS.root,
        name: ISSUE_56_FIXTURE_NODE_IDS.root,
        type: "FRAME",
        absoluteBoundingBox: { x: 0, y: 0, width: FRAME_SIZE, height: FRAME_SIZE },
        absoluteRenderBounds: null,
        fills: [],
        strokes: [],
        effects: [],
        children: [
          {
            id: ISSUE_56_FIXTURE_NODE_IDS.child,
            name: ISSUE_56_FIXTURE_NODE_IDS.child,
            type: "FRAME",
            absoluteBoundingBox: { x: 0, y: 0, width: FRAME_SIZE, height: 40 },
            absoluteRenderBounds: null,
            fills: [],
            strokes: [],
            effects: [],
            children: [],
          },
        ],
      },
      diffRegions: [{ x: LOCAL_DIFF_X, y: LOCAL_DIFF_Y, w: LOCAL_DIFF_SIZE, h: LOCAL_DIFF_SIZE }],
    });

    expect(report.regionScores.some((score) => score.regionId === "diff-cluster-0")).toBe(false);
    expect(
      report.regionScores.some((score) => score.regionId === ISSUE_56_FIXTURE_NODE_IDS.child),
    ).toBe(true);
  });

  it("64px^2 未満の小さいクラスタも捨てずに採点すること", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const designPixels = await createSolidRgba(FRAME_SIZE, FRAME_SIZE, WHITE_RGB);
    const screenshotPixels = Uint8ClampedArray.from(designPixels);
    // 1x40 の細い欠落 (面積 40 < MIN_REGION_PIXEL_AREA=64)。
    // pixelmatch のクラスタリングは自前の連結画素数閾値で既にノイズ除去済みなので、
    // ここで子ノード用の面積フィルタを再適用して捨てるべきではない。
    const thinDiffY = 150;
    for (let x = 100; x < 140; x++) {
      const index = (thinDiffY * FRAME_SIZE + x) * 4;
      screenshotPixels[index] = 20;
      screenshotPixels[index + 1] = 20;
      screenshotPixels[index + 2] = 20;
    }

    const report = buildDiffReport({
      designPixels,
      screenshotPixels,
      width: FRAME_SIZE,
      height: FRAME_SIZE,
      diffRegions: [{ x: 100, y: thinDiffY, w: 40, h: 1 }],
    });

    expect(
      report.regionScores.some((score) => score.regionId === `diff-cluster-100-${thinDiffY}`),
    ).toBe(true);
  });

  it("上限を超えるクラスタ数のとき、均等間引きではなく diffPixelCount が大きい順に残すこと", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const designPixels = await createSolidRgba(FRAME_SIZE, FRAME_SIZE, WHITE_RGB);
    const screenshotPixels = Uint8ClampedArray.from(designPixels);
    for (let y = LOCAL_DIFF_Y; y < LOCAL_DIFF_Y + LOCAL_DIFF_SIZE; y++) {
      for (let x = LOCAL_DIFF_X; x < LOCAL_DIFF_X + LOCAL_DIFF_SIZE; x++) {
        const index = (y * FRAME_SIZE + x) * 4;
        screenshotPixels[index] = 20;
        screenshotPixels[index + 1] = 20;
        screenshotPixels[index + 2] = 20;
      }
    }

    // 25件目 (MAX_REGION_SCORE_COUNT=24 超過) の末尾に、本命の大きな差分を置く。
    // 均等間引きなら先頭寄りのインデックスが優先され、この本命が漏れる。
    const noiseRegions = Array.from({ length: 24 }, (_, i) => ({
      x: i * 4,
      y: 0,
      w: 8,
      h: 8,
      diffPixelCount: 1,
    }));
    const realDefect = {
      x: LOCAL_DIFF_X,
      y: LOCAL_DIFF_Y,
      w: LOCAL_DIFF_SIZE,
      h: LOCAL_DIFF_SIZE,
      diffPixelCount: 1600,
    };

    const report = buildDiffReport({
      designPixels,
      screenshotPixels,
      width: FRAME_SIZE,
      height: FRAME_SIZE,
      diffRegions: [...noiseRegions, realDefect],
    });

    const scored = report.regionScores.find(
      (score) => score.bbox.x === LOCAL_DIFF_X && score.bbox.y === LOCAL_DIFF_Y,
    );
    expect(scored).toBeDefined();
    expect(scored?.structure).toBeLessThan(1);
  });

  it("regionId が重大度の順位ではなく座標由来で、比較のたびに安定すること", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const designPixels = await createSolidRgba(FRAME_SIZE, FRAME_SIZE, WHITE_RGB);
    const screenshotPixels = Uint8ClampedArray.from(designPixels);
    const regionA = { x: 20, y: 20, w: 10, h: 10 };
    const regionB = { x: 200, y: 200, w: 10, h: 10 };

    // 1回目: A の方が重大度 (diffPixelCount) が高い。
    const firstPass = buildDiffReport({
      designPixels,
      screenshotPixels,
      width: FRAME_SIZE,
      height: FRAME_SIZE,
      diffRegions: [
        { ...regionA, diffPixelCount: 100 },
        { ...regionB, diffPixelCount: 10 },
      ],
    });

    // 2回目: 順位が入れ替わり B の方が重大度が高い。座標由来の ID なら
    // 同じ regionId が同じ物理領域を指し続けるはず。self-critique
    // (package/shared/src/self-critique.ts) は regionId で前回スコアと
    // 突き合わせるため、順位由来の ID だと入れ替わりで誤った回帰検出になる。
    const secondPass = buildDiffReport({
      designPixels,
      screenshotPixels,
      width: FRAME_SIZE,
      height: FRAME_SIZE,
      diffRegions: [
        { ...regionA, diffPixelCount: 10 },
        { ...regionB, diffPixelCount: 100 },
      ],
    });

    const idsForRegionA = `diff-cluster-${regionA.x}-${regionA.y}`;
    const idsForRegionB = `diff-cluster-${regionB.x}-${regionB.y}`;
    expect(firstPass.regionScores.some((score) => score.regionId === idsForRegionA)).toBe(true);
    expect(firstPass.regionScores.some((score) => score.regionId === idsForRegionB)).toBe(true);
    expect(secondPass.regionScores.some((score) => score.regionId === idsForRegionA)).toBe(true);
    expect(secondPass.regionScores.some((score) => score.regionId === idsForRegionB)).toBe(true);
  });

  function buildAlignedShiftFixtures(size: number, shift: number) {
    const checkerBlock = 20;
    // 位置ずれ検出はSSDのオフセット探索なので、単色画像では常にオフセット0が
    // 最善に見えて検出が働かない。市松模様にして実際に検出できるようにする。
    const designPixels = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const index = (y * size + x) * 4;
        const dark = (Math.floor(x / checkerBlock) + Math.floor(y / checkerBlock)) % 2 === 0;
        const value = dark ? 20 : 230;
        designPixels[index] = value;
        designPixels[index + 1] = value;
        designPixels[index + 2] = value;
        designPixels[index + 3] = 255;
      }
    }
    // スクリーンショット側を左上へ shift px シフトさせ、割に合う位置ずれ補正が
    // 掛かる状況を作る (境界にはみ出し分が残る)。
    const screenshotPixels = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const srcX = x + shift;
        const srcY = y + shift;
        const dstIndex = (y * size + x) * 4;
        if (srcX < size && srcY < size) {
          const srcIndex = (srcY * size + srcX) * 4;
          screenshotPixels[dstIndex] = designPixels[srcIndex];
          screenshotPixels[dstIndex + 1] = designPixels[srcIndex + 1];
          screenshotPixels[dstIndex + 2] = designPixels[srcIndex + 2];
          screenshotPixels[dstIndex + 3] = 255;
        }
      }
    }
    return { designPixels, screenshotPixels };
  }

  it("位置ずれ補正が適用された回、境界付近のクラスタは除外すること", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const size = 200;
    const shift = 6;
    const { designPixels, screenshotPixels } = buildAlignedShiftFixtures(size, shift);

    const report = buildDiffReport({
      designPixels,
      screenshotPixels,
      width: size,
      height: size,
      // 補正前の座標系で作った、境界 (0,0) に接するクラスタ。補正後は
      // shiftPixels のはみ出し塗り (透明/RGB0) を拾ってしまうため除外される。
      diffRegions: [{ x: 0, y: 0, w: 20, h: 20 }],
    });

    expect(report.regionScores.some((score) => score.regionId === "diff-cluster-0-0")).toBe(false);
  });

  it("位置ずれ補正が適用された回でも、境界から離れたクラスタは局所採点を使うこと", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const size = 200;
    const shift = 6;
    const { designPixels, screenshotPixels } = buildAlignedShiftFixtures(size, shift);
    // 中央付近に本物の局所差分 (市松模様と無関係な単色パッチ) を追加する。
    const localDiffX = 100;
    const localDiffY = 100;
    for (let y = localDiffY; y < localDiffY + 30; y++) {
      for (let x = localDiffX; x < localDiffX + 30; x++) {
        const index = (y * size + x) * 4;
        screenshotPixels[index] = 128;
        screenshotPixels[index + 1] = 128;
        screenshotPixels[index + 2] = 128;
      }
    }

    const report = buildDiffReport({
      designPixels,
      screenshotPixels,
      width: size,
      height: size,
      // 境界から十分離れているので、シフト量(6px)の余白フィルタに掛からない。
      diffRegions: [{ x: localDiffX, y: localDiffY, w: 30, h: 30 }],
    });

    expect(
      report.regionScores.some(
        (score) => score.regionId === `diff-cluster-${localDiffX}-${localDiffY}`,
      ),
    ).toBe(true);
  });
});

// テストデータと期待値で同じ値を参照する。分散させると検証対象が黙ってずれる。
const VISIBILITY_FIXTURE_NODE_IDS = { visible: "layer-visible", hidden: "layer-hidden" };
const VARIANT_FIXTURE_NODE_IDS = { a: "variant-a", b: "variant-b", c: "variant-c" };

describe("buildRegionScores の対象選び", () => {
  const makeChild = (
    id: string,
    box: { x: number; y: number; width: number; height: number },
    visible?: boolean,
  ): FigmaNode => ({
    id,
    name: id,
    type: "FRAME",
    visible,
    absoluteBoundingBox: box,
    absoluteRenderBounds: null,
    fills: [],
    strokes: [],
    effects: [],
    children: [],
  });

  const makeRoot = (children: FigmaNode[]): FigmaNode => ({
    id: "root",
    name: "Frame",
    type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 200 },
    absoluteRenderBounds: null,
    fills: [],
    strokes: [],
    effects: [],
    children,
  });

  async function scoreIdsFor(children: FigmaNode[]): Promise<string[]> {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const designPixels = await createSolidRgba(200, 200, WHITE_RGB);
    const screenshotPixels = await createSolidRgba(200, 200, BLUE_RGB);
    const report = buildDiffReport({
      designPixels,
      screenshotPixels,
      width: 200,
      height: 200,
      figmaRootNode: makeRoot(children),
    });
    return report.regionScores.map((score) => score.figmaNodeId ?? score.regionId);
  }

  it("非表示の子は評価対象に入れないこと", async () => {
    const ids = await scoreIdsFor([
      makeChild(VISIBILITY_FIXTURE_NODE_IDS.visible, { x: 0, y: 0, width: 200, height: 100 }),
      makeChild(
        VISIBILITY_FIXTURE_NODE_IDS.hidden,
        { x: 0, y: 100, width: 200, height: 100 },
        false,
      ),
    ]);

    expect(ids).toContain(VISIBILITY_FIXTURE_NODE_IDS.visible);
    expect(ids).not.toContain(VISIBILITY_FIXTURE_NODE_IDS.hidden);
  });

  it("同じ位置・同じ大きさの子は1件だけ残すこと", async () => {
    const ids = await scoreIdsFor([
      makeChild(VARIANT_FIXTURE_NODE_IDS.a, { x: 0, y: 0, width: 200, height: 100 }),
      makeChild(VARIANT_FIXTURE_NODE_IDS.b, { x: 0, y: 0, width: 200, height: 100 }),
      makeChild(VARIANT_FIXTURE_NODE_IDS.c, { x: 0, y: 0, width: 200, height: 100 }),
    ]);

    const variants = ids.filter((id) => id.startsWith("variant-"));
    expect(variants).toHaveLength(1);
  });
});

describe("同じ矩形の子が複数あるときの扱い", () => {
  const makeChild = (id: string): FigmaNode => ({
    id,
    name: id,
    type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 100 },
    absoluteRenderBounds: null,
    fills: [],
    strokes: [],
    effects: [],
    children: [],
  });

  it("手前に描かれる最後の子の名前を残すこと", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const designPixels = await createSolidRgba(200, 200, WHITE_RGB);
    const screenshotPixels = await createSolidRgba(200, 200, BLUE_RGB);

    const report = buildDiffReport({
      designPixels,
      screenshotPixels,
      width: 200,
      height: 200,
      figmaRootNode: {
        id: "root",
        name: "Frame",
        type: "FRAME",
        absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 200 },
        absoluteRenderBounds: null,
        fills: [],
        strokes: [],
        effects: [],
        children: [makeChild("under"), makeChild("middle"), makeChild("on-top")],
      },
    });

    const ids = report.regionScores.map((score) => score.figmaNodeId);
    expect(ids).toContain("on-top");
    expect(ids).not.toContain("under");
    expect(ids).not.toContain("middle");
  });

  it("下に隠れた層のIDも残すこと", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const designPixels = await createSolidRgba(200, 200, WHITE_RGB);
    const screenshotPixels = await createSolidRgba(200, 200, BLUE_RGB);

    const report = buildDiffReport({
      designPixels,
      screenshotPixels,
      width: 200,
      height: 200,
      figmaRootNode: {
        id: "root",
        name: "Frame",
        type: "FRAME",
        absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 200 },
        absoluteRenderBounds: null,
        fills: [],
        strokes: [],
        effects: [],
        children: [makeChild("under"), makeChild("middle"), makeChild("on-top")],
      },
    });

    // 半透明や部分的な塗りだと下の層も見えている。直し先を辿れる状態を保つ。
    const merged = report.regionScores.find((score) => score.figmaNodeId === "on-top");
    expect(merged?.overlappingNodeIds).toEqual(["under", "middle"]);
  });
});

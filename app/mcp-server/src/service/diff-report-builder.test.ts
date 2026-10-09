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

  it("マスク内の内容を全指標の分母から外し、偽の境界を作らないこと", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const width = 100;
    const height = 100;
    const maskedRows = 84;
    const designPixels = await createSolidRgba(width, height, { r: 0x22, g: 0xaa, b: 0x88 });
    const screenshotPixels = Uint8ClampedArray.from(designPixels);
    const ignoreMask = new Uint8Array(width * height);

    for (let y = 0; y < maskedRows; y++) {
      for (let x = 0; x < width; x++) {
        const pixel = y * width + x;
        const offset = pixel * 4;
        ignoreMask[pixel] = 1;
        screenshotPixels[offset] = 255;
        screenshotPixels[offset + 1] = 0;
        screenshotPixels[offset + 2] = 0;
      }
    }

    const result = buildDiffReport({
      designPixels,
      screenshotPixels,
      width,
      height,
      ignoreMask,
      resolvedAlignment: {
        alignment: {
          translation: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          confidence: 1,
          residual: 0,
        },
        alignedDesignPixels: designPixels,
        applied: false,
      },
    });

    expect(result.aggregateVerdict).toBe("pass");
    expect(result.regionScores[0]).toMatchObject({
      structure: 1,
      color: 0,
      shape: 0,
    });
    expect(result.regionScores[0].flatColorMismatch).toBeUndefined();
  });

  it("84%をマスクしても残り領域の実差分を fail にすること", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const width = 100;
    const height = 100;
    const maskedRows = 84;
    const designPixels = await createSolidRgba(width, height, { r: 0x22, g: 0xaa, b: 0x88 });
    const screenshotPixels = await createSolidRgba(width, height, {
      r: 0x28,
      g: 0xaa,
      b: 0x88,
    });
    const ignoreMask = new Uint8Array(width * height);

    for (let y = 0; y < maskedRows; y++) {
      ignoreMask.fill(1, y * width, (y + 1) * width);
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        screenshotPixels[offset] = 255;
        screenshotPixels[offset + 1] = 0;
        screenshotPixels[offset + 2] = 0;
      }
    }

    const result = buildDiffReport({
      designPixels,
      screenshotPixels,
      width,
      height,
      ignoreMask,
      resolvedAlignment: {
        alignment: {
          translation: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          confidence: 1,
          residual: 0,
        },
        alignedDesignPixels: designPixels,
        applied: false,
      },
    });

    expect(result.aggregateVerdict).toBe("fail");
    expect(result.regionScores[0].flatColorMismatch).toMatchObject({ maxChannelDelta: 6 });
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "color",
          severity: "critical",
          evidence: expect.objectContaining({ signal: "flat_region_color" }),
        }),
      ]),
    );
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
    // stdio transport の stdout は JSON-RPC 専用。上限超過の通知が stdout へ漏れると
    // クライアント側のフレーム解析が壊れるので、stderr (console.warn) だけに出ることを固定する。
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
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
      expect(stdoutWrite).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        `[diff-report] regionScores capped from ${SECTION_REGION_COUNT} to ${EXPECTED_CAPPED_REGION_COUNT}`,
      );
    } finally {
      stdoutWrite.mockRestore();
      warn.mockRestore();
    }
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

describe("buildDiffReport — glyph edge rasterization (#102)", () => {
  const width = 9;
  const height = 9;

  const makeGlyph = (edgeValue: number, xOffset = 0, coreHeight = 5): Uint8ClampedArray => {
    const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
    const coreX = 4 + xOffset;
    if (coreX - 1 < 0 || coreX >= width || coreHeight <= 0 || 2 + coreHeight > height) {
      throw new RangeError("glyph fixture coordinates are outside the canvas");
    }
    for (let y = 2; y < 2 + coreHeight; y++) {
      for (const [x, value] of [
        [coreX - 1, edgeValue],
        [coreX, 0],
      ] as const) {
        const offset = (y * width + x) * 4;
        pixels[offset] = value;
        pixels[offset + 1] = value;
        pixels[offset + 2] = value;
      }
    }
    return pixels;
  };

  const compare = async (designPixels: Uint8ClampedArray, screenshotPixels: Uint8ClampedArray) => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    return buildDiffReport({
      designPixels,
      screenshotPixels,
      width,
      height,
      diffRegions: [{ x: 2, y: 1, w: 5, h: 7, diffPixelCount: 5 }],
      resolvedAlignment: {
        alignment: {
          translation: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          confidence: 1,
          residual: 0,
        },
        alignedDesignPixels: designPixels,
        applied: false,
      },
    });
  };

  it("同一coreの中間alpha差を診断しつつFAIL採点を維持する", async () => {
    const result = await compare(makeGlyph(96), makeGlyph(144));

    expect(result.aggregateVerdict).toBe("fail");
    expect(result.rationale).toContain("glyph-edge rasterization");
    expect(result.rationale).toContain("retained in scoring");
    expect(result.regionScores[0].glyphEdgeRasterization).toMatchObject({
      classification: "glyph-edge-rasterization",
      changedPixelCount: 5,
    });
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "minor",
          evidence: expect.objectContaining({ signal: "glyph_edge_rasterization" }),
        }),
      ]),
    );
  });

  it("1pxの座標差はFAILを維持する", async () => {
    const result = await compare(makeGlyph(96), makeGlyph(96, 1));
    expect(result.aggregateVerdict).toBe("fail");
    expect(result.regionScores[0].glyphEdgeRasterization).toBeUndefined();
  });

  it("文字サイズや行高に相当するcore形状差はFAILを維持する", async () => {
    const result = await compare(makeGlyph(96, 0, 5), makeGlyph(96, 0, 4));
    expect(result.aggregateVerdict).toBe("fail");
    expect(result.regionScores[0].glyphEdgeRasterization).toBeUndefined();
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

  const createDenseShiftedPattern = async (
    width: number,
    height: number,
    dx: number,
  ): Promise<{ design: Uint8ClampedArray; screenshot: Uint8ClampedArray }> => {
    const build = (offsetX: number): Uint8ClampedArray => {
      const pixels = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          const sourceX = x + offsetX;
          const hash = (Math.imul(sourceX, 2_654_435_761) ^ Math.imul(y, 1_597_334_677)) >>> 0;
          pixels[idx] = hash;
          pixels[idx + 1] = (hash * 3 + 41) % 256;
          pixels[idx + 2] = (hash * 7 + 83) % 256;
          pixels[idx + 3] = 255;
        }
      }
      return pixels;
    };

    return { design: build(0), screenshot: build(dx) };
  };

  function createSystemInsetPattern(
    width: number,
    height: number,
    inset: number,
  ): {
    design: Uint8ClampedArray;
    screenshot: Uint8ClampedArray;
    ignoreMask: Uint8Array;
  } {
    const design = new Uint8ClampedArray(width * height * 4);
    const screenshot = new Uint8ClampedArray(design.length);
    const ignoreMask = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixel = y * width + x;
        const offset = pixel * 4;
        const value = (y * 37 + x * 11) % 251;
        design[offset] = value;
        design[offset + 1] = (value + 47) % 251;
        design[offset + 2] = (value + 89) % 251;
        design[offset + 3] = 255;
      }
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixel = y * width + x;
        const offset = pixel * 4;
        if (y < inset) {
          ignoreMask[pixel] = 1;
          screenshot.set(design.subarray(offset, offset + 4), offset);
          continue;
        }
        const sourceOffset = ((y - inset) * width + x) * 4;
        screenshot.set(design.subarray(sourceOffset, sourceOffset + 4), offset);
      }
    }
    return { design, screenshot, ignoreMask };
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

  it("採用されたグローバルシフト (>=2 working px)は position issue が critical になり aggregateVerdict が fail すること", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const width = 1000;
    const height = 1000;
    const { design, screenshot } = await createShiftedPattern(width, height, 5);

    const result = buildDiffReport({
      designPixels: design,
      screenshotPixels: screenshot,
      width,
      height,
    });

    // 補正が採用されている (アライメント検知が機能している証拠)。
    expect(Math.abs(result.alignment.translation.x)).toBeGreaterThanOrEqual(2);

    const positionIssue = result.issues.find(
      (issue) => issue.evidence.signal === "translation_offset",
    );
    expect(positionIssue).toBeDefined();
    expect(positionIssue?.severity).toBe("critical");

    // これが今回の修正の核心: 補正後の region score は綺麗に見えても、
    // critical position issue が computeVerdict の hasCriticalIssue を
    // 通じて verdict を fail にする（グローバルシフトが黙って消えない）。
    expect(result.aggregateVerdict).toBe("fail");
  });

  it("採用された境界値の2pxシフトはcriticalになりaggregateVerdictがfailすること", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const width = 1000;
    const height = 1000;
    const { design, screenshot } = await createDenseShiftedPattern(width, height, 2);

    const result = buildDiffReport({
      designPixels: design,
      screenshotPixels: screenshot,
      width,
      height,
      resolvedAlignment: {
        alignment: {
          translation: { x: -2, y: 0 },
          source: "auto",
          applied: true,
          scale: { x: 1, y: 1 },
          rotation: 0,
          confidence: 1,
          residual: 0,
        },
        alignedDesignPixels: screenshot,
        applied: true,
      },
    });

    expect(Math.abs(result.alignment.translation.x)).toBe(2);
    expect(result.alignment.applied).toBe(true);
    const positionIssue = result.issues.find(
      (issue) => issue.evidence.signal === "translation_offset",
    );
    expect(positionIssue?.severity).toBe("critical");
    expect(result.aggregateVerdict).toBe("fail");
  });

  it("採用された1pxシフトはcriticalへ昇格しないこと", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const width = 1000;
    const height = 1000;
    const { design, screenshot } = await createDenseShiftedPattern(width, height, 1);

    const result = buildDiffReport({
      designPixels: design,
      screenshotPixels: screenshot,
      width,
      height,
      resolvedAlignment: {
        alignment: {
          translation: { x: -1, y: 0 },
          source: "auto",
          applied: true,
          scale: { x: 1, y: 1 },
          rotation: 0,
          confidence: 1,
          residual: 0,
        },
        alignedDesignPixels: screenshot,
        applied: true,
      },
    });

    expect(Math.abs(result.alignment.translation.x)).toBe(1);
    expect(result.alignment.applied).toBe(true);
    const positionIssue = result.issues.find(
      (issue) => issue.evidence.signal === "translation_offset",
    );
    expect(positionIssue).toBeUndefined();
    expect(result.aggregateVerdict).not.toBe("fail");
  });

  it("内部検証済み status bar inset と一致する下方向だけは critical にしないこと", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const width = 100;
    const height = 100;
    const inset = 72;
    const { design, screenshot, ignoreMask } = createSystemInsetPattern(width, height, inset);
    const designBefore = Uint8ClampedArray.from(design);
    const screenshotBefore = Uint8ClampedArray.from(screenshot);

    const result = buildDiffReport({
      designPixels: design,
      screenshotPixels: screenshot,
      width,
      height,
      ignoreMask,
      verifiedSystemUiTopInset: inset,
    });

    expect(result.alignment.translation).toEqual({ x: 0, y: inset });
    const positionIssue = result.issues.find(
      (issue) => issue.evidence.signal === "translation_offset",
    );
    expect(positionIssue).toBeUndefined();
    expect(result.aggregateVerdict).toBe("pass");
    expect(design).toEqual(designBefore);
    expect(screenshot).toEqual(screenshotBefore);
  });

  it("status bar inset と一致しない大きな縦シフトは従来どおり critical にすること", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const width = 100;
    const height = 100;
    const inset = 72;
    const { design, screenshot, ignoreMask } = createSystemInsetPattern(width, height, inset);

    const result = buildDiffReport({
      designPixels: design,
      screenshotPixels: screenshot,
      width,
      height,
      ignoreMask,
      // 候補幅の実装詳細に依存させず、実際のずれ量から十分離れた値を使う。
      verifiedSystemUiTopInset: 40,
    });

    const positionIssue = result.issues.find(
      (issue) => issue.evidence.signal === "translation_offset",
    );
    expect(positionIssue?.severity).toBe("critical");
    expect(result.aggregateVerdict).toBe("fail");
  });

  it("status bar inset と同じ量でも横シフトは従来どおり critical にすること", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const width = 100;
    const height = 100;
    const inset = 15;
    const { design, screenshot } = await createShiftedPattern(width, height, inset);

    const result = buildDiffReport({
      designPixels: design,
      screenshotPixels: screenshot,
      width,
      height,
      verifiedSystemUiTopInset: inset,
    });

    const positionIssue = result.issues.find(
      (issue) => issue.evidence.signal === "translation_offset",
    );
    expect(positionIssue?.severity).toBe("critical");
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
    const expectedClusterRegionId = `diff-cluster-${LOCAL_DIFF_X}-${LOCAL_DIFF_Y}-${LOCAL_DIFF_SIZE}-${LOCAL_DIFF_SIZE}`;
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
      report.regionScores.some((score) => score.regionId === `diff-cluster-100-${thinDiffY}-40-1`),
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

  it("大量の未採点クラスタを配列引数へ展開せず処理すること", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const width = 500;
    const height = 260;
    const designPixels = await createSolidRgba(width, height, WHITE_RGB);
    const screenshotPixels = Uint8ClampedArray.from(designPixels);
    const regions = Array.from({ length: width * height }, (_, pixel) => ({
      x: pixel % width,
      y: Math.floor(pixel / width),
      w: 1,
      h: 1,
      diffPixelCount: 1,
    }));

    expect(() =>
      buildDiffReport({
        designPixels,
        screenshotPixels,
        width,
        height,
        diffRegions: regions,
      }),
    ).not.toThrow();
  });

  const paintDarkSquare = (pixels: Uint8ClampedArray, x0: number, y0: number, size: number) => {
    for (let y = y0; y < y0 + size; y++) {
      for (let x = x0; x < x0 + size; x++) {
        const index = (y * FRAME_SIZE + x) * 4;
        pixels[index] = 20;
        pixels[index + 1] = 20;
        pixels[index + 2] = 20;
      }
    }
  };

  // 画素が一致する (=採点すると無害な) クラスタを格子状に並べる。diffPixelCount
  // だけを大きくして、本命の差分より採点順位を上にする。
  const buildHarmlessClusters = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      x: (i % 30) * 10,
      y: Math.floor(i / 30) * 10,
      w: 8,
      h: 8,
      diffPixelCount: 500,
    }));

  it("ノード木の無い比較で、25件目以降の小さな実差分も採点して fail にすること", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const designPixels = await createSolidRgba(FRAME_SIZE, FRAME_SIZE, WHITE_RGB);
    const screenshotPixels = Uint8ClampedArray.from(designPixels);
    paintDarkSquare(screenshotPixels, LOCAL_DIFF_X, LOCAL_DIFF_Y, 4);
    const realDefect = { x: LOCAL_DIFF_X, y: LOCAL_DIFF_Y, w: 4, h: 4, diffPixelCount: 16 };

    const report = buildDiffReport({
      designPixels,
      screenshotPixels,
      width: FRAME_SIZE,
      height: FRAME_SIZE,
      diffRegions: [...buildHarmlessClusters(24), realDefect],
    });

    expect(
      report.regionScores.some(
        (score) => score.regionId === `diff-cluster-${LOCAL_DIFF_X}-${LOCAL_DIFF_Y}-4-4`,
      ),
    ).toBe(true);
    expect(report.aggregateVerdict).toBe("fail");
  });

  it("ノード木の無い比較で、採点上限から外れたクラスタが残れば pass にしないこと", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const designPixels = await createSolidRgba(FRAME_SIZE, FRAME_SIZE, WHITE_RGB);
    const screenshotPixels = Uint8ClampedArray.from(designPixels);
    paintDarkSquare(screenshotPixels, LOCAL_DIFF_X, LOCAL_DIFF_Y, 4);
    const unscoredDefect = { x: LOCAL_DIFF_X, y: LOCAL_DIFF_Y, w: 4, h: 4, diffPixelCount: 16 };

    const report = buildDiffReport({
      designPixels,
      screenshotPixels,
      width: FRAME_SIZE,
      height: FRAME_SIZE,
      diffRegions: [...buildHarmlessClusters(200), unscoredDefect],
    });

    expect(
      report.regionScores.some(
        (score) => score.regionId === `diff-cluster-${LOCAL_DIFF_X}-${LOCAL_DIFF_Y}-4-4`,
      ),
    ).toBe(false);
    expect(report.aggregateVerdict).toBe("inconclusive");
    expect(report.rationale).toContain("1 diff cluster(s) beyond the 200-cluster scoring limit");
  });

  it("採点上限ちょうどのクラスタ数で全件が無害なら pass のままにすること", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const designPixels = await createSolidRgba(FRAME_SIZE, FRAME_SIZE, WHITE_RGB);
    const screenshotPixels = Uint8ClampedArray.from(designPixels);

    const report = buildDiffReport({
      designPixels,
      screenshotPixels,
      width: FRAME_SIZE,
      height: FRAME_SIZE,
      diffRegions: buildHarmlessClusters(200),
    });

    expect(report.aggregateVerdict).toBe("pass");
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

    const idsForRegionA = `diff-cluster-${regionA.x}-${regionA.y}-${regionA.w}-${regionA.h}`;
    const idsForRegionB = `diff-cluster-${regionB.x}-${regionB.y}-${regionB.w}-${regionB.h}`;
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

  it("位置ずれ補正が適用された回、境界帯に完全に収まるクラスタは除外すること", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const size = 200;
    const shift = 6;
    const { designPixels, screenshotPixels } = buildAlignedShiftFixtures(size, shift);
    // buildAlignedShiftFixtures は screenshot(x,y)=design(x+shift,y+shift) を作るため、
    // resolveAlignment は dx=dy=-shift を検出する。shiftPixels の srcX=x-dx=x+shift は
    // 右端 (x>=width-shift) と下端 (y>=height-shift) だけを空で埋める。
    // このクラスタは丸ごとその帯の内側 (x=195..200) にあり、クリップすると
    // 幅が0以下になるので除外される。
    const report = buildDiffReport({
      designPixels,
      screenshotPixels,
      width: size,
      height: size,
      diffRegions: [{ x: 195, y: 195, w: 5, h: 5 }],
    });

    expect(
      report.regionScores.some((score) => score.regionId.startsWith("diff-cluster-195-195")),
    ).toBe(false);
  });

  it("位置ずれ補正が適用された回、境界帯にまたがるクラスタは切り捨てて有効な内側だけ採点すること", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const size = 200;
    const shift = 6;
    const { designPixels, screenshotPixels } = buildAlignedShiftFixtures(size, shift);
    // x:180..200 (幅20) は右端の境界帯 (194..200, 幅6) にまたがる。丸ごと除外
    // すると内側の有効な14px分まで捨ててしまうため、194 でクリップして残す。
    const report = buildDiffReport({
      designPixels,
      screenshotPixels,
      width: size,
      height: size,
      diffRegions: [{ x: 180, y: 180, w: 20, h: 20 }],
    });

    const clipped = report.regionScores.find((score) =>
      score.regionId.startsWith("diff-cluster-180-180"),
    );
    expect(clipped).toBeDefined();
    expect(clipped?.bbox).toEqual({ x: 180, y: 180, w: 14, h: 14 });
  });

  it("位置ずれ補正がかかっても、ずれと無関係な辺のクラスタは除外しないこと", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const size = 200;
    const shift = 6;
    const { designPixels, screenshotPixels } = buildAlignedShiftFixtures(size, shift);
    // dx=dy=-shift のとき、はみ出しが生じるのは右端・下端だけ。左上 (0,0) の
    // クラスタは影響を受けないので除外されるべきではない (対称マージンだと
    // 誤って除外してしまっていた)。
    const report = buildDiffReport({
      designPixels,
      screenshotPixels,
      width: size,
      height: size,
      diffRegions: [{ x: 0, y: 0, w: 20, h: 20 }],
    });

    expect(report.regionScores.some((score) => score.regionId === "diff-cluster-0-0-20-20")).toBe(
      true,
    );
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
        (score) => score.regionId === `diff-cluster-${localDiffX}-${localDiffY}-30-30`,
      ),
    ).toBe(true);
  });
});

describe("localAlignmentTolerancePx による局所シフト許容 (designdiff#230)", () => {
  const FRAME_SIZE = 300;
  const BLOB_SIZE = 40;
  const BLOB_X = 130;
  const BLOB_Y = 130;

  const paintRect = (
    pixels: Uint8ClampedArray,
    x: number,
    y: number,
    w: number,
    h: number,
    rgb: { r: number; g: number; b: number },
  ): void => {
    for (let row = y; row < y + h; row++) {
      for (let col = x; col < x + w; col++) {
        const index = (row * FRAME_SIZE + col) * 4;
        pixels[index] = rgb.r;
        pixels[index + 1] = rgb.g;
        pixels[index + 2] = rgb.b;
      }
    }
  };

  const shiftedBlobFixtures = async (shiftX: number) => {
    const designPixels = await createSolidRgba(FRAME_SIZE, FRAME_SIZE, WHITE_RGB);
    const screenshotPixels = Uint8ClampedArray.from(designPixels);
    const black = { r: 20, g: 20, b: 20 };
    paintRect(designPixels, BLOB_X, BLOB_Y, BLOB_SIZE, BLOB_SIZE, black);
    paintRect(screenshotPixels, BLOB_X + shiftX, BLOB_Y, BLOB_SIZE, BLOB_SIZE, black);
    return { designPixels, screenshotPixels };
  };

  it("指定時は ±3px の平行移動を検出して critical ではなく minor issue として残す", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const { designPixels, screenshotPixels } = await shiftedBlobFixtures(3);
    // diff クラスタの bbox は両側のブロックを含む union 領域。
    const cluster = { x: BLOB_X, y: BLOB_Y, w: BLOB_SIZE + 3, h: BLOB_SIZE };

    const report = buildDiffReport({
      designPixels,
      screenshotPixels,
      width: FRAME_SIZE,
      height: FRAME_SIZE,
      diffRegions: [cluster],
      localAlignmentTolerancePx: 3,
    });

    const region = report.regionScores.find(
      (score) =>
        score.regionId === `diff-cluster-${cluster.x}-${cluster.y}-${cluster.w}-${cluster.h}`,
    );
    expect(region?.localAlignment).toMatchObject({ dx: 3, dy: 0, structure: 1 });

    // 位置ずれの事実は消えず minor の position issue として証跡に残る。
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "minor",
          kind: "position",
          evidence: expect.objectContaining({
            signal: "local_translation",
            actual: expect.stringContaining("(3, 0)px shift"),
          }),
        }),
      ]),
    );
    expect(report.issues.some((issue) => issue.severity === "critical")).toBe(false);
    expect(report.aggregateVerdict).toBe("pass");
  });

  it("未指定 (既定) では同じ 3px 差分を従来どおり失格扱いにする", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const { designPixels, screenshotPixels } = await shiftedBlobFixtures(3);
    const cluster = { x: BLOB_X, y: BLOB_Y, w: BLOB_SIZE + 3, h: BLOB_SIZE };

    const report = buildDiffReport({
      designPixels,
      screenshotPixels,
      width: FRAME_SIZE,
      height: FRAME_SIZE,
      diffRegions: [cluster],
    });

    const region = report.regionScores.find(
      (score) =>
        score.regionId === `diff-cluster-${cluster.x}-${cluster.y}-${cluster.w}-${cluster.h}`,
    );
    expect(region?.localAlignment).toBeUndefined();
    expect(report.aggregateVerdict).not.toBe("pass");
  });

  it("内容物が違う領域は許容指定があっても救済されず critical を維持する", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const designPixels = await createSolidRgba(FRAME_SIZE, FRAME_SIZE, WHITE_RGB);
    const screenshotPixels = Uint8ClampedArray.from(designPixels);
    paintRect(screenshotPixels, BLOB_X, BLOB_Y, BLOB_SIZE, BLOB_SIZE, { r: 200, g: 30, b: 30 });
    const cluster = { x: BLOB_X, y: BLOB_Y, w: BLOB_SIZE, h: BLOB_SIZE };

    const report = buildDiffReport({
      designPixels,
      screenshotPixels,
      width: FRAME_SIZE,
      height: FRAME_SIZE,
      diffRegions: [cluster],
      localAlignmentTolerancePx: 3,
    });

    const region = report.regionScores.find(
      (score) =>
        score.regionId === `diff-cluster-${cluster.x}-${cluster.y}-${cluster.w}-${cluster.h}`,
    );
    expect(region?.localAlignment).toBeUndefined();
    expect(
      report.issues.some(
        (issue) => issue.regionId === region?.regionId && issue.severity === "critical",
      ),
    ).toBe(true);
  });
});

describe("rasterization_tolerance による同一トークン採点 (designdiff#230)", () => {
  const width = 9;
  const height = 9;

  const makeGlyph = (edgeValue: number, xOffset = 0): Uint8ClampedArray => {
    const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
    const coreX = 4 + xOffset;
    for (let y = 2; y < 7; y++) {
      for (const [x, value] of [
        [coreX - 1, edgeValue],
        [coreX, 0],
      ] as const) {
        const offset = (y * width + x) * 4;
        pixels[offset] = value;
        pixels[offset + 1] = value;
        pixels[offset + 2] = value;
      }
    }
    return pixels;
  };

  const compare = async (
    designPixels: Uint8ClampedArray,
    screenshotPixels: Uint8ClampedArray,
    rasterizationTolerance?: boolean,
  ) => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    return buildDiffReport({
      designPixels,
      screenshotPixels,
      width,
      height,
      diffRegions: [{ x: 1, y: 1, w: 7, h: 7, diffPixelCount: 5 }],
      rasterizationTolerance,
      resolvedAlignment: {
        alignment: {
          translation: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          confidence: 1,
          residual: 0,
        },
        alignedDesignPixels: designPixels,
        applied: false,
      },
    });
  };

  it("指定時は同一トークン証明のある領域を構造・色とも解消済みとして採点する", async () => {
    const result = await compare(makeGlyph(96), makeGlyph(96, 1), true);

    expect(result.regionScores[0].sameTokenRasterization).toMatchObject({
      classification: "same-token-rasterization",
    });
    expect(
      result.issues.some(
        (issue) =>
          issue.severity === "minor" && issue.evidence.signal === "same_token_rasterization",
      ),
    ).toBe(true);
    expect(result.issues.some((issue) => issue.severity === "critical")).toBe(false);
    expect(result.aggregateVerdict).toBe("pass");
  });

  describe("証明済み領域の内容物ずれ", () => {
    const size = 24;
    const strokes: readonly (readonly [number, number])[] = [
      ...Array.from({ length: 7 }, (_, i) => [9, 8 + i] as const),
      ...Array.from({ length: 5 }, (_, i) => [10 + i, 14] as const),
      [13, 9],
    ];
    const draw = (dx: number): Uint8ClampedArray => {
      const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
      for (const [x, y] of strokes) {
        const offset = (y * size + x + dx) * 4;
        pixels[offset] = 51;
        pixels[offset + 1] = 51;
        pixels[offset + 2] = 51;
      }
      return pixels;
    };
    const compareShift = async (dx: number) => {
      const { buildDiffReport } = await import("./diff-report-builder.js");
      const designPixels = draw(0);
      return buildDiffReport({
        designPixels,
        screenshotPixels: draw(dx),
        width: size,
        height: size,
        diffRegions: [{ x: 8, y: 7, w: 8 + dx, h: 9, diffPixelCount: 20 }],
        rasterizationTolerance: true,
        resolvedAlignment: {
          alignment: {
            translation: { x: 0, y: 0 },
            scale: { x: 1, y: 1 },
            rotation: 0,
            confidence: 1,
            residual: 0,
          },
          alignedDesignPixels: designPixels,
          applied: false,
        },
      });
    };
    const offsetIssues = (result: Awaited<ReturnType<typeof compareShift>>) =>
      result.issues.filter((issue) => issue.evidence.signal === "same_token_content_offset");

    it("合否は変えずにずれ量を position issue として返す", async () => {
      const result = await compareShift(2);

      expect(result.regionScores[0].sameTokenRasterization?.contentOffset?.dx).toBeCloseTo(2, 0);
      // ずれ量の証拠は丸めずに生値で残す。閾値 (1.5/3.5px) の判定に丸めが
      // 効かないため、サブピクセル推定の端数がそのまま出る。
      expect(offsetIssues(result)).toEqual([
        expect.objectContaining({
          kind: "position",
          severity: "minor",
          evidence: expect.objectContaining({ value: expect.closeTo(2, 1) }),
        }),
      ]);
      expect(result.aggregateVerdict).toBe("pass");
    });

    it("大きいずれは major で返す", async () => {
      const result = await compareShift(4);

      expect(offsetIssues(result).map((issue) => issue.severity)).toEqual(["major"]);
    });

    it("探索端に達したずれは下限として報告する", async () => {
      const result = await compareShift(4);

      const offset = result.regionScores[0].sameTokenRasterization?.contentOffset;
      expect(offset?.clippedX).toBe(true);
      expect(offsetIssues(result)).toEqual([
        expect.objectContaining({
          severity: "major",
          evidence: expect.objectContaining({
            actual: expect.stringContaining("≥"),
          }),
        }),
      ]);
    });

    it("周期コンテンツの曖昧なエイリアスは issue を出さない", async () => {
      const periodicSize = 30;
      const bars = (dx: number): Uint8ClampedArray => {
        const pixels = new Uint8ClampedArray(periodicSize * periodicSize * 4).fill(255);
        for (let b = 0; b < 5; b++) {
          for (let y = 8; y < 22; y++) {
            const x = 4 + b * 5 + dx;
            if (x < 0 || x >= periodicSize) continue;
            const offset = (y * periodicSize + x) * 4;
            pixels[offset] = 51;
            pixels[offset + 1] = 51;
            pixels[offset + 2] = 51;
          }
        }
        return pixels;
      };
      const designPixels = bars(0);
      const { buildDiffReport } = await import("./diff-report-builder.js");
      const result = buildDiffReport({
        designPixels,
        screenshotPixels: bars(7),
        width: periodicSize,
        height: periodicSize,
        diffRegions: [{ x: 3, y: 7, w: 27, h: 16, diffPixelCount: 30 }],
        rasterizationTolerance: true,
        resolvedAlignment: {
          alignment: {
            translation: { x: 0, y: 0 },
            scale: { x: 1, y: 1 },
            rotation: 0,
            confidence: 1,
            residual: 0,
          },
          alignedDesignPixels: designPixels,
          applied: false,
        },
      });

      expect(result.regionScores[0].sameTokenRasterization?.contentOffset?.ambiguous).toBe(true);
      expect(offsetIssues(result)).toEqual([]);
    });

    // 確度閾値 (0.8) の直下と直上で発火が変わることの検証。L 字 + 点を 2px
    // 動かし、相関を削ぐ小さな帯を両画像の別位置に足す。帯の濃さで生ピークを
    // 0.798 / 0.801 に調整してある (濃いほど相関を削ぐ)。
    const compareShiftWithDimBand = async (bandGray: number) => {
      const { buildDiffReport } = await import("./diff-report-builder.js");
      const withBand = (shift: number, bandY: number): Uint8ClampedArray => {
        const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
        for (const [x, y] of strokes) {
          const offset = (y * size + x + shift) * 4;
          pixels[offset] = 51;
          pixels[offset + 1] = 51;
          pixels[offset + 2] = 51;
        }
        for (let i = 0; i < 3; i++) {
          const offset = (bandY * size + 17 + i) * 4;
          pixels[offset] = bandGray;
          pixels[offset + 1] = bandGray;
          pixels[offset + 2] = bandGray;
        }
        return pixels;
      };
      const designPixels = withBand(0, 5);
      return buildDiffReport({
        designPixels,
        screenshotPixels: withBand(2, 16),
        width: size,
        height: size,
        diffRegions: [{ x: 8, y: 7, w: 10, h: 9, diffPixelCount: 20 }],
        rasterizationTolerance: true,
        resolvedAlignment: {
          alignment: {
            translation: { x: 0, y: 0 },
            scale: { x: 1, y: 1 },
            rotation: 0,
            confidence: 1,
            residual: 0,
          },
          alignedDesignPixels: designPixels,
          applied: false,
        },
      });
    };

    it("確度閾値未満の生ピークは position issue を出さない", async () => {
      const result = await compareShiftWithDimBand(6);
      const offset = result.regionScores[0].sameTokenRasterization?.contentOffset;
      // 同一トークン証明が通った窓で測っていることを先に固定する。
      expect(offset).toBeDefined();
      expect(offset?.peak).toBeLessThan(0.8);
      expect(offset?.peak).toBeGreaterThan(0.795);
      // 旧実装は生ピークを 2 桁に丸めて 0.8 として報告し、この issue を出していた。
      expect(offsetIssues(result)).toEqual([]);
    });

    it("確度閾値以上の生ピークは position issue を出す", async () => {
      const result = await compareShiftWithDimBand(8);
      const offset = result.regionScores[0].sameTokenRasterization?.contentOffset;
      expect(offset).toBeDefined();
      expect(offset?.peak).toBeGreaterThan(0.8);
      expect(offsetIssues(result).map((issue) => issue.severity)).toEqual(["minor"]);
    });
  });

  it("未指定では分類証拠を残したまま従来どおり FAIL を維持する", async () => {
    const result = await compare(makeGlyph(96), makeGlyph(96, 1));

    expect(result.regionScores[0].sameTokenRasterization).toBeDefined();
    expect(result.aggregateVerdict).not.toBe("pass");
  });

  it("色相の違う差分は許容指定があっても critical を維持する", async () => {
    const design = makeGlyph(96);
    const screenshot = makeGlyph(96, 1);
    const colored = (6 * width + 2) * 4;
    screenshot[colored] = 200;
    screenshot[colored + 1] = 40;
    screenshot[colored + 2] = 40;

    const result = await compare(design, screenshot, true);

    expect(result.regionScores[0].sameTokenRasterization).toBeUndefined();
    expect(result.aggregateVerdict).not.toBe("pass");
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

describe("diff-cluster 行の差分密度シグナル (Issue #58)", () => {
  const FRAME_SIZE = 300;

  it("diffPixelCount を持つクラスタ行に bbox 面積に占める差分画素の割合を付けること", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const designPixels = await createSolidRgba(FRAME_SIZE, FRAME_SIZE, WHITE_RGB);
    const screenshotPixels = Uint8ClampedArray.from(designPixels);

    // 100x80 の 1px 枠線だけが変化する疎なクラスタ (外周 356px) と、
    // 同程度の差分画素数を持つ密な塊 (20x18 = 360px) の対。
    const sparse = { x: 50, y: 50, w: 100, h: 80, diffPixelCount: 356 };
    const dense = { x: 200, y: 200, w: 20, h: 18, diffPixelCount: 360 };
    const report = buildDiffReport({
      designPixels,
      screenshotPixels,
      width: FRAME_SIZE,
      height: FRAME_SIZE,
      diffRegions: [sparse, dense],
    });

    const sparseScore = report.regionScores.find(
      (score) => score.regionId === `diff-cluster-${sparse.x}-${sparse.y}-${sparse.w}-${sparse.h}`,
    );
    const denseScore = report.regionScores.find(
      (score) => score.regionId === `diff-cluster-${dense.x}-${dense.y}-${dense.w}-${dense.h}`,
    );
    // 実測では疎なクラスタの color が密な対照の約 1/23 に薄まった。採点値は
    // 変えず、薄まり具合を読む側が判断できるよう密度だけを付ける。
    expect(sparseScore?.diffPixelDensity).toBeCloseTo(356 / (100 * 80), 10);
    expect(denseScore?.diffPixelDensity).toBe(1);
  });

  it("diffPixelCount を持たない行では「不明」と密度 0 を混ぜないこと", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const designPixels = await createSolidRgba(FRAME_SIZE, FRAME_SIZE, WHITE_RGB);
    const screenshotPixels = Uint8ClampedArray.from(designPixels);

    // 既存の呼び出し (このファイル内の他のテスト同様) は diffPixelCount を
    // 持たない bbox をそのまま渡せる。その場合は 0 ではなく未設定であること。
    const report = buildDiffReport({
      designPixels,
      screenshotPixels,
      width: FRAME_SIZE,
      height: FRAME_SIZE,
      diffRegions: [{ x: 10, y: 10, w: 30, h: 30 }],
    });

    const cluster = report.regionScores.find((score) => score.regionId.startsWith("diff-cluster-"));
    const root = report.regionScores.find((score) => score.regionId === "whole-frame");
    expect(cluster?.diffPixelDensity).toBeUndefined();
    expect(root?.diffPixelDensity).toBeUndefined();
  });

  it("diffPixelCount が bbox 面積を超える入力では密度を 1 に飽和させること", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const designPixels = await createSolidRgba(FRAME_SIZE, FRAME_SIZE, WHITE_RGB);
    const screenshotPixels = Uint8ClampedArray.from(designPixels);

    // clipToAlignedCanvas は diffPixelCount を減らさずに bbox だけを縮めるため、
    // clip 済みのクラスタは count > area になり得る。スキーマの 0..1 を守る。
    const report = buildDiffReport({
      designPixels,
      screenshotPixels,
      width: FRAME_SIZE,
      height: FRAME_SIZE,
      diffRegions: [{ x: 10, y: 10, w: 10, h: 10, diffPixelCount: 500 }],
    });

    const cluster = report.regionScores.find((score) => score.regionId.startsWith("diff-cluster-"));
    expect(cluster?.diffPixelDensity).toBe(1);
  });
});

describe("細線の局所変位 (designdiff#243)", () => {
  const SIZE = 120;
  const BORDER = { r: 0xcc, g: 0xeb, b: 0xd8 };
  const CARET = { r: 0x19, g: 0xc4, b: 0x7a };

  const paint = (
    pixels: Uint8ClampedArray,
    x: number,
    y: number,
    w: number,
    h: number,
    rgb: { r: number; g: number; b: number },
  ): void => {
    for (let row = y; row < y + h; row++) {
      for (let col = x; col < x + w; col++) {
        pixels.set([rgb.r, rgb.g, rgb.b, 255], (row * SIZE + col) * 4);
      }
    }
  };

  // 1px の区切り線が 2px 下へずれ、ずれた位置では両側ともベタ面の別色になる。
  const shiftedDivider = async () => {
    const designPixels = await createSolidRgba(SIZE, SIZE, WHITE_RGB);
    const screenshotPixels = Uint8ClampedArray.from(designPixels);
    paint(designPixels, 10, 50, 100, 1, BORDER);
    paint(screenshotPixels, 10, 52, 100, 1, BORDER);
    return { designPixels, screenshotPixels, cluster: { x: 10, y: 50, w: 100, h: 1 } };
  };

  it("rasterization_tolerance 下ではずれた線を critical にせず位置の minor issue で残す", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const { designPixels, screenshotPixels } = await shiftedDivider();
    // 実パイプラインでは pixelmatch がずれた線の両側 (y50 の消失側と y52 の
    // 出現側) を差分として拾い、両方がクラスタと diffMask に入る。片側だけ
    // のクラスタで diffMask 無しにすると、もう片側の線が残差に見えてしまい、
    // 細かい計測窓がそれを拾う (実際には起きない入力なので fixture を直す)。
    const diffMask = new Uint8Array(SIZE * SIZE);
    diffMask.fill(1, 50 * SIZE + 10, 50 * SIZE + 110);
    diffMask.fill(1, 52 * SIZE + 10, 52 * SIZE + 110);

    const report = buildDiffReport({
      designPixels,
      screenshotPixels,
      width: SIZE,
      height: SIZE,
      diffRegions: [
        { x: 10, y: 50, w: 100, h: 1, diffPixelCount: 100 },
        { x: 10, y: 52, w: 100, h: 1, diffPixelCount: 100 },
      ],
      diffMask,
      rasterizationTolerance: true,
    });

    expect(report.regionScores[0].flatColorMismatch).toBeDefined();
    expect(report.regionScores[0].localDisplacement).toMatchObject({ dx: 0, dy: 2 });
    expect(report.regionScores[0].localDisplacement?.alignedTokenMatch).toBe(true);
    expect(report.issues.some((issue) => issue.severity === "critical")).toBe(false);
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "position",
          severity: "minor",
          evidence: expect.objectContaining({
            signal: "local_displacement",
            value: 2,
            actual: expect.stringContaining("(0, 2)px"),
          }),
        }),
      ]),
    );
  });

  it("ずれた線の塗りがトークン1段変わっている場合は色の critical を残す", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const designPixels = await createSolidRgba(SIZE, SIZE, WHITE_RGB);
    const screenshotPixels = Uint8ClampedArray.from(designPixels);
    // #CCEBD8 → #CEEBD8 は ΔE2000 が 2 を下回るトークン1段のずれ。
    // 変位は事実でも残差が一様な段差なら、色の救済根拠にはできない。
    paint(designPixels, 10, 50, 100, 1, BORDER);
    paint(screenshotPixels, 10, 52, 100, 1, { r: 0xce, g: 0xeb, b: 0xd8 });
    const cluster = { x: 10, y: 50, w: 100, h: 1 };

    const report = buildDiffReport({
      designPixels,
      screenshotPixels,
      width: SIZE,
      height: SIZE,
      diffRegions: [cluster],
      rasterizationTolerance: true,
    });

    expect(report.regionScores[0].localDisplacement).toMatchObject({
      dx: 0,
      dy: 2,
      alignedTokenMatch: false,
    });
    expect(
      report.issues.some(
        (issue) => issue.severity === "critical" && issue.evidence.signal === "flat_region_color",
      ),
    ).toBe(true);
  });

  // セクション行の救済証拠に使うノードID。座標由来の安定した定数にする。
  const SECTION_RELIEF_NODE_IDS = {
    root: "test-section-root",
    section: "test-section",
    tail: "test-section-tail",
  };
  const DARK_RGB = { r: 0x33, g: 0x33, b: 0x33 };

  const sectionReliefFrame = (sectionHeight = 20): FigmaNode => {
    const children: FigmaNode[] = [
      {
        id: "test-section-header",
        name: "test-section-header",
        type: "FRAME",
        absoluteBoundingBox: { x: 0, y: 0, width: SIZE, height: 40 },
        absoluteRenderBounds: null,
        fills: [],
        strokes: [],
        effects: [],
        children: [],
      },
      {
        id: SECTION_RELIEF_NODE_IDS.section,
        name: SECTION_RELIEF_NODE_IDS.section,
        type: "FRAME",
        absoluteBoundingBox: { x: 0, y: 40, width: 200, height: sectionHeight },
        absoluteRenderBounds: null,
        fills: [],
        strokes: [],
        effects: [],
        children: [],
      },
      {
        id: SECTION_RELIEF_NODE_IDS.tail,
        name: SECTION_RELIEF_NODE_IDS.tail,
        type: "FRAME",
        absoluteBoundingBox: {
          x: 0,
          y: 40 + sectionHeight,
          width: 200,
          height: SIZE - 40 - sectionHeight,
        },
        absoluteRenderBounds: null,
        fills: [],
        strokes: [],
        effects: [],
        children: [],
      },
    ];
    return {
      id: SECTION_RELIEF_NODE_IDS.root,
      name: SECTION_RELIEF_NODE_IDS.root,
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: SIZE, height: SIZE },
      absoluteRenderBounds: null,
      fills: [],
      strokes: [],
      effects: [],
      children,
    };
  };

  it("セクション内の差分クラスタ全てが証明済みなら critical にしない", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const frame = sectionReliefFrame();
    const designPixels = await createSolidRgba(SIZE, SIZE, WHITE_RGB);
    const screenshotPixels = Uint8ClampedArray.from(designPixels);
    // 濃い 1px 線が 2px 下へずれる。セクション行の平均スコアは閾値を超えるが、
    // クラスタ単位では変位 + 整列後トークン一致の証明が付く形状にする。
    paint(designPixels, 10, 50, 100, 1, DARK_RGB);
    paint(screenshotPixels, 10, 52, 100, 1, DARK_RGB);
    // pixelmatch は両側の行 (y=50, y=52) を差分と検出し、clustering は行ごとに
    // 別の連結成分として 2 クラスタを作るため、採点クラスタは 2 件になる。
    const clusters = [
      { x: 10, y: 50, w: 100, h: 1 },
      { x: 10, y: 52, w: 100, h: 1 },
    ];

    const report = buildDiffReport({
      designPixels,
      screenshotPixels,
      width: SIZE,
      height: SIZE,
      figmaRootNode: frame,
      diffRegions: clusters,
      rasterizationTolerance: true,
    });

    const section = report.regionScores.find(
      (score) => score.regionId === SECTION_RELIEF_NODE_IDS.section,
    );
    // セクションの平均 ΔE は critical 閾値を超えるが、証明済みクラスタの網羅で救済される。
    expect(section?.color).toBeGreaterThanOrEqual(2);
    expect(section?.diffClusterCoverage).toEqual({
      clusterCount: 2,
      explainedCount: 2,
      residualColor: 0,
      unexplainedPerceptibleDiff: false,
    });
    expect(report.issues.some((issue) => issue.severity === "critical")).toBe(false);
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "minor",
          evidence: expect.objectContaining({ signal: "diff_cluster_relief" }),
        }),
      ]),
    );
  });

  it("セクション内に証明できないクラスタが残れば critical を残す", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const frame = sectionReliefFrame();
    const designPixels = await createSolidRgba(SIZE, SIZE, WHITE_RGB);
    const screenshotPixels = Uint8ClampedArray.from(designPixels);
    paint(designPixels, 10, 50, 100, 1, DARK_RGB);
    // 変位に加えて色も大きく変え、整列後トークン一致の証明が付かないようにする。
    paint(screenshotPixels, 10, 52, 100, 1, { r: 0x00, g: 0x66, b: 0xcc });
    // 上の救済ケースと同じく、両側の行が別クラスタになる現実の形にする。
    const clusters = [
      { x: 10, y: 50, w: 100, h: 1 },
      { x: 10, y: 52, w: 100, h: 1 },
    ];

    const report = buildDiffReport({
      designPixels,
      screenshotPixels,
      width: SIZE,
      height: SIZE,
      figmaRootNode: frame,
      diffRegions: clusters,
      rasterizationTolerance: true,
    });

    const section = report.regionScores.find(
      (score) => score.regionId === SECTION_RELIEF_NODE_IDS.section,
    );
    expect(section?.diffClusterCoverage).toMatchObject({
      clusterCount: 2,
      explainedCount: 0,
    });
    expect(
      report.issues.some(
        (issue) =>
          issue.regionId === SECTION_RELIEF_NODE_IDS.section && issue.severity === "critical",
      ),
    ).toBe(true);
  });

  it("セクション内にクラスタ外の知覚可能な色差があれば救済しない", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const frame = sectionReliefFrame(55);
    const designPixels = await createSolidRgba(SIZE, SIZE, WHITE_RGB);
    const screenshotPixels = Uint8ClampedArray.from(designPixels);
    // ずれた線の周辺 (変位証明が読む窓) は白のまま残し、クラスタの証明は成立させる。
    for (let y = 40; y < 95; y += 1) {
      if (y >= 44 && y < 59) continue;
      paint(screenshotPixels, 0, y, SIZE, 1, { r: 0xf0, g: 0xf0, b: 0xf0 });
    }
    paint(designPixels, 10, 50, 100, 1, DARK_RGB);
    paint(screenshotPixels, 10, 52, 100, 1, DARK_RGB);

    const report = buildDiffReport({
      designPixels,
      screenshotPixels,
      width: SIZE,
      height: SIZE,
      figmaRootNode: frame,
      diffRegions: [
        { x: 10, y: 50, w: 100, h: 1 },
        { x: 10, y: 52, w: 100, h: 1 },
      ],
      rasterizationTolerance: true,
    });

    const section = report.regionScores.find(
      (score) => score.regionId === SECTION_RELIEF_NODE_IDS.section,
    );
    // クラスタは全て証明済みでも、クラスタ外の平均 ΔE (#F0F0F0 と白) が閾値を超える。
    expect(section?.diffClusterCoverage).toMatchObject({
      clusterCount: 2,
      explainedCount: 2,
      unexplainedPerceptibleDiff: true,
    });
    expect(section?.diffClusterCoverage?.residualColor).toBeGreaterThanOrEqual(2);
    expect(
      report.issues.some(
        (issue) =>
          issue.regionId === SECTION_RELIEF_NODE_IDS.section && issue.severity === "critical",
      ),
    ).toBe(true);
  });

  it("200件の採点上限から外れたクラスタがセクション内にあれば救済しない", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const frame = sectionReliefFrame();
    const designPixels = await createSolidRgba(SIZE, SIZE, WHITE_RGB);
    const screenshotPixels = Uint8ClampedArray.from(designPixels);
    paint(designPixels, 10, 50, 100, 1, DARK_RGB);
    paint(screenshotPixels, 10, 52, 100, 1, DARK_RGB);
    const explainedClusters = [
      { x: 10, y: 50, w: 100, h: 1, diffPixelCount: 200 },
      ...Array.from({ length: 199 }, (_, index) => ({
        x: index % SIZE,
        y: 40 + Math.floor(index / SIZE),
        w: 1,
        h: 1,
        diffPixelCount: 100,
      })),
    ];
    // 99pxの実差分があるクラスタを、200件のより大きなクラスタの次に置いて上限から外す。
    // 未採点分を網羅判定から落とすとセクションが誤って救済される。
    paint(screenshotPixels, 45, 45, 10, 10, DARK_RGB);
    const unscoredCluster = { x: 45, y: 45, w: 10, h: 10, diffPixelCount: 99 };
    const unscoredLastPixel = ((45 + 9) * SIZE + 45 + 9) * 4;
    screenshotPixels[unscoredLastPixel] = WHITE_RGB.r;
    screenshotPixels[unscoredLastPixel + 1] = WHITE_RGB.g;
    screenshotPixels[unscoredLastPixel + 2] = WHITE_RGB.b;

    const report = buildDiffReport({
      designPixels,
      screenshotPixels,
      width: SIZE,
      height: SIZE,
      figmaRootNode: frame,
      diffRegions: [...explainedClusters, unscoredCluster],
      rasterizationTolerance: true,
    });

    const section = report.regionScores.find(
      (score) => score.regionId === SECTION_RELIEF_NODE_IDS.section,
    );
    expect(section?.bbox).toEqual({ x: 0, y: 40, w: 120, h: 20 });
    expect(section?.diffClusterCoverage).toEqual({
      clusterCount: 201,
      explainedCount: 200,
    });
    expect(
      report.issues.some(
        (issue) =>
          issue.regionId === SECTION_RELIEF_NODE_IDS.section && issue.severity === "critical",
      ),
    ).toBe(true);
  });

  // 救済を壊さないレンダラ差の典型: 説明済みクラスタの外に、知覚差 (ΔE > 2) は
  // あるが面としては閾値に届かない散発画素 (AA 縁・影のぼかし) が残る形。
  // 変位証明はクラスタ周辺の窓を読むので、ずれた線 (y=50/52) の近くには置かない。
  const scatterSubThresholdNoise = (pixels: Uint8ClampedArray, top: number, bottom: number) => {
    for (let y = top; y < bottom; y += 4) {
      if (y >= 44 && y < 59) continue;
      for (let x = 2; x < SIZE; x += 6) {
        paint(pixels, x, y, 1, 1, { r: 0xe8, g: 0xe8, b: 0xe8 });
      }
    }
  };

  it("クラスタ外の散発的な知覚差だけなら救済し、ノード木の無い比較と同じ合否にする", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const frame = sectionReliefFrame();
    const designPixels = await createSolidRgba(SIZE, SIZE, WHITE_RGB);
    const screenshotPixels = Uint8ClampedArray.from(designPixels);
    paint(designPixels, 10, 50, 100, 1, DARK_RGB);
    paint(screenshotPixels, 10, 52, 100, 1, DARK_RGB);
    scatterSubThresholdNoise(screenshotPixels, 41, 60);
    // clustering の連結画素数しきい値 (10px) 未満で diffRegions に載らない 3x3 の
    // 断片。ノード木の無い比較でもクラスタにならず合否に届かないので、セクション
    // 経路だけで失格にすると同じ画素の合否が経路で割れる。
    paint(screenshotPixels, 60, 44, 3, 3, { r: 0xff, g: 0x00, b: 0x00 });
    const options = {
      designPixels,
      screenshotPixels,
      width: SIZE,
      height: SIZE,
      diffRegions: [
        { x: 10, y: 50, w: 100, h: 1, diffPixelCount: 100 },
        { x: 10, y: 52, w: 100, h: 1, diffPixelCount: 100 },
      ],
      rasterizationTolerance: true,
    };

    const report = buildDiffReport({ ...options, figmaRootNode: frame });
    const withoutTree = buildDiffReport(options);

    const section = report.regionScores.find(
      (score) => score.regionId === SECTION_RELIEF_NODE_IDS.section,
    );
    expect(section?.diffClusterCoverage).toMatchObject({
      clusterCount: 2,
      explainedCount: 2,
      unexplainedPerceptibleDiff: false,
    });
    expect(section?.diffClusterCoverage?.residualColor).toBeGreaterThan(0);
    expect(section?.diffClusterCoverage?.residualColor).toBeLessThan(2);
    expect(report.issues.some((issue) => issue.severity === "critical")).toBe(false);
    // 相互比較だけだと両経路が同じ誤判定に落ちても気付けないため、
    // それぞれ独立に期待値を固定する。
    expect(report.aggregateVerdict).toBe("pass");
    expect(withoutTree.aggregateVerdict).toBe("pass");
  });

  it("セクション内でクラスタ単体が critical なら、広いセクションの平均に薄めず失格にする", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    // 画面全体が 1 セクションになる木。小さな実差分はセクション平均では閾値に届かない。
    const frame: FigmaNode = {
      ...sectionReliefFrame(),
      children: [
        {
          id: SECTION_RELIEF_NODE_IDS.section,
          name: SECTION_RELIEF_NODE_IDS.section,
          type: "FRAME",
          absoluteBoundingBox: { x: 0, y: 0, width: SIZE, height: SIZE },
          absoluteRenderBounds: null,
          fills: [],
          strokes: [],
          effects: [],
          children: [],
        },
      ],
    };
    const designPixels = await createSolidRgba(SIZE, SIZE, WHITE_RGB);
    const screenshotPixels = Uint8ClampedArray.from(designPixels);
    // デザインにだけある 7x7 の濃い記号 (省略記号の欠落など)。
    paint(designPixels, 50, 50, 7, 7, DARK_RGB);
    const options = {
      designPixels,
      screenshotPixels,
      width: SIZE,
      height: SIZE,
      diffRegions: [{ x: 50, y: 50, w: 7, h: 7, diffPixelCount: 49 }],
      rasterizationTolerance: true,
    };

    const report = buildDiffReport({ ...options, figmaRootNode: frame });
    const withoutTree = buildDiffReport(options);

    const section = report.regionScores.find(
      (score) => score.regionId === SECTION_RELIEF_NODE_IDS.section,
    );
    expect(section?.color).toBeLessThan(2);
    expect(section?.diffClusterCoverage).toMatchObject({ clusterCount: 1, explainedCount: 0 });
    expect(
      report.issues.some(
        (issue) => issue.regionId === "diff-cluster-50-50-7-7" && issue.severity === "critical",
      ),
    ).toBe(true);
    expect(report.aggregateVerdict).toBe("fail");
    expect(withoutTree.aggregateVerdict).toBe("fail");
  });

  it("ノード木の無い比較でも、クラスタ外に広がる色ずれは失格にする", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const designPixels = await createSolidRgba(SIZE, SIZE, WHITE_RGB);
    // pixelmatch の閾値に届かない背景色ずれ (#F0F0F0) が画面全体にあり、
    // 証明済みの変位クラスタだけが差分として検出された形。
    const screenshotPixels = await createSolidRgba(SIZE, SIZE, { r: 0xf0, g: 0xf0, b: 0xf0 });
    paint(designPixels, 10, 50, 100, 1, DARK_RGB);
    paint(screenshotPixels, 10, 52, 100, 1, DARK_RGB);

    const report = buildDiffReport({
      designPixels,
      screenshotPixels,
      width: SIZE,
      height: SIZE,
      diffRegions: [
        { x: 10, y: 50, w: 100, h: 1, diffPixelCount: 100 },
        { x: 10, y: 52, w: 100, h: 1, diffPixelCount: 100 },
      ],
      rasterizationTolerance: true,
    });

    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          regionId: "frame-residual",
          severity: "critical",
          evidence: expect.objectContaining({ signal: "residual_color_drift" }),
        }),
      ]),
    );
    expect(report.aggregateVerdict).toBe("fail");
  });

  it("ノード木の無い比較で、クラスタ外の散発的な知覚差だけなら失格にしない", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const designPixels = await createSolidRgba(SIZE, SIZE, WHITE_RGB);
    const screenshotPixels = Uint8ClampedArray.from(designPixels);
    paint(designPixels, 10, 50, 100, 1, DARK_RGB);
    paint(screenshotPixels, 10, 52, 100, 1, DARK_RGB);
    scatterSubThresholdNoise(screenshotPixels, 0, SIZE);

    const report = buildDiffReport({
      designPixels,
      screenshotPixels,
      width: SIZE,
      height: SIZE,
      diffRegions: [
        { x: 10, y: 50, w: 100, h: 1, diffPixelCount: 100 },
        { x: 10, y: 52, w: 100, h: 1, diffPixelCount: 100 },
      ],
      rasterizationTolerance: true,
    });

    expect(report.issues.some((issue) => issue.evidence.signal === "residual_color_drift")).toBe(
      false,
    );
    expect(report.issues.some((issue) => issue.severity === "critical")).toBe(false);
  });

  it("既定 (rasterization_tolerance 未指定) では従来どおり critical で失格にする", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const { designPixels, screenshotPixels, cluster } = await shiftedDivider();

    const report = buildDiffReport({
      designPixels,
      screenshotPixels,
      width: SIZE,
      height: SIZE,
      diffRegions: [cluster],
    });

    expect(report.regionScores[0].localDisplacement).toBeDefined();
    expect(
      report.issues.some(
        (issue) => issue.severity === "critical" && issue.evidence.signal === "flat_region_color",
      ),
    ).toBe(true);
  });

  it("変位の上限より遠くにしか無い細い要素は rasterization_tolerance 下でも critical を維持する", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const designPixels = await createSolidRgba(SIZE, SIZE, WHITE_RGB);
    const screenshotPixels = Uint8ClampedArray.from(designPixels);
    // 同一トークン証明の窓 (周囲の余白込み) にも入らない距離へ置き、
    // 変位証明だけが判定に関わる状態にする。
    paint(designPixels, 100, 40, 2, 20, CARET);
    paint(screenshotPixels, 60, 40, 2, 20, CARET);
    const cluster = { x: 60, y: 40, w: 2, h: 20 };

    const report = buildDiffReport({
      designPixels,
      screenshotPixels,
      width: SIZE,
      height: SIZE,
      diffRegions: [cluster],
      rasterizationTolerance: true,
    });

    expect(report.regionScores[0].localDisplacement).toBeUndefined();
    expect(report.issues.some((issue) => issue.severity === "critical")).toBe(true);
  });

  it("セクションが覆わない背景に色ずれがあれば、ノード木の有無に関わらず失格にする", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    // 左 1/3 (幅 40) だけを子が覆う木。残りはどのセクション行にも乗らない。
    // セクションの救済が効いても、その外側の色ずれはフレーム残差でだけ拾える。
    const partialWidthChild = (id: string, y: number, height: number): FigmaNode => ({
      id,
      name: id,
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y, width: 40, height },
      absoluteRenderBounds: null,
      fills: [],
      strokes: [],
      effects: [],
      children: [],
    });
    const frame: FigmaNode = {
      ...sectionReliefFrame(),
      children: [
        partialWidthChild("test-partial-header", 0, 40),
        partialWidthChild(SECTION_RELIEF_NODE_IDS.section, 40, 20),
      ],
    };
    const designPixels = await createSolidRgba(SIZE, SIZE, WHITE_RGB);
    // セクション外の右 2/3 に広い背景色ずれ (#E0E0E0) があり、証明済みの
    // 変位クラスタ (1px 線の 2px ずれ) だけが差分として検出された形。
    const screenshotPixels = await createSolidRgba(SIZE, SIZE, WHITE_RGB);
    paint(screenshotPixels, 40, 0, 80, SIZE, { r: 0xe0, g: 0xe0, b: 0xe0 });
    paint(designPixels, 10, 50, 30, 1, DARK_RGB);
    paint(screenshotPixels, 10, 52, 30, 1, DARK_RGB);
    const options = {
      designPixels,
      screenshotPixels,
      width: SIZE,
      height: SIZE,
      diffRegions: [
        { x: 10, y: 50, w: 30, h: 1, diffPixelCount: 30 },
        { x: 10, y: 52, w: 30, h: 1, diffPixelCount: 30 },
      ],
      rasterizationTolerance: true,
    };

    const report = buildDiffReport({ ...options, figmaRootNode: frame });
    const withoutTree = buildDiffReport(options);

    // 変位クラスタはセクション内で説明済み (救済自体は効く) が、右 2/3 の
    // 色ずれはセクションの外なのでフレーム残差が critical になる。
    const section = report.regionScores.find(
      (score) => score.regionId === SECTION_RELIEF_NODE_IDS.section,
    );
    expect(section?.diffClusterCoverage).toMatchObject({
      clusterCount: 2,
      explainedCount: 2,
      unexplainedPerceptibleDiff: false,
    });
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          regionId: "frame-residual",
          severity: "critical",
          evidence: expect.objectContaining({ signal: "residual_color_drift" }),
        }),
      ]),
    );
    // 相互比較だけにすると両経路が同じ誤判定へ落ちても気付けないため、
    // それぞれ独立に期待値を固定する。
    expect(report.aggregateVerdict).toBe("fail");
    expect(withoutTree.aggregateVerdict).toBe("fail");
  });

  it("帯状に集中した背景色ずれは、フレーム平均で閾値を割っても帯の残差で両経路とも失格にする", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    // 実測 9949:23513 と同じ形。ルート背景のグラデーション (下端はミント
    // #EFF8F2) が実装では無彩色 (#F7F7F7) になっており、ずれ (ΔE≈5) は
    // 画面下 1/8 の帯にだけ集中する。フレーム全体の1平均では 2 未満に薄まり、
    // ノード木の無い経路はこのずれを合否に出せていなかった。
    const partialWidthChild = (id: string, y: number, height: number): FigmaNode => ({
      id,
      name: id,
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y, width: 40, height },
      absoluteRenderBounds: null,
      fills: [],
      strokes: [],
      effects: [],
      children: [],
    });
    const frame: FigmaNode = {
      ...sectionReliefFrame(),
      children: [
        partialWidthChild("test-partial-header", 0, 40),
        partialWidthChild(SECTION_RELIEF_NODE_IDS.section, 40, 20),
      ],
    };
    const designPixels = await createSolidRgba(SIZE, SIZE, WHITE_RGB);
    const screenshotPixels = await createSolidRgba(SIZE, SIZE, WHITE_RGB);
    // 帯の分割数 (8) に合わせ、画面下から 1 帯分 (y105-120) だけ色を変える。
    paint(designPixels, 0, 105, SIZE, 15, { r: 0xef, g: 0xf8, b: 0xf2 });
    paint(screenshotPixels, 0, 105, SIZE, 15, { r: 0xf7, g: 0xf7, b: 0xf7 });
    // 証明済みの変位クラスタ。残差計算が走る条件を作るためだけに置く。
    paint(designPixels, 10, 50, 30, 1, DARK_RGB);
    paint(screenshotPixels, 10, 52, 30, 1, DARK_RGB);
    const options = {
      designPixels,
      screenshotPixels,
      width: SIZE,
      height: SIZE,
      diffRegions: [
        { x: 10, y: 50, w: 30, h: 1, diffPixelCount: 30 },
        { x: 10, y: 52, w: 30, h: 1, diffPixelCount: 30 },
      ],
      rasterizationTolerance: true,
    };

    const report = buildDiffReport({ ...options, figmaRootNode: frame });
    const withoutTree = buildDiffReport(options);

    // 相互比較ではなく、各経路へ独立に期待値を固定する。
    for (const target of [report, withoutTree]) {
      expect(target.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            regionId: "frame-residual",
            severity: "critical",
            evidence: expect.objectContaining({ signal: "residual_color_drift" }),
          }),
        ]),
      );
      expect(target.aggregateVerdict).toBe("fail");
    }
    // issue はずれが閾値を超えた帯を指す (フレーム全体の bbox ではない)。
    const residualIssue = report.issues.find(
      (issue) => issue.evidence.signal === "residual_color_drift",
    );
    expect(residualIssue?.bbox?.y).toBeGreaterThanOrEqual(100);
  });

  it("疎なクラスタの内側の色ずれは、diffMask 指定時は残差に数えてクラスタ網羅救済を止める", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    // 40x20 のベタ塗りカードが 2px 下へずれ、内側の 24x8 だけ濃さが違う形。
    // クラスタ bbox はカード全体 (40x22) を覆うが、実際の差分画素はずれた
    // 上下の縁だけ。bbox ごと残差から除くと内側の色ずれを一度も測らない。
    const cardChild = (id: string, y: number, h: number): FigmaNode => ({
      id,
      name: id,
      type: "FRAME",
      absoluteBoundingBox: {
        x: id === "test-card" ? 40 : 0,
        y,
        width: id === "test-card" ? 40 : SIZE,
        height: h,
      },
      absoluteRenderBounds: null,
      fills: [],
      strokes: [],
      effects: [],
      children: [],
    });
    const frame: FigmaNode = {
      ...sectionReliefFrame(),
      children: [cardChild("test-card", 50, 22), cardChild("test-card-tail", 72, 48)],
    };
    const designPixels = await createSolidRgba(SIZE, SIZE, WHITE_RGB);
    paint(designPixels, 40, 50, 40, 20, DARK_RGB);
    const screenshotPixels = await createSolidRgba(SIZE, SIZE, WHITE_RGB);
    paint(screenshotPixels, 40, 52, 40, 20, DARK_RGB);
    paint(screenshotPixels, 48, 58, 24, 8, { r: 0x55, g: 0x55, b: 0x55 });
    const diffRegions = [{ x: 40, y: 50, w: 40, h: 22, diffPixelCount: 160 }];
    // pixelmatch が差分と判定するのはずれた縁 (上下 2px ずつ) だけで、
    // 内側の色ずれは差分画素に含まれない形。
    const diffMask = new Uint8Array(SIZE * SIZE);
    for (const y of [50, 51, 70, 71]) {
      diffMask.fill(1, y * SIZE + 40, y * SIZE + 80);
    }
    const base = {
      designPixels,
      screenshotPixels,
      width: SIZE,
      height: SIZE,
      figmaRootNode: frame,
      diffRegions,
      rasterizationTolerance: true,
    };

    const withMask = buildDiffReport({ ...base, diffMask });
    const withoutMask = buildDiffReport(base);

    const sectionWith = withMask.regionScores.find((score) => score.regionId === "test-card");
    const sectionWithout = withoutMask.regionScores.find((score) => score.regionId === "test-card");
    // どちらもクラスタ自体は説明済み。残差の測り方だけが違う。bbox ごと除く
    // 従来方式では内側の色ずれが残差 0 になり、実差分画素だけを除くと
    // 内側の色ずれが残差に出て閾値を超える。
    expect(sectionWith?.diffClusterCoverage).toMatchObject({
      clusterCount: 1,
      explainedCount: 1,
      unexplainedPerceptibleDiff: true,
    });
    expect(sectionWith?.diffClusterCoverage?.residualColor).toBeGreaterThanOrEqual(2);
    expect(sectionWithout?.diffClusterCoverage).toMatchObject({
      clusterCount: 1,
      explainedCount: 1,
      unexplainedPerceptibleDiff: false,
      residualColor: 0,
    });
    // クラスタ網羅による救済 (diff_cluster_relief) は残差がある側だけ止まる。
    // なおこのセクションは自身の同一トークン証明 (#333→#555 は同じ無彩色軸の
    // 段差) を別に持つため、合否自体はここでは変わらない。
    expect(
      withMask.issues.some(
        (issue) =>
          issue.regionId === "test-card" && issue.evidence.signal === "diff_cluster_relief",
      ),
    ).toBe(false);
    expect(
      withoutMask.issues.some(
        (issue) =>
          issue.regionId === "test-card" && issue.evidence.signal === "diff_cluster_relief",
      ),
    ).toBe(true);
  });

  it("クラスタ単体では critical 未満でも、クラスタ行の重み付き構造が fail 閾値を割るなら両経路で失格にする", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    // デザインは白一色、実装は同じ明るさ帯の細かなノイズ。平均色差は
    // critical 閾値 (ΔE 2) に届かないので critical issue は立たないが、
    // 構造はフラットではない。ノード木の無い比較はクラスタ行の重み付き構造で
    // fail になるため、セクション経路も同じ結論に揃える。
    const frame = sectionReliefFrame();
    const designPixels = await createSolidRgba(SIZE, SIZE, WHITE_RGB);
    const screenshotPixels = Uint8ClampedArray.from(designPixels);
    for (let y = 40; y < 80; y += 1) {
      for (let x = 40; x < 80; x += 1) {
        const value = 0xff - ((x * 7 + y * 13) % 5) * 3;
        paint(screenshotPixels, x, y, 1, 1, { r: value, g: value, b: value });
      }
    }
    const options = {
      designPixels,
      screenshotPixels,
      width: SIZE,
      height: SIZE,
      diffRegions: [{ x: 40, y: 40, w: 40, h: 40, diffPixelCount: 1600 }],
      rasterizationTolerance: true,
    };

    const report = buildDiffReport({ ...options, figmaRootNode: frame });
    const withoutTree = buildDiffReport(options);

    // クラスタ行はノード木の無い比較の regionScores にだけ出る。色は critical
    // 閾値未満 (critical issue では説明できない) が構造は fail 閾値を割る形。
    const cluster = withoutTree.regionScores.find((score) =>
      score.regionId.startsWith("diff-cluster-"),
    );
    expect(cluster?.color).toBeLessThan(2);
    expect(cluster?.structure).toBeLessThan(0.8);
    expect(withoutTree.aggregateVerdict).toBe("fail");
    expect(report.aggregateVerdict).toBe("fail");
  });

  it("差分クラスタが1件も無くても、帯状の背景色ずれはフレーム残差で失格にする", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    // pixelmatch が1画素も差分と判定しない (ΔE≈5 は pixelmatch 閾値未満、
    // 実測 9949:23513 と同じ色ペアで実測済み) とクラスタは0件になる。
    // その場合に残差マスク自体を作らないと、色ずれはどの採点にも乗らず
    // 無計測のまま合格してしまう。クラスタの有無は残差を測るかどうかの
    // 条件にしない。
    const designPixels = await createSolidRgba(SIZE, SIZE, WHITE_RGB);
    const screenshotPixels = await createSolidRgba(SIZE, SIZE, WHITE_RGB);
    paint(designPixels, 0, 105, SIZE, 15, { r: 0xef, g: 0xf8, b: 0xf2 });
    paint(screenshotPixels, 0, 105, SIZE, 15, { r: 0xf7, g: 0xf7, b: 0xf7 });
    const options = {
      designPixels,
      screenshotPixels,
      width: SIZE,
      height: SIZE,
      diffRegions: [],
      rasterizationTolerance: true,
    };

    const report = buildDiffReport({ ...options, figmaRootNode: sectionReliefFrame() });
    const withoutTree = buildDiffReport(options);

    for (const target of [report, withoutTree]) {
      expect(target.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            regionId: "frame-residual",
            severity: "critical",
            evidence: expect.objectContaining({ signal: "residual_color_drift" }),
          }),
        ]),
      );
      expect(target.aggregateVerdict).toBe("fail");
    }
  });

  it("帯の境界をまたぐ薄い帯・縦縞・局所ブロックの色ずれも、面積で薄めず残差で失格にする", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    // いずれも ΔE≈5.2 の均一な色ずれ (知覚閾の5倍弱) で、人の目には帯分割も
    // 面積比も関係なく見える実差分。固定8帯の1平均だと、境界をまたぐ薄帯は
    // 両側に分かれて、縦縞と局所ブロックは帯の面積に対して小さくて、
    // それぞれ閾値を割る。レンダラ差になり得ない (フラットな面がまるごと
    // 変わる) ずれなので、窓の形に依存せず拾う。
    const variants: ReadonlyArray<{
      name: string;
      apply: (design: Uint8ClampedArray, shot: Uint8ClampedArray) => void;
    }> = [
      {
        // 8 行の帯が 1/8 分割の境界 (y105) をまたぐ。片側 5 行・片側 3 行。
        name: "thin-band-straddle",
        apply: (design, shot) => {
          paint(design, 0, 101, SIZE, 8, { r: 0xef, g: 0xf8, b: 0xf2 });
          paint(shot, 0, 101, SIZE, 8, { r: 0xf7, g: 0xf7, b: 0xf7 });
        },
      },
      {
        // 高さ 3 行の全幅帯。細いが全幅に ΔE≈5.2 のずれは明瞭に見える。
        name: "thin-band-3rows",
        apply: (design, shot) => {
          paint(design, 0, 106, SIZE, 3, { r: 0xef, g: 0xf8, b: 0xf2 });
          paint(shot, 0, 106, SIZE, 3, { r: 0xf7, g: 0xf7, b: 0xf7 });
        },
      },
      {
        // 幅 8px の縦縞。横帯だけで測ると全帯で (8/120)*5.2 = 0.35 に薄まる。
        name: "vertical-stripe",
        apply: (design, shot) => {
          paint(design, 60, 0, 8, SIZE, { r: 0xef, g: 0xf8, b: 0xf2 });
          paint(shot, 60, 0, 8, SIZE, { r: 0xf7, g: 0xf7, b: 0xf7 });
        },
      },
      {
        // 40x40 の局所ブロック。帯の高さ 15 行には 40x15 画素しか乗らず
        // (40*15*5.2)/(120*15) = 1.73 < 2 に薄まる。局所的な実欠陥を
        // 「クラスタ採点の責務」とみなして素通ししない (pixelmatch 閾値未満の
        // ずれはクラスタに乗らないため、残差が最後の計測)。
        name: "local-block-40x40",
        apply: (design, shot) => {
          paint(design, 40, 40, 40, 40, { r: 0xef, g: 0xf8, b: 0xf2 });
          paint(shot, 40, 40, 40, 40, { r: 0xf7, g: 0xf7, b: 0xf7 });
        },
      },
    ];
    for (const variant of variants) {
      const designPixels = await createSolidRgba(SIZE, SIZE, WHITE_RGB);
      const screenshotPixels = await createSolidRgba(SIZE, SIZE, WHITE_RGB);
      variant.apply(designPixels, screenshotPixels);
      // 証明済みの変位クラスタ (無関係な差分があっても結果が変わらないことの
      // 確認も兼ねる)。
      paint(designPixels, 10, 10, 30, 1, DARK_RGB);
      paint(screenshotPixels, 10, 12, 30, 1, DARK_RGB);
      const options = {
        designPixels,
        screenshotPixels,
        width: SIZE,
        height: SIZE,
        diffRegions: [
          { x: 10, y: 10, w: 30, h: 1, diffPixelCount: 30 },
          { x: 10, y: 12, w: 30, h: 1, diffPixelCount: 30 },
        ],
        rasterizationTolerance: true,
      };

      const report = buildDiffReport({ ...options, figmaRootNode: sectionReliefFrame() });
      const withoutTree = buildDiffReport(options);

      for (const target of [report, withoutTree]) {
        expect(
          target.issues.some(
            (issue) =>
              issue.severity === "critical" && issue.evidence.signal === "residual_color_drift",
          ),
          `${variant.name}: residual_color_drift が critical で出ること`,
        ).toBe(true);
        expect(target.aggregateVerdict, `${variant.name}: 失格になること`).toBe("fail");
      }
    }
  });

  it("許容されるレンダラ差 (なめらかな階調差・AA ディザ・写真風ノイズ) は細かい窓でも発火しない", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    // 窓を細かくするとノイズを拾う恐れがあるため、対照群を同じ重さで固定する。
    // いずれも画素あたり ΔE ≲ 1.5・零平均・エッジ非局在で、レンダラ/符号化差
    // として許容される形。
    const variants: ReadonlyArray<{
      name: string;
      apply: (design: Uint8ClampedArray, shot: Uint8ClampedArray) => void;
    }> = [
      {
        name: "gradient-ramp",
        apply: (design, shot) => {
          for (let y = 0; y < SIZE; y += 1) {
            const t = y / SIZE;
            const d = Math.round;
            paint(design, 0, y, SIZE, 1, {
              r: d(255 - 16 * t),
              g: d(255 - 7 * t),
              b: d(255 - 13 * t),
            });
            paint(shot, 0, y, SIZE, 1, {
              r: d(255 - 13 * t),
              g: d(255 - 6 * t),
              b: d(255 - 11 * t),
            });
          }
        },
      },
      {
        name: "aa-dither",
        apply: (_design, shot) => {
          for (let y = 0; y < SIZE; y += 1) {
            for (let x = 0; x < SIZE; x += 1) {
              if ((x * 7 + y * 13) % 3 === 0) continue;
              const value = 0xff - ((x + y) % 2); // 254/255 の ±1 ディザ
              paint(shot, x, y, 1, 1, { r: value, g: value, b: value });
            }
          }
        },
      },
      {
        name: "photo-noise",
        apply: (_design, shot) => {
          for (let y = 0; y < SIZE; y += 1) {
            for (let x = 0; x < SIZE; x += 1) {
              const n = ((x * 31 + y * 17) % 7) - 3;
              paint(shot, x, y, 1, 1, { r: 0xff - n, g: 0xff - n, b: 0xff - n });
            }
          }
        },
      },
    ];
    for (const variant of variants) {
      const designPixels = await createSolidRgba(SIZE, SIZE, WHITE_RGB);
      const screenshotPixels = await createSolidRgba(SIZE, SIZE, WHITE_RGB);
      variant.apply(designPixels, screenshotPixels);
      paint(designPixels, 10, 10, 30, 1, DARK_RGB);
      paint(screenshotPixels, 10, 12, 30, 1, DARK_RGB);
      const report = buildDiffReport({
        designPixels,
        screenshotPixels,
        width: SIZE,
        height: SIZE,
        diffRegions: [
          { x: 10, y: 10, w: 30, h: 1, diffPixelCount: 30 },
          { x: 10, y: 12, w: 30, h: 1, diffPixelCount: 30 },
        ],
        rasterizationTolerance: true,
      });

      expect(
        report.issues.some((issue) => issue.evidence.signal === "residual_color_drift"),
        `${variant.name}: 残差は発火しないこと`,
      ).toBe(false);
      expect(
        report.issues.some((issue) => issue.severity === "critical"),
        `${variant.name}: critical が出ないこと`,
      ).toBe(false);
      expect(report.aggregateVerdict, `${variant.name}: 合格のままであること`).toBe("pass");
    }
  });

  it("AA 縁 (1px ずれた文字帯の輪郭) は残差に混ぜず、混ぜたままだと発火することを併せて証明する", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const { buildAntiAliasedMask, comparePixels } = await import("@figdiff/shared");
    // 実機で受理済みの 1px ずれ (実測 9892:8063 等) を模す。白地にグレー縁つきの
    // 濃灰 2 行 (文字の画線) を design は y=60、shot は y=61 に引く。
    // ずれの輪郭は高振幅 (白↔灰↔濃灰) だが、pixelmatch は AA として件数に
    // 数えず、クラスタ採点のずれ許容でも合格してきた画素。残差がこれを数えると
    // 許容の裏口から再発火するため、提供者経由の AA マスクで除く。
    const paintBand = (pixels: Uint8ClampedArray, y0: number): void => {
      paint(pixels, 10, y0, 90, 1, { r: 0x99, g: 0x99, b: 0x99 });
      paint(pixels, 10, y0 + 1, 90, 2, DARK_RGB);
      paint(pixels, 10, y0 + 3, 90, 1, { r: 0x99, g: 0x99, b: 0x99 });
    };
    const designPixels = await createSolidRgba(SIZE, SIZE, WHITE_RGB);
    const screenshotPixels = await createSolidRgba(SIZE, SIZE, WHITE_RGB);
    // 静止アンカー (両画像で同一の外枠と横線)。ほぼ白紙の画面だと全体
    // アライメントの相関が縮退して帯の位置へ誤シフトし、帯と無関係な窓が
    // 発火するため (fixture 起因の誤検出)、位置合わせの基準を固定する。
    for (const pixels of [designPixels, screenshotPixels]) {
      paint(pixels, 0, 0, SIZE, 1, DARK_RGB);
      paint(pixels, 0, SIZE - 1, SIZE, 1, DARK_RGB);
      paint(pixels, 0, 0, 1, SIZE, DARK_RGB);
      paint(pixels, SIZE - 1, 0, 1, SIZE, DARK_RGB);
      paint(pixels, 30, 20, 40, 2, DARK_RGB);
      paint(pixels, 30, 100, 40, 2, DARK_RGB);
    }
    paintBand(designPixels, 60);
    paintBand(screenshotPixels, 61);

    // 実パイプラインと同じ部品で差分画素 (diffMask) と AA マスクを作る。
    // diffMask は pixelmatch が差分と数えた赤画素、AA マスクは本家と同じ
    // 手続きの移植。両者を合成すると本家の全差分画素を網羅する。
    const diffPixelData = new Uint8ClampedArray(SIZE * SIZE * 4);
    comparePixels(designPixels, screenshotPixels, diffPixelData, SIZE, SIZE, {
      threshold: 0.1,
      diffMask: true,
    });
    const diffMask = new Uint8Array(SIZE * SIZE);
    for (let index = 0; index < diffMask.length; index += 1) {
      const offset = index * 4;
      if (
        diffPixelData[offset + 3] !== 0 &&
        (diffPixelData[offset] !== diffPixelData[offset + 1] ||
          diffPixelData[offset + 1] !== diffPixelData[offset + 2])
      ) {
        diffMask[index] = 1;
      }
    }
    const antiAliasedMask = buildAntiAliasedMask(designPixels, screenshotPixels, SIZE, SIZE, {
      threshold: 0.1,
    });
    // 前提: このずれは本家の AA 判定を実際に引く画素を含む (空なら配線の
    // 証明にならない)。
    expect(antiAliasedMask.some((value) => value === 1)).toBe(true);

    const options = {
      designPixels,
      screenshotPixels,
      width: SIZE,
      height: SIZE,
      diffRegions: [{ x: 10, y: 60, w: 90, h: 5, diffPixelCount: 200 }],
      diffMask,
      rasterizationTolerance: true,
    };

    // 提供者が無い (= AA を区別できない) と残差はずれの輪郭に発火する。
    // これが残ることで「除外が効いている」ことの反対証明になる。
    const withoutProvider = buildDiffReport(options);
    expect(
      withoutProvider.issues.some((issue) => issue.evidence.signal === "residual_color_drift"),
      "AA を区別しない残差は 1px ずれの輪郭に発火する (除外の必要性の証明)",
    ).toBe(true);

    let providerCalls = 0;
    const withProvider = buildDiffReport({
      ...options,
      buildAntiAliasedMask: () => {
        providerCalls += 1;
        return antiAliasedMask;
      },
    });
    expect(providerCalls, "発火水準に届いたので AA マスクが要求されること").toBeGreaterThan(0);
    expect(
      withProvider.issues.some((issue) => issue.evidence.signal === "residual_color_drift"),
      "AA 縁を除いた残差は 1px ずれに発火しないこと",
    ).toBe(false);
  });

  it("一様な色ずれの帯は AA マスクを渡しても残差が発火する (除外で見逃しが増えない)", async () => {
    const { buildDiffReport } = await import("./diff-report-builder.js");
    const { buildAntiAliasedMask } = await import("@figdiff/shared");
    // ベタ面の一様なずれは同色の隣接が 3 つ以上あるため AA と判定されず、
    // 除外の対象に入らない。ずれを黙らせないことの固定。
    const designPixels = await createSolidRgba(SIZE, SIZE, WHITE_RGB);
    const screenshotPixels = await createSolidRgba(SIZE, SIZE, WHITE_RGB);
    // 上のテストと同じ理由で、全体アライメントの縮退を防ぐ静止アンカーを入れる。
    for (const pixels of [designPixels, screenshotPixels]) {
      paint(pixels, 0, 0, SIZE, 1, DARK_RGB);
      paint(pixels, 0, SIZE - 1, SIZE, 1, DARK_RGB);
      paint(pixels, 0, 0, 1, SIZE, DARK_RGB);
      paint(pixels, SIZE - 1, 0, 1, SIZE, DARK_RGB);
    }
    paint(designPixels, 0, 105, SIZE, 15, { r: 0xef, g: 0xf8, b: 0xf2 });
    paint(screenshotPixels, 0, 105, SIZE, 15, { r: 0xf7, g: 0xf7, b: 0xf7 });

    const report = buildDiffReport({
      designPixels,
      screenshotPixels,
      width: SIZE,
      height: SIZE,
      diffRegions: [],
      rasterizationTolerance: true,
      buildAntiAliasedMask: () =>
        buildAntiAliasedMask(designPixels, screenshotPixels, SIZE, SIZE, { threshold: 0.1 }),
    });

    expect(
      report.issues.some((issue) => issue.evidence.signal === "residual_color_drift"),
      "一様な色ずれは AA 除外の対象にならず発火し続けること",
    ).toBe(true);
    expect(report.aggregateVerdict).toBe("fail");
  });
});

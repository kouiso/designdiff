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
    expect(result.issues.map((issue) => issue.kind)).toContain("position");
    expect(result.issues.map((issue) => issue.kind)).toContain("size");
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

    expect(result.regionScores).toHaveLength(3);
    expect(result.regionScores.map((score) => score.figmaNodeId)).toEqual([
      "header",
      "body",
      "footer",
    ]);
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

    expect(result.regionScores).toHaveLength(EXPECTED_CAPPED_REGION_COUNT);
    expect(result.regionScores.every((score) => score.regionId.startsWith("section-"))).toBe(true);
    expect(result.regionScores[0].regionId).toBe("section-0");
    expect(result.regionScores.at(-1)?.regionId).toBe(`section-${SECTION_REGION_COUNT - 1}`);
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

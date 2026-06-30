import * as fs from "node:fs/promises";
import * as path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { CompareDesignResult, FigmaNode } from "@figdiff/shared";

const FigmaNodeSchema: z.ZodType<FigmaNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    children: z.array(FigmaNodeSchema).default([]),
    absoluteBoundingBox: z
      .object({
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number(),
      })
      .nullable()
      .optional(),
    absoluteRenderBounds: z
      .object({
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number(),
      })
      .nullable()
      .optional(),
    fills: z.array(z.object({ type: z.string() })).default([]),
    strokes: z.array(z.object({ type: z.string() })).default([]),
    strokeWeight: z.number().optional(),
    cornerRadius: z.number().optional(),
    rectangleCornerRadii: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
    effects: z.array(z.object({ type: z.string() })).default([]),
    opacity: z.number().optional(),
    layoutMode: z.string().optional(),
    primaryAxisAlignItems: z.string().optional(),
    counterAxisAlignItems: z.string().optional(),
    paddingLeft: z.number().optional(),
    paddingRight: z.number().optional(),
    paddingTop: z.number().optional(),
    paddingBottom: z.number().optional(),
    itemSpacing: z.number().optional(),
    style: z
      .object({
        fontFamily: z.string().optional(),
        fontSize: z.number().optional(),
        fontWeight: z.number().optional(),
        lineHeightPx: z.number().optional(),
        letterSpacing: z.number().optional(),
        textAlignHorizontal: z.string().optional(),
      })
      .optional(),
    characters: z.string().optional(),
  }),
);

const FixtureVariantSchema = z.object({
  name: z.string().min(1),
  image: z.string().min(1),
  expectedVerdict: z.enum(["pass", "fail", "inconclusive"]),
  expectedKinds: z.array(z.string()),
  expectedIssueKinds: z
    .array(z.enum(["color", "position", "size", "missing", "extra", "typography"]))
    .optional(),
  notes: z.string().optional(),
  expectedWeightedStructureMin: z.number().optional(),
  expectedWeightedStructureMax: z.number().optional(),
  expectedWeightedColorMin: z.number().optional(),
  expectedWeightedColorMax: z.number().optional(),
  expectedWorstRegionIds: z.array(z.string()).optional(),
  expectedRegionStructure: z
    .record(z.string(), z.object({ min: z.number().optional(), max: z.number().optional() }))
    .optional(),
});

const FixtureExpectationSchema = z.object({
  pairId: z.string().min(1),
  figmaFrame: z.string().min(1),
  figmaRootNode: FigmaNodeSchema.optional(),
  variants: z.array(FixtureVariantSchema).min(1),
});

const FIXTURES_ROOT = path.resolve(import.meta.dirname, "../../../../verification/fixtures");
// coverage 実行では画像比較が 5 秒を超えることがあるため、fixture だけ余裕を持たせる。
const FIXTURE_TEST_TIMEOUT_MS = 15_000;

async function loadBase64(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  return buffer.toString("base64");
}

function assertWeightedStructure(
  result: CompareDesignResult,
  variant: z.infer<typeof FixtureVariantSchema>,
): void {
  if (variant.expectedWeightedStructureMin !== undefined) {
    expect(result.diffReport?.weightedAggregate?.weightedStructure ?? -1).toBeGreaterThanOrEqual(
      variant.expectedWeightedStructureMin,
    );
  }

  if (variant.expectedWeightedStructureMax !== undefined) {
    expect(result.diffReport?.weightedAggregate?.weightedStructure ?? 2).toBeLessThanOrEqual(
      variant.expectedWeightedStructureMax,
    );
  }
}

function assertWeightedColor(
  result: CompareDesignResult,
  variant: z.infer<typeof FixtureVariantSchema>,
): void {
  if (variant.expectedWeightedColorMin !== undefined) {
    expect(result.diffReport?.weightedAggregate?.weightedColor ?? -1).toBeGreaterThanOrEqual(
      variant.expectedWeightedColorMin,
    );
  }

  if (variant.expectedWeightedColorMax !== undefined) {
    expect(
      result.diffReport?.weightedAggregate?.weightedColor ?? Number.POSITIVE_INFINITY,
    ).toBeLessThanOrEqual(variant.expectedWeightedColorMax);
  }
}

function assertRegionStructure(
  result: CompareDesignResult,
  variant: z.infer<typeof FixtureVariantSchema>,
): void {
  if (!variant.expectedRegionStructure) {
    return;
  }

  for (const [figmaNodeId, expected] of Object.entries(variant.expectedRegionStructure)) {
    const region = result.diffReport?.regionScores.find(
      (score) => score.figmaNodeId === figmaNodeId,
    );
    expect(region).toBeDefined();

    if (expected.min !== undefined) {
      expect(region?.structure ?? -1).toBeGreaterThanOrEqual(expected.min);
    }

    if (expected.max !== undefined) {
      expect(region?.structure ?? 2).toBeLessThanOrEqual(expected.max);
    }
  }
}

function assertIssuePresence(
  result: CompareDesignResult,
  variant: z.infer<typeof FixtureVariantSchema>,
): void {
  if (variant.expectedVerdict === "pass") {
    expect(result.diffReport?.issues).toHaveLength(0);
    return;
  }

  expect((result.diffReport?.issues.length ?? 0) > 0).toBe(true);
}

function assertIssueKinds(
  result: CompareDesignResult,
  variant: z.infer<typeof FixtureVariantSchema>,
): void {
  if (!variant.expectedIssueKinds || variant.expectedIssueKinds.length === 0) {
    return;
  }

  const actualKinds = new Set(result.diffReport?.issues.map((issue) => issue.kind) ?? []);

  for (const expectedKind of variant.expectedIssueKinds) {
    expect(actualKinds.has(expectedKind)).toBe(true);
  }
}

function assertWorstRegions(
  result: CompareDesignResult,
  variant: z.infer<typeof FixtureVariantSchema>,
): void {
  if (!variant.expectedWorstRegionIds || variant.expectedWorstRegionIds.length === 0) {
    return;
  }

  const actualWorstRegionIds = [...(result.diffReport?.regionScores ?? [])]
    .sort((left, right) => {
      if (left.structure !== right.structure) {
        return left.structure - right.structure;
      }

      return right.color - left.color;
    })
    .slice(0, variant.expectedWorstRegionIds.length)
    .map((score) => score.figmaNodeId ?? score.regionId);

  expect(new Set(actualWorstRegionIds)).toEqual(new Set(variant.expectedWorstRegionIds));
}

describe("golden fixture runner", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("@figdiff/shared");
  });

  async function runFixture(pairId: string): Promise<void> {
    const { compareImages } = await import("./image-compare-service.js");
    const pairDir = path.join(FIXTURES_ROOT, pairId);
    const expectationRaw = await fs.readFile(path.join(pairDir, "expected.json"), "utf8");
    const expectation = FixtureExpectationSchema.parse(JSON.parse(expectationRaw));
    const designBase64 = await loadBase64(path.join(pairDir, expectation.figmaFrame));

    for (const variant of expectation.variants) {
      const screenshotBase64 = await loadBase64(path.join(pairDir, variant.image));
      const result = await compareImages(
        {
          designBase64,
          screenshotBase64,
          threshold: 0.1,
        },
        expectation.figmaRootNode,
      );

      expect(result.diffReport?.aggregateVerdict).toBe(variant.expectedVerdict);
      assertWeightedStructure(result, variant);
      assertWeightedColor(result, variant);
      assertRegionStructure(result, variant);
      assertIssuePresence(result, variant);
      assertIssueKinds(result, variant);
      assertWorstRegions(result, variant);
    }
  }

  it(
    "pair-01-simple-static-lp の期待 verdict を満たすこと",
    async () => {
      await runFixture("pair-01-simple-static-lp");
    },
    FIXTURE_TEST_TIMEOUT_MS,
  );

  it(
    "pair-02-multi-section-lp の期待 verdict と weighted isolation を満たすこと",
    async () => {
      await runFixture("pair-02-multi-section-lp");
    },
    FIXTURE_TEST_TIMEOUT_MS,
  );

  it(
    "pair-03-typography-layout の期待 verdict と worst region を満たすこと",
    async () => {
      await runFixture("pair-03-typography-layout");
    },
    FIXTURE_TEST_TIMEOUT_MS,
  );

  it(
    "pair-04-color-system の期待 verdict と weighted color を満たすこと",
    async () => {
      await runFixture("pair-04-color-system");
    },
    FIXTURE_TEST_TIMEOUT_MS,
  );
});

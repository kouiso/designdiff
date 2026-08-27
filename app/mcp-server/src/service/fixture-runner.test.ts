import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isDeepStrictEqual } from "node:util";

import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  resolveFixtureVerifiedSystemUiTopInset,
  SystemUiFixtureMetadataSchema,
  IgnoreRegionSchema,
  type CompareDesignResult,
  type FigmaNode,
} from "@figdiff/shared";

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

const FixtureVariantSchema = z
  .object({
    name: z.string().min(1),
    image: z.string().min(1),
    expectedVerdict: z.enum(["pass", "fail", "inconclusive"]),
    expectedKinds: z.array(z.string()),
    expectedIssueKinds: z
      .array(z.enum(["color", "position", "size", "missing", "extra", "typography"]))
      .optional(),
    ignoreRegions: z.array(IgnoreRegionSchema).optional(),
    expectedSystemUiAlignment: z
      .object({
        matchRate: z.number().min(0).max(100),
        diffPixelCount: z.number().int().nonnegative(),
        translation: z.object({ x: z.number(), y: z.number() }),
      })
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
  })
  .and(SystemUiFixtureMetadataSchema);

const FixtureExpectationSchema = z.object({
  pairId: z.string().min(1),
  figmaFrame: z.string().min(1),
  figmaRootNode: FigmaNodeSchema.optional(),
  variants: z.array(FixtureVariantSchema).min(1),
});

const FIXTURES_ROOT = path.resolve(import.meta.dirname, "../../../../verification/fixture");
// coverage 実行では画像比較が 5 秒を超えることがあるため、fixture だけ余裕を持たせる。
const FIXTURE_TEST_TIMEOUT_MS = 60_000;

async function loadBase64(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  return buffer.toString("base64");
}

const assertIndependentSystemUiAlignment = async (
  designBase64: string,
  screenshotBase64: string,
  variant: z.infer<typeof FixtureVariantSchema>,
): Promise<{ matchRate: number; diffPixelCount: number }> => {
  const [design, screenshot] = await Promise.all(
    [designBase64, screenshotBase64].map((base64) =>
      sharp(Buffer.from(base64, "base64"))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true }),
    ),
  );
  if (
    design.info.width !== screenshot.info.width ||
    design.info.height !== screenshot.info.height
  ) {
    throw new Error("system UI fixture images must have identical dimensions");
  }
  const width = design.info.width;
  const height = design.info.height;
  const expected = variant.expectedSystemUiAlignment;
  if (!expected) {
    throw new Error("independent system UI alignment requires explicit expectations");
  }
  const ignored = new Uint8Array(width * height);
  for (const region of variant.ignoreRegions ?? []) {
    const left = Math.max(0, Math.floor(region.x));
    const top = Math.max(0, Math.floor(region.y));
    const right = Math.min(width, Math.floor(region.x + region.width));
    const bottom = Math.min(height, Math.floor(region.y + region.height));
    for (let y = top; y < bottom; y += 1) {
      ignored.fill(1, y * width + left, y * width + right);
    }
  }
  let evaluatedPixelCount = 0;
  let diffPixelCount = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (ignored[y * width + x] === 1) continue;
      evaluatedPixelCount += 1;
      const sourceX = x - expected.translation.x;
      const sourceY = y - expected.translation.y;
      const destinationOffset = (y * width + x) * 4;
      const sourceInBounds = sourceX >= 0 && sourceX < width && sourceY >= 0 && sourceY < height;
      if (!sourceInBounds) {
        diffPixelCount += 1;
        continue;
      }
      const sourceOffset = (sourceY * width + sourceX) * 4;
      if (
        design.data[sourceOffset] !== screenshot.data[destinationOffset] ||
        design.data[sourceOffset + 1] !== screenshot.data[destinationOffset + 1] ||
        design.data[sourceOffset + 2] !== screenshot.data[destinationOffset + 2] ||
        design.data[sourceOffset + 3] !== screenshot.data[destinationOffset + 3]
      ) {
        diffPixelCount += 1;
      }
    }
  }
  return {
    matchRate: (100 * (evaluatedPixelCount - diffPixelCount)) / evaluatedPixelCount,
    diffPixelCount,
  };
};

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

  async function runFixture(pairId: string, repetitions = 1): Promise<void> {
    const { compareImages } = await import("./image-compare-service.js");
    const pairDir = path.join(FIXTURES_ROOT, pairId);
    const expectationRaw = await fs.readFile(path.join(pairDir, "expected.json"), "utf8");
    const expectation = FixtureExpectationSchema.parse(JSON.parse(expectationRaw));
    const designBase64 = await loadBase64(path.join(pairDir, expectation.figmaFrame));

    for (const variant of expectation.variants) {
      const screenshotBase64 = await loadBase64(path.join(pairDir, variant.image));
      const metadata = variant.captureDevice
        ? await sharp(Buffer.from(screenshotBase64, "base64")).metadata()
        : undefined;
      if (metadata && (!metadata.width || !metadata.height)) {
        throw new Error(`${expectation.pairId}/${variant.name}: screenshot dimensions are missing`);
      }
      const verifiedSystemUiTopInset = resolveFixtureVerifiedSystemUiTopInset(
        variant,
        metadata?.width && metadata.height
          ? { width: metadata.width, height: metadata.height }
          : { width: 0, height: 0 },
      );
      const stableRuns: {
        matchRate: number;
        diffPixelCount: number;
        totalPixelCount: number;
        translation: { x: number; y: number } | undefined;
        diffSha256: string;
      }[] = [];
      for (let run = 0; run < repetitions; run += 1) {
        const result = await compareImages(
          {
            designBase64,
            screenshotBase64,
            threshold: 0.1,
            ignoreRegions: variant.ignoreRegions,
            verifiedSystemUiTopInset,
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
        if (!result.diffImageBase64) {
          throw new Error(`${expectation.pairId}/${variant.name}: diff image is missing`);
        }
        stableRuns.push({
          matchRate: result.matchRate,
          diffPixelCount: result.diffPixelCount,
          totalPixelCount: result.totalPixelCount,
          translation: result.diffReport?.alignment.translation,
          diffSha256: createHash("sha256")
            .update(Buffer.from(result.diffImageBase64, "base64"))
            .digest("hex"),
        });
      }
      expect(stableRuns.every((run) => isDeepStrictEqual(run, stableRuns[0]))).toBe(true);
      if (variant.expectedSystemUiAlignment !== undefined) {
        // tool出力だけを期待値にすると、実装の自己申告をfixtureが追認してしまう。
        // 生画像を独立に再配置して、system UI帯を除く画素の一致を先に検証する。
        const independent = await assertIndependentSystemUiAlignment(
          designBase64,
          screenshotBase64,
          variant,
        );
        expect(independent).toEqual({
          matchRate: variant.expectedSystemUiAlignment.matchRate,
          diffPixelCount: variant.expectedSystemUiAlignment.diffPixelCount,
        });
        expect(stableRuns[0]?.matchRate).toBe(variant.expectedSystemUiAlignment.matchRate);
        expect(stableRuns[0]?.diffPixelCount).toBe(
          variant.expectedSystemUiAlignment.diffPixelCount,
        );
        expect(stableRuns[0]?.translation).toEqual(variant.expectedSystemUiAlignment.translation);
      }
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

  it(
    "pair-05-localized-diff の期待 verdict を満たすこと (Issue #56 回帰防止)",
    async () => {
      await runFixture("pair-05-localized-diff");
    },
    FIXTURE_TEST_TIMEOUT_MS,
  );

  it(
    "pair-06-system-ui-alignment の stitched mask と位置補正を満たすこと",
    async () => {
      await runFixture("pair-06-system-ui-alignment", 3);
    },
    // 1080x4800 のフル解像度画像を3回連続で比較する重い検体。coverage計装
    // (v8) が乗ると通常の4〜5倍かかり、共通の FIXTURE_TEST_TIMEOUT_MS(60s)
    // では coverage 付き CI job でだけ timeout していた。この検体だけ余裕を
    // 持たせる。
    FIXTURE_TEST_TIMEOUT_MS * 3,
  );
});

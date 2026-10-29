import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
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
    // 別レンダラ同士の検体 (Figma正本 vs Flutter/Skia キャプチャ) では、
    // same-token 証明を verdict に効かせる opt-in を検体ごとに付ける。
    // strict 判定を守る対照検体 (意図的差分など) では付けない。
    rasterizationTolerance: z.boolean().optional(),
    // expectedVerdict は pass (あるべき姿) のまま、推定器の未修正で fail を返している既知 RED。
    // 値は原因 Issue。runner はこの検体だけ fail を明示的に assert する。
    knownRedIssue: z.string().min(1).optional(),
    // 既知 RED の失敗モードを固定する宣言。expectedVerdict が pass の検体に
    // expectedIssueKinds を書くと「0 issue 必須」と矛盾するため別フィールドに
    // 分離する。knownRedIssue 経路でのみ評価し、推定器修正後は knownRedIssue と
    // 一緒に外す。
    knownRedIssueKinds: z
      .array(z.enum(["color", "position", "size", "missing", "extra", "typography"]))
      .optional(),
    // FigDiff 自身の verdict に依存しない独立オラクル。
    // translation: 派生画像が impl-correct を (dx,dy) 平行移動したものであることを raw 画素で確認する。
    independentTranslation: z.object({ dx: z.number().int(), dy: z.number().int() }).optional(),
    // 生画素の差分率 (全画素共通の単純オラクル)。against: figma は figma-export と、
    // correct は impl-correct と比較する。min/max で上下限を宣言する。
    independentPixelDiffRatio: z
      .object({
        against: z.enum(["figma", "correct"]),
        min: z.number().min(0).max(1).optional(),
        max: z.number().min(0).max(1).optional(),
      })
      .optional(),
    expectedSystemUiAlignment: z
      .object({
        matchRate: z.number().min(0).max(100),
        diffPixelCount: z.number().int().nonnegative(),
        translation: z.object({ x: z.number().int().safe(), y: z.number().int().safe() }),
      })
      .optional(),
    independentSystemUiAlignment: z
      .object({
        matchRate: z.number().min(0).max(100),
        diffPixelCount: z.number().int().nonnegative(),
        translation: z.object({ x: z.number().int().safe(), y: z.number().int().safe() }),
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
  .and(SystemUiFixtureMetadataSchema)
  .refine(
    (variant) => variant.knownRedIssueKinds === undefined || variant.knownRedIssue !== undefined,
    { message: "knownRedIssueKinds は knownRedIssue とセットでのみ宣言する" },
  )
  .refine(
    (variant) =>
      variant.expectedVerdict !== "pass" || (variant.expectedIssueKinds ?? []).length === 0,
    {
      message:
        "expectedVerdict=pass の検体に expectedIssueKinds は書けない (0 issue 必須と矛盾する)。既知 RED の失敗モードは knownRedIssueKinds に書く",
    },
  );

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
  const expected = variant.independentSystemUiAlignment;
  if (!expected) {
    throw new Error("independent system UI alignment requires separate explicit expectations");
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
  if (evaluatedPixelCount === 0) {
    throw new Error("independent system UI alignment must leave at least one pixel unmasked");
  }
  return {
    matchRate:
      Math.round((100 * (evaluatedPixelCount - diffPixelCount) * 100) / evaluatedPixelCount) / 100,
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

const assertIssueKinds = (result: CompareDesignResult, expectedKinds: string[] | undefined): void => {
  if (!expectedKinds || expectedKinds.length === 0) {
    return;
  }

  const actualKinds = new Set(result.diffReport?.issues.map((issue) => issue.kind) ?? []);

  for (const expectedKind of expectedKinds) {
    expect(actualKinds.has(expectedKind)).toBe(true);
  }
};

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

const loadRgbRaw = async (
  filePath: string,
): Promise<{ data: Buffer; width: number; height: number }> => {
  const { data, info } = await sharp(filePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 0; i < info.width * info.height; i += 1) {
    if (data[i * 4 + 3] !== 255) {
      throw new Error(`${filePath}: non-opaque pixel at index ${i}`);
    }
  }
  const rgb = Buffer.alloc(info.width * info.height * 3);
  for (let i = 0; i < info.width * info.height; i += 1) {
    data.copy(rgb, i * 3, i * 4, i * 4 + 3);
  }
  return { data: rgb, width: info.width, height: info.height };
};

const pixelDiffRatio = (
  left: { data: Buffer; width: number; height: number },
  right: { data: Buffer; width: number; height: number },
): number => {
  if (left.width !== right.width || left.height !== right.height) return 1;
  let diff = 0;
  const total = left.width * left.height;
  for (let i = 0; i < total; i += 1) {
    const offset = i * 3;
    const delta = Math.max(
      Math.abs(left.data[offset] - right.data[offset]),
      Math.abs(left.data[offset + 1] - right.data[offset + 1]),
      Math.abs(left.data[offset + 2] - right.data[offset + 2]),
    );
    if (delta > 40) diff += 1;
  }
  return diff / total;
};

// 派生画像が impl-correct の純粋な平行移動であることを、FigDiff を介さず
// raw 画素で確かめる。x>=dx 域は完全一致、x<dx 域は端列の複製。
const assertIndependentTranslation = async (
  pairDir: string,
  variant: { name: string; image: string; independentTranslation?: { dx: number; dy: number } },
): Promise<void> => {
  const delta = variant.independentTranslation;
  if (!delta) return;
  const shifted = await loadRgbRaw(path.join(pairDir, variant.image));
  const base = await loadRgbRaw(path.join(pairDir, "impl-correct.png"));
  expect({ width: shifted.width, height: shifted.height }).toEqual({
    width: base.width,
    height: base.height,
  });
  const { dx, dy } = delta;
  // 間引き照合だと奇数行・奇数列だけの破損を見逃すため全画素を走査する。
  // 画素ごとに expect すると数百万 assertion になるため、最初の不一致
  // 座標を取って一回だけ失敗する形にする。
  let firstMismatch: { x: number; y: number } | undefined;
  outer: for (let y = 0; y < shifted.height; y += 1) {
    const sourceY = Math.min(Math.max(y - dy, 0), base.height - 1);
    for (let x = 0; x < shifted.width; x += 1) {
      const sourceX = Math.min(Math.max(x - dx, 0), base.width - 1);
      const targetOffset = (y * shifted.width + x) * 3;
      const sourceOffset = (sourceY * base.width + sourceX) * 3;
      if (
        shifted.data[targetOffset] !== base.data[sourceOffset] ||
        shifted.data[targetOffset + 1] !== base.data[sourceOffset + 1] ||
        shifted.data[targetOffset + 2] !== base.data[sourceOffset + 2]
      ) {
        firstMismatch = { x, y };
        break outer;
      }
    }
  }
  expect(
    firstMismatch,
    `${variant.name}: pixel(${firstMismatch?.x},${firstMismatch?.y}) が impl-correct の (${dx},${dy}) 平行移動と一致しない`,
  ).toBeUndefined();
};

const assertIndependentPixelDiffRatio = async (
  pairDir: string,
  figmaFrame: string,
  variant: {
    name: string;
    image: string;
    independentPixelDiffRatio?: { against: "figma" | "correct"; min?: number; max?: number };
  },
): Promise<void> => {
  const rule = variant.independentPixelDiffRatio;
  if (!rule) return;
  const variantRgb = await loadRgbRaw(path.join(pairDir, variant.image));
  const referenceFile = rule.against === "figma" ? figmaFrame : "impl-correct.png";
  const reference = await loadRgbRaw(path.join(pairDir, referenceFile));
  const ratio = pixelDiffRatio(variantRgb, reference);
  if (rule.min !== undefined) {
    expect(
      ratio,
      `${variant.name}: vs ${referenceFile} の画素差分率 ${ratio.toFixed(4)} が下限 ${rule.min} を下回った`,
    ).toBeGreaterThanOrEqual(rule.min);
  }
  if (rule.max !== undefined) {
    expect(
      ratio,
      `${variant.name}: vs ${referenceFile} の画素差分率 ${ratio.toFixed(4)} が上限 ${rule.max} を超えた`,
    ).toBeLessThanOrEqual(rule.max);
  }
};

const assertVerdictAndMetrics = (
  result: CompareDesignResult,
  variant: z.infer<typeof FixtureVariantSchema>,
): void => {
  if (variant.knownRedIssue !== undefined) {
    // it.fails だと読込失敗や schema エラーの throw でも緑になる。verdict を直接
    // assert すれば、推定器が直って pass に変わった時にだけ落ちる。
    expect(variant.expectedVerdict).toBe("pass");
    expect(result.diffReport?.aggregateVerdict).toBe("fail");
    // 既知 RED の失敗モードも宣言した kinds で固定する。
    // 推定器の修正中に別原因の fail へ化けても黙って緑にならないようにする。
    assertIssueKinds(result, variant.knownRedIssueKinds);
    return;
  }

  expect(result.diffReport?.aggregateVerdict).toBe(variant.expectedVerdict);
  assertWeightedStructure(result, variant);
  assertWeightedColor(result, variant);
  assertRegionStructure(result, variant);
  assertIssuePresence(result, variant);
  assertIssueKinds(result, variant.expectedIssueKinds);
  assertWorstRegions(result, variant);
};

const resolveVariants = (
  expectation: z.infer<typeof FixtureExpectationSchema>,
  variantName: string | undefined,
): z.infer<typeof FixtureVariantSchema>[] => {
  const variants = expectation.variants.filter(
    (variant) => variantName === undefined || variant.name === variantName,
  );
  if (variants.length === 0) {
    throw new Error(`${expectation.pairId}: variant ${String(variantName)} は定義されていない`);
  }
  return variants;
};

describe("golden fixture runner", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("@figdiff/shared");
  });

  const runFixture = async (
    pairId: string,
    repetitions = 1,
    variantName?: string,
  ): Promise<void> => {
    const { compareImages } = await import("./image-compare-service.js");
    const pairDir = path.join(FIXTURES_ROOT, pairId);
    const expectationRaw = await fs.readFile(path.join(pairDir, "expected.json"), "utf8");
    const expectation = FixtureExpectationSchema.parse(JSON.parse(expectationRaw));
    const designBase64 = await loadBase64(path.join(pairDir, expectation.figmaFrame));
    for (const variant of resolveVariants(expectation, variantName)) {
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
            rasterizationTolerance: variant.rasterizationTolerance,
          },
          expectation.figmaRootNode,
        );

        assertVerdictAndMetrics(result, variant);
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
      // FigDiff の verdict とは独立に、検体画像そのものの構成(平行移動)と
      // 生画素の差分率を確かめる。expectedVerdict の自己申告化を防ぐ層。
      await assertIndependentTranslation(pairDir, variant);
      await assertIndependentPixelDiffRatio(pairDir, expectation.figmaFrame, variant);
      if (variant.expectedSystemUiAlignment !== undefined) {
        // tool出力だけを期待値にすると、実装の自己申告をfixtureが追認してしまう。
        // 生画像を独立に再配置して、system UI帯を除く画素の一致を先に検証する。
        // 独立側は厳密な raw pixel oracle とし、tool 側とは期待値を分離する。
        const independent = await assertIndependentSystemUiAlignment(
          designBase64,
          screenshotBase64,
          variant,
        );
        expect(independent).toEqual({
          matchRate: variant.independentSystemUiAlignment?.matchRate,
          diffPixelCount: variant.independentSystemUiAlignment?.diffPixelCount,
        });
        expect(stableRuns[0]?.matchRate).toBe(variant.expectedSystemUiAlignment.matchRate);
        expect(stableRuns[0]?.diffPixelCount).toBe(
          variant.expectedSystemUiAlignment.diffPixelCount,
        );
        expect(stableRuns[0]?.translation).toEqual(variant.expectedSystemUiAlignment.translation);
      }
    }
  };

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

  // designdiff#243: horsemanager Gate1 検体。ケースは expected.json から生成し、
  // verdict の正本を 1 か所 (expected.json) に保つ。
  // correct: Figma正本と同一内容物なら pass 期待。推定器が未修正の間は knownRedIssue で
  //   既知 RED として fail を直接 assert する。内容差・寸法差があるものは fail 期待の対照。
  // drift-*: 意図的平行移動。tolerance 下でも fail のままであることを見る対照。
  // linewidth: 線幅差。#243 は検出漏れを許さないので fail 期待。
  // designdiff#243 の台帳は 18 ペア固定。検体ディレクトリの欠落・混入は
  // 件数だけでは検出できないため、集合を明示して照合する。
  const HM_GATE1_PAIR_IDS = [
    "pair-07-hm-gate1-9810-3312",
    "pair-08-hm-gate1-9721-6204",
    "pair-09-hm-gate1-9776-6791",
    "pair-10-hm-gate1-9776-6698",
    "pair-11-hm-gate1-9776-6456",
    "pair-12-hm-gate1-9810-3193",
    "pair-13-hm-gate1-9804-4204",
    "pair-14-hm-gate1-9804-4285",
    "pair-15-hm-gate1-9804-4369",
    "pair-16-hm-gate1-9892-8063",
    "pair-17-hm-gate1-9878-6665",
    "pair-18-hm-gate1-9892-10228",
    "pair-19-hm-gate1-9863-5441",
    "pair-20-hm-gate1-9878-6036",
    "pair-21-hm-gate1-9878-6362",
    "pair-22-hm-gate1-9776-6584",
    "pair-23-hm-gate1-9799-4024",
    "pair-24-hm-gate1-9789-3641",
  ];
  const gate1PairDirs = readdirSync(FIXTURES_ROOT)
    .filter((name) => /^pair-\d+-hm-gate1-/.test(name))
    .sort();
  const HM_GATE1_CASES: [string, string, string][] = gate1PairDirs.flatMap((pairId) => {
    const expectation = FixtureExpectationSchema.parse(
      JSON.parse(readFileSync(path.join(FIXTURES_ROOT, pairId, "expected.json"), "utf8")),
    );
    return expectation.variants.map((variant): [string, string, string] => [
      pairId,
      variant.name,
      variant.knownRedIssue !== undefined
        ? `既知RED(${variant.knownRedIssue}): ${variant.expectedVerdict} 期待だが fail`
        : variant.expectedVerdict,
    ]);
  });
  it("Gate1 検体を expected.json から読み込めていること", () => {
    // 18 ペアの集合と variant 件数の両方をピンする。correct + drift 対照
    // (pass 基準の 9 ペア drift-2px + 3 drift-1px) + 3 linewidth + fail 基準
    // の 9 correct = 33 ケースが正規値。基準が fail のペアでは drift 対照が
    // 空転するため対象外。
    expect(gate1PairDirs).toEqual(HM_GATE1_PAIR_IDS);
    expect(HM_GATE1_CASES.length).toBe(33);
  });
  it.each(HM_GATE1_CASES)(
    "%s %s の verdict が期待どおりであること: %s (designdiff#243)",
    async (pairId, variantName) => {
      await runFixture(pairId, 1, variantName);
    },
    FIXTURE_TEST_TIMEOUT_MS,
  );
});

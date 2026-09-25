import { createHash } from "node:crypto";

import { z } from "zod";

import {
  IgnoreRegionSchema,
  ComparisonConditionsInputSchema,
  buildVerdict,
  canonicalizeVerificationContextPayload,
  compareFixRegions,
  parseComparisonCampaignKey,
  type ComparisonConditionsInput,
  type FixRegionComparison,
  type IgnoreRegion,
  type VerificationContext,
  type VerificationContextPayload,
} from "@figdiff/shared";

import { writeActiveSession } from "../service/active-session.js";
import { runCompareDesign, type CompareDesignRunOutput } from "../service/compare-design-runner.js";
import { getComparisonEntry, type ComparisonHistoryEntry } from "../service/comparison-history.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export { axisContribution, buildVerdict } from "@figdiff/shared";

const VerifyFixResultSchema = z.object({
  fixedNode: z.string(),
  structureDelta: z.number(),
  colorDelta: z.number(),
  shapeDelta: z.number(),
  verdict: z.enum(["improved", "unchanged", "regressed"]),
  // verdict は対象ノードが良くなったかだけを答える。比較そのものが信用できるかは
  // 別の問いなので、runner の status をそのまま持ち上げる。局所的な改善で
  // 人間レビュー行きの比較を握り潰さないため。
  comparisonStatus: z.enum(["PASS", "FAIL", "UNCERTAIN"]),
  sideEffects: z.array(
    z.object({
      nodeId: z.string(),
      delta: z.number(),
    }),
  ),
});

const DESCRIPTION =
  "compare_design の前回比較と今回比較を突き合わせ、指定ノードが本当に改善したかと他セクションへの副作用を検証します。project_id 指定時は保存済み ignore_regions も適用します。";

interface VerifyFixArguments {
  design_source: string;
  screenshot: string;
  frame_name?: string;
  threshold?: number;
  profile?: "strict" | "balanced" | "layout";
  comparison_conditions?: ComparisonConditionsInput;
  design_background?: string;
  project_id?: string;
  prior_comparison_id: string;
  expected_target_node_id: string;
  ignore_regions?: IgnoreRegion[];
}

// 比較全体が人間レビューへ回っているなら、対象ノードが良くなっていても PASS と
// 書かない。書くとセッションカードだけが合格を主張する。
export function resolveSessionStatus(
  comparisonStatus: "PASS" | "FAIL" | "UNCERTAIN",
  verdict: "improved" | "unchanged" | "regressed",
): "PASS" | "FAIL" | "UNCERTAIN" {
  if (comparisonStatus === "UNCERTAIN") return "UNCERTAIN";
  return verdict === "improved" ? "PASS" : "FAIL";
}

const listChangedContextPaths = (left: unknown, right: unknown, path = ""): string[] => {
  if (Object.is(left, right)) return [];
  if (Array.isArray(left) && Array.isArray(right)) {
    const length = Math.max(left.length, right.length);
    return Array.from({ length }, (_, index) => index).flatMap((index) =>
      listChangedContextPaths(left[index], right[index], `${path}[${index}]`),
    );
  }
  if (
    typeof left !== "object" ||
    left === null ||
    typeof right !== "object" ||
    right === null ||
    Array.isArray(left) !== Array.isArray(right)
  ) {
    return [path || "context"];
  }
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].flatMap((key) =>
    listChangedContextPaths(
      Reflect.get(left, key),
      Reflect.get(right, key),
      path ? `${path}.${key}` : key,
    ),
  );
};

const contextPayload = (context: VerificationContext): VerificationContextPayload => {
  const { fingerprint, ...payload } = context;
  const expectedFingerprint = createHash("sha256")
    .update(canonicalizeVerificationContextPayload(payload))
    .digest("hex");
  if (fingerprint !== expectedFingerprint) {
    throw new Error("verification context fingerprint does not match its payload");
  }
  return payload;
};

const loadBaseline = async (
  priorComparisonId: string,
): Promise<{
  priorEntry: ComparisonHistoryEntry & {
    result: ComparisonHistoryEntry["result"] & {
      diffReport: NonNullable<ComparisonHistoryEntry["result"]["diffReport"]>;
    };
  };
  priorContext: VerificationContext;
  priorPayload: VerificationContextPayload;
}> => {
  const priorEntry = await getComparisonEntry(priorComparisonId);
  if (!priorEntry?.result.diffReport) {
    throw new Error(`prior comparison not found: ${priorComparisonId}`);
  }
  const priorContext = priorEntry.result.verificationContext;
  if (!priorContext) {
    throw new Error(
      `baseline predates verification context: ${priorComparisonId}. ` +
        "run compare_design once more to record a usable baseline, then retry verify_fix.",
    );
  }
  let priorPayload: VerificationContextPayload;
  try {
    priorPayload = contextPayload(priorContext);
  } catch {
    throw new Error(
      `baseline verification context is invalid: ${priorComparisonId}. ` +
        "run compare_design once more to record a usable baseline, then retry verify_fix.",
    );
  }
  return {
    // 上のガードで diffReport は確定済み。プロパティ絞り込みはオブジェクト型へ
    // 伝播しないため、non-null が確定した result を明示的に組み直す。
    priorEntry: {
      ...priorEntry,
      result: { ...priorEntry.result, diffReport: priorEntry.result.diffReport },
    },
    priorContext,
    priorPayload,
  };
};

const runCurrentComparison = async (
  args: VerifyFixArguments,
  priorEntry: ComparisonHistoryEntry,
  priorContext: VerificationContext,
): Promise<CompareDesignRunOutput> => {
  return runCompareDesign({
    design_source: args.design_source,
    campaign_id: parseComparisonCampaignKey(priorEntry.sourceKey).campaignId,
    figma_contents_only: priorEntry.result.figmaExport?.conditions.contentsOnly,
    figma_use_absolute_bounds: priorEntry.result.figmaExport?.conditions.useAbsoluteBounds,
    screenshot: args.screenshot,
    frame_name: args.frame_name,
    threshold:
      args.threshold ??
      (args.profile === undefined ? priorContext.comparison.effectiveThreshold : undefined),
    profile: args.profile ?? priorContext.comparison.profile ?? undefined,
    project_id: args.project_id,
    ignore_regions: args.ignore_regions,
    design_background:
      args.design_background ??
      (priorContext.design.background === "#FFFFFF" ? undefined : priorContext.design.background),
    comparison_conditions: args.comparison_conditions ?? priorContext.comparison.declaredConditions,
  });
};

const assertMatchingContext = (
  priorComparisonId: string,
  priorPayload: VerificationContextPayload,
  currentContext: VerificationContext | undefined,
): void => {
  if (!currentContext) {
    throw new Error("current comparison did not record a verification context");
  }
  let currentPayload: VerificationContextPayload;
  try {
    currentPayload = contextPayload(currentContext);
  } catch {
    throw new Error("current comparison recorded an invalid verification context");
  }
  if (
    canonicalizeVerificationContextPayload(priorPayload) ===
    canonicalizeVerificationContextPayload(currentPayload)
  ) {
    return;
  }
  const changedPaths = listChangedContextPaths(priorPayload, currentPayload);
  throw new Error(
    `comparison context changed since baseline (${changedPaths.join(", ")}): ${priorComparisonId}. ` +
      "run compare_design once more under the current conditions, then retry verify_fix.",
  );
};

const requireMatchedRegions = (
  regionComparison: FixRegionComparison,
  priorComparisonId: string,
  expectedTargetNodeId: string,
): Extract<FixRegionComparison, { status: "matched" }> => {
  if (regionComparison.status === "ambiguous") {
    throw new Error(
      `ambiguous ${regionComparison.phase} region match: ${regionComparison.nodeId}. ` +
        `candidates: ${regionComparison.candidateRegionIds.join(", ")}`,
    );
  }
  if (
    regionComparison.status === "missing" &&
    regionComparison.currentRegion?.scope === "root" &&
    !regionComparison.previousRegion
  ) {
    throw new Error(
      `baseline predates the whole-frame row: ${priorComparisonId}. ` +
        "run compare_design once more to record a usable baseline, then retry verify_fix.",
    );
  }
  if (regionComparison.status === "missing") {
    const available =
      regionComparison.availableRegionIds.length > 0
        ? regionComparison.availableRegionIds.join(", ")
        : "(なし)";
    throw new Error(
      `target node not found in diff report: ${expectedTargetNodeId}. available: ${available}`,
    );
  }
  return regionComparison;
};

export function registerVerifyFix(server: McpServer): void {
  server.registerTool(
    "verify_fix",
    {
      description: DESCRIPTION,
      inputSchema: {
        design_source: z
          .string()
          .describe("FigmaのURL（node-id付き推奨）またはデザイン画像のローカルパス"),
        screenshot: z.string().describe("修正後スクリーンショットのローカルパス"),
        frame_name: z.string().optional().describe("Figma URLにnode-idがない場合のフレーム名"),
        threshold: z.number().min(0).max(1).optional().describe("pixelmatch の閾値"),
        profile: z.enum(["strict", "balanced", "layout"]).optional(),
        comparison_conditions: ComparisonConditionsInputSchema.optional(),
        design_background: z
          .string()
          .regex(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "design_background must be a hex color")
          .optional()
          .describe(
            "基準にした比較で指定した下地の色（#RRGGBB）。同じ値を渡さないと、白で置いた今回と別の色で置いた前回を比べることになり、直したのに改善なしと出る。",
          ),
        project_id: z
          .string()
          .optional()
          .describe("Crop Region と保存済み ignore_regions 適用用のプロジェクトID"),
        prior_comparison_id: z
          .string()
          .describe("比較対象にする過去の compare_design comparisonId"),
        expected_target_node_id: z.string().describe("修正したはずの figmaNodeId"),
        ignore_regions: z
          .array(IgnoreRegionSchema)
          .optional()
          .describe(
            "意図的差分マスク (compare_design と同じ形式)。project_id指定時は保存済みマスクと結合される。prior 比較で使った同じマスクを渡さないと、masked baseline と unmasked current の比較になり regression 判定が崩れる",
          ),
      },
      outputSchema: VerifyFixResultSchema,
    },
    async (args) => {
      try {
        const { priorEntry, priorContext, priorPayload } = await loadBaseline(
          args.prior_comparison_id,
        );
        const comparison = await runCurrentComparison(args, priorEntry, priorContext);

        if (!comparison.result.diffReport) {
          throw new Error("current comparison has no diffReport");
        }
        assertMatchingContext(
          args.prior_comparison_id,
          priorPayload,
          comparison.result.verificationContext,
        );

        const regionComparison = requireMatchedRegions(
          compareFixRegions(
            priorEntry.result.diffReport.regionScores,
            comparison.result.diffReport.regionScores,
            args.expected_target_node_id,
          ),
          args.prior_comparison_id,
          args.expected_target_node_id,
        );

        const {
          previousRegion,
          currentRegion,
          structureDelta,
          colorDelta,
          shapeDelta,
          sideEffects,
        } = regionComparison;

        const structuredContent = VerifyFixResultSchema.parse({
          fixedNode: args.expected_target_node_id,
          structureDelta,
          colorDelta,
          shapeDelta,
          verdict: buildVerdict(
            structureDelta,
            colorDelta,
            shapeDelta,
            previousRegion.color,
            currentRegion.color,
          ),
          comparisonStatus: comparison.result.status,
          sideEffects,
        });

        try {
          await writeActiveSession({
            comparisonId: comparison.result.comparisonId,
            // comparisonId ではなく比較対象の鍵を入れる (compare_design と同じ理由)。
            sourceKey: comparison.sourceKey,
            implementationUrl: undefined,
            designSource: args.design_source,
            matchRate: comparison.result.matchRate,
            status: resolveSessionStatus(
              structuredContent.comparisonStatus,
              structuredContent.verdict,
            ),
            updatedAt: Date.now(),
          });
        } catch {
          // non-critical
        }

        return {
          content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
          structuredContent,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  );
}

import { z } from "zod";

import { IgnoreRegionSchema, type RegionScore } from "@figdiff/shared";

import { writeActiveSession } from "../service/active-session.js";
import { runCompareDesign } from "../service/compare-design-runner.js";
import { getComparisonEntry } from "../service/comparison-history.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const VerifyFixResultSchema = z.object({
  fixedNode: z.string(),
  structureDelta: z.number(),
  colorDelta: z.number(),
  shapeDelta: z.number(),
  verdict: z.enum(["improved", "unchanged", "regressed"]),
  sideEffects: z.array(
    z.object({
      nodeId: z.string(),
      delta: z.number(),
    }),
  ),
});

const DESCRIPTION =
  "compare_design の前回比較と今回比較を突き合わせ、指定ノードが本当に改善したかと他セクションへの副作用を検証します。project_id 指定時は保存済み ignore_regions も適用します。";

function findRegion(regions: RegionScore[], targetNodeId: string): RegionScore | undefined {
  return regions.find((region) => (region.figmaNodeId ?? region.regionId) === targetNodeId);
}

const STRUCTURE_DELTA_THRESHOLD = 0.01;
// buildIssues() (diff-report-builder.ts) emits a critical "color" issue at
// color >= 2 — keep this gate on the same threshold so a change that pushes
// a region into compare_design's failing range is never simultaneously
// reported here as "unchanged".
const COLOR_DELTA_THRESHOLD = 2;
// The absolute value buildIssues fails on. Distinct from COLOR_DELTA_THRESHOLD
// above: a small delta (e.g. +0.6) can still cross this line (e.g. 1.5 -> 2.1)
// without the raw delta itself exceeding COLOR_DELTA_THRESHOLD. Checked
// separately in buildVerdict via currentColor/previousColor.
const COLOR_ABSOLUTE_FAIL_THRESHOLD = 2;
const SHAPE_DELTA_THRESHOLD = 0.01;
const SIDE_EFFECT_STRUCTURE_THRESHOLD = 0.05;

export function buildVerdict(
  structureDelta: number,
  colorDelta: number,
  shapeDelta: number,
  previousColor: number,
  currentColor: number,
): "improved" | "unchanged" | "regressed" {
  // A region that crosses from under compare_design's fail gate to at/over it
  // is a regression regardless of how small the raw delta looks.
  if (
    previousColor < COLOR_ABSOLUTE_FAIL_THRESHOLD &&
    currentColor >= COLOR_ABSOLUTE_FAIL_THRESHOLD
  ) {
    return "regressed";
  }

  if (
    structureDelta < -STRUCTURE_DELTA_THRESHOLD ||
    colorDelta > COLOR_DELTA_THRESHOLD ||
    shapeDelta > SHAPE_DELTA_THRESHOLD
  ) {
    return "regressed";
  }

  if (
    structureDelta > STRUCTURE_DELTA_THRESHOLD ||
    colorDelta < -COLOR_DELTA_THRESHOLD ||
    shapeDelta < -SHAPE_DELTA_THRESHOLD
  ) {
    return "improved";
  }

  return "unchanged";
}

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
        threshold: z.number().min(0).max(1).default(0.1).describe("pixelmatch の閾値"),
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
        const priorEntry = await getComparisonEntry(args.prior_comparison_id);
        if (!priorEntry?.result.diffReport) {
          throw new Error(`prior comparison not found: ${args.prior_comparison_id}`);
        }

        const comparison = await runCompareDesign({
          design_source: args.design_source,
          screenshot: args.screenshot,
          frame_name: args.frame_name,
          threshold: args.threshold,
          project_id: args.project_id,
          ignore_regions: args.ignore_regions,
        });

        if (!comparison.result.diffReport) {
          throw new Error("current comparison has no diffReport");
        }

        const previousRegion = findRegion(
          priorEntry.result.diffReport.regionScores,
          args.expected_target_node_id,
        );
        const currentRegion = findRegion(
          comparison.result.diffReport.regionScores,
          args.expected_target_node_id,
        );

        if (!previousRegion || !currentRegion) {
          throw new Error(`target node not found in diff report: ${args.expected_target_node_id}`);
        }

        const structureDelta = currentRegion.structure - previousRegion.structure;
        const colorDelta = currentRegion.color - previousRegion.color;
        const shapeDelta = currentRegion.shape - previousRegion.shape;
        const previousById = new Map<string, RegionScore>();

        for (const region of priorEntry.result.diffReport.regionScores) {
          previousById.set(region.figmaNodeId ?? region.regionId, region);
        }

        const sideEffects = comparison.result.diffReport.regionScores
          .filter(
            (region) => (region.figmaNodeId ?? region.regionId) !== args.expected_target_node_id,
          )
          .flatMap((region) => {
            const nodeId = region.figmaNodeId ?? region.regionId;
            const previous = previousById.get(nodeId);
            if (!previous) {
              return [];
            }

            const delta = region.structure - previous.structure;
            if (delta >= -SIDE_EFFECT_STRUCTURE_THRESHOLD) {
              return [];
            }

            return [{ nodeId, delta }];
          });

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
          sideEffects,
        });

        try {
          await writeActiveSession({
            comparisonId: comparison.result.comparisonId,
            sourceKey: comparison.result.comparisonId,
            implementationUrl: undefined,
            designSource: args.design_source,
            matchRate: comparison.result.matchRate,
            status: structuredContent.verdict === "improved" ? "PASS" : "FAIL",
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

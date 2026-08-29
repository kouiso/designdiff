import { z } from "zod";

import { IgnoreRegionSchema, normalizeNodeId, type RegionScore } from "@figdiff/shared";

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

// 比較全体が人間レビューへ回っているなら、対象ノードが良くなっていても PASS と
// 書かない。書くとセッションカードだけが合格を主張する。
export function resolveSessionStatus(
  comparisonStatus: "PASS" | "FAIL" | "UNCERTAIN",
  verdict: "improved" | "unchanged" | "regressed",
): "PASS" | "FAIL" | "UNCERTAIN" {
  if (comparisonStatus === "UNCERTAIN") return "UNCERTAIN";
  return verdict === "improved" ? "PASS" : "FAIL";
}

/**
 * 対象ノードの行を引く。
 *
 * Figma の URL から写した ID はハイフン区切り、保存側はコロン区切りで、
 * 素の文字列比較だと一生一致しない。
 *
 * 同じ矩形の兄弟は1件へまとめてある。まとめられて消えた側のIDも直し先として
 * 案内しているので、その名前でも引けるようにする。引けないと修正を確かめられない。
 */
function findRegion(regions: RegionScore[], targetNodeId: string): RegionScore | undefined {
  const target = normalizeNodeId(targetNodeId);
  const direct = regions.find(
    (region) => normalizeNodeId(region.figmaNodeId ?? region.regionId) === target,
  );
  if (direct) {
    return direct;
  }

  return regions.find((region) =>
    (region.overlappingNodeIds ?? []).some((nodeId) => normalizeNodeId(nodeId) === target),
  );
}

/** まとめた側も含めて、その行が指すID全部。副作用の重複判定に使う。 */
function regionNodeIds(region: RegionScore): string[] {
  return [region.figmaNodeId ?? region.regionId, ...(region.overlappingNodeIds ?? [])];
}

/**
 * 引けなかったときに何なら引けるのかを添える。名前だけ返すと、
 * 呼ぶ側は正解の名前が分からないまま総当たりで探し直すことになる。
 */
function describeAvailableRegionIds(regions: RegionScore[]): string {
  const ids = regions.flatMap(regionNodeIds);
  return ids.length > 0 ? ids.join(", ") : "(なし)";
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

// 各軸の delta をその軸の閾値で正規化した寄与に変換する。
// 閾値未満の変動はノイズとして 0 に落とす。符号は「改善が正」。
export function axisContribution(
  delta: number,
  threshold: number,
  higherIsBetter: boolean,
): number {
  if (threshold <= 0 || Math.abs(delta) <= threshold) {
    return 0;
  }
  const normalized = delta / threshold;
  return higherIsBetter ? normalized : -normalized;
}

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

  // 単一軸の悪化で regressed に短絡しない (issue #238)。グローバルなリフロー
  // 修正では shape が揺れやすく、structure/color の大きな改善が小さな shape
  // 悪化に打ち消される誤判定が実測で起きた。閾値正規化した寄与の合計で、
  // 軸間の改善と悪化を相殺してから判定する。
  const score =
    axisContribution(structureDelta, STRUCTURE_DELTA_THRESHOLD, true) +
    axisContribution(colorDelta, COLOR_DELTA_THRESHOLD, false) +
    axisContribution(shapeDelta, SHAPE_DELTA_THRESHOLD, false);

  if (score < 0) {
    return "regressed";
  }
  if (score > 0) {
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
          design_background: args.design_background,
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

        if (currentRegion && !previousRegion && currentRegion.scope === "root") {
          // 比較対象そのものの行は後から入った。それ以前に保存された比較には
          // この行が無く、画素はもう残っていないので後から足せない。
          // 何を直せばよいかを名指しで返し、探し直させない。
          throw new Error(
            `baseline predates the whole-frame row: ${args.prior_comparison_id}. ` +
              "run compare_design once more to record a usable baseline, then retry verify_fix.",
          );
        }

        if (!previousRegion || !currentRegion) {
          const available = describeAvailableRegionIds(comparison.result.diffReport.regionScores);
          throw new Error(
            `target node not found in diff report: ${args.expected_target_node_id}. ` +
              `available: ${available}`,
          );
        }

        const structureDelta = currentRegion.structure - previousRegion.structure;
        const colorDelta = currentRegion.color - previousRegion.color;
        const shapeDelta = currentRegion.shape - previousRegion.shape;
        const previousById = new Map<string, RegionScore>();

        // 引き当てと同じ表記へ揃える。片方だけ生の文字列で比べると、
        // 直した当人が「別の場所で悪化した」として二重に報告される。
        for (const region of priorEntry.result.diffReport.regionScores) {
          previousById.set(normalizeNodeId(region.figmaNodeId ?? region.regionId), region);
        }

        const normalizedTargetNodeId = normalizeNodeId(args.expected_target_node_id);
        const sideEffects = comparison.result.diffReport.regionScores
          // 比較対象そのものの行は全部の子と範囲が重なる。副作用として並べると、
          // 対象自身や既に報告済みの子が二重に出る。
          .filter((region) => region.scope !== "root")
          // まとめられて消えた側を直し先に選んだ場合も、その行は対象そのもの。
          .filter(
            (region) =>
              !regionNodeIds(region).some(
                (nodeId) => normalizeNodeId(nodeId) === normalizedTargetNodeId,
              ),
          )
          .flatMap((region) => {
            const nodeId = region.figmaNodeId ?? region.regionId;
            const previous = previousById.get(normalizeNodeId(nodeId));
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

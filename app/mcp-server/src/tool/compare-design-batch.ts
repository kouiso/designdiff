/**
 * compare_design_batch — 複数のフレーム/画面を1回の呼び出しでまとめて比べる。
 *
 * compare_design は1回で1枚しか受け取らんので、画面遷移系やフロー全体を確かめるには
 * 呼び出し側が画面数ぶん往復し、集約も自前で持つことになる。ここでは同じ比較経路へ
 * 入力順に1枚ずつ渡し、フレームごとの判定と全体の集計を1つの応答へ畳む。
 */

import { z } from "zod";

import {
  AnchorRegionSchema,
  ComparisonCampaignIdSchema,
  ComparisonConditionsInputSchema,
  IgnoreRegionSchema,
  type AnchorRegion,
  type IgnoreRegion,
} from "@figdiff/shared";

import { writeActiveSession } from "../service/active-session.js";
import {
  type BatchConvergence,
  type BatchFrameResult,
  type CompareBatchFrame,
  CompareDesignBatchResultSchema,
  type CompareDesignBatchResult,
  runBatchCompare,
} from "../service/batch-compare-service.js";
import { runCompareDesign, type CompareDesignRunArgs } from "../service/compare-design-runner.js";
import {
  assertFigdiffStorageWritable,
  isFigdiffStorageError,
  toFigdiffStorageErrorPayload,
} from "../service/storage-permission.js";
import { assertNoUnknownToolArguments } from "../util/raw-tool-arguments.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** 1回の呼び出しで受け取るフレーム数の上限。往復を畳むのが目的で、無限に積んでよい理由はない。 */
const MAX_BATCH_FRAMES = 10;

const DESIGN_BACKGROUND_PATTERN = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const PROFILE_VALUES = ["strict", "balanced", "layout"] as const;
type BatchProfile = (typeof PROFILE_VALUES)[number];

const DESCRIPTION = `複数のフレーム/画面を1回の呼び出しで入力順に比較し、フレームごとの判定と全体の集計を返します。

## 使い分け
- 1画面だけを直す: compare_design を使うこと。loopGuard と停止判定の粒度が1画面に合っとる
- 画面遷移系・フロー全体をまとめて見る: このツールに frames を並べて渡す
- すでに撮ってある実装画像をまとめて比べる: 各 frame に design_source と screenshot を指定する
- 動きの途中を時系列で見る: compare_animation を使うこと（こちらは静止した複数画面が対象）

## 入力
- frames: 比較する画面の配列（1〜${MAX_BATCH_FRAMES}件、必須）。各要素は compare_design と同じ指定に加えて label（任意の表示名）を持つ
  - 各 frame は screenshot / screenshot_url / capture_device のうち【どれか1つ】を指定すること
  - label 省略時は frame-1, frame-2 ... になる。指定する場合は重複させないこと（集計で区別できなくなる）
- threshold / profile / design_background / ignore_regions / anchors: 全フレーム共通の既定値。frame 側で指定した値が優先される（結合はしない）
- campaign_id / project_id / figma_contents_only / figma_use_absolute_bounds / mask_system_ui / auto_mask_dynamic / token_diff / local_alignment_tolerance_px / rasterization_tolerance: 全フレーム共通
- campaign_id は画面ごとに独立して履歴を進める（同じ画面の反復では同じIDを使い続ける）。同じ一括比較を繰り返すと、各画面の loopGuard がそれぞれ1歩ずつ進む

## 出力の読み方
- verdict: 全体判定。ERROR（実行できなかったフレームがある）> FAIL > UNCERTAIN > PASS の順で決まる
- status: フレームごとの判定。"PASS" / "FAIL" / "UNCERTAIN" に加えて "ERROR"（比較自体が実行できなかった）がある。ERROR は失敗ではなく未実行なので、直そうとせず入力を確認すること
- convergence: フレームごとの loopGuard を畳んだ収束判定。continue（続行可のフレームがある）/ blocked（成功以外で停止したか評価できない）/ converged（全フレームが PASS）/ unknown
- recurringIssues: 2フレーム以上に出た差分種別（color / position / size / missing / extra / typography）。同じ種別が複数画面に出た事実だけを返し、同一ノード・同一原因とは断定しない
- comparisonId: フレームごとの比較ID。全差分レポート（gridSummary/diffReport/全diffRegions）は generate_diff_report(comparison_id=...) で取得できる
- diffRegions: レスポンス肥大化を防ぐためフレームごとに上位3件のみ。全件は comparisonId から取得すること
- 入力順は保たれる。1件の実行エラーで残りのフレームは打ち切られない`;

const BatchFrameInputSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .optional()
    .describe("集計で使う表示名（省略時は frame-1, frame-2 ...）。重複不可。"),
  design_source: z
    .string()
    .describe(
      "FigmaのURL（node-id付き推奨）またはデザイン画像のローカルパス。compare_design と同じ解決規則。",
    ),
  screenshot: z.string().optional().describe("実装スクリーンショットのローカルパス。"),
  screenshot_url: z
    .string()
    .url()
    .optional()
    .describe("撮影対象のURL。指定時はPlaywrightで内部撮影する。"),
  capture_device: z
    .enum(["android", "ios-sim", "ios-device"])
    .optional()
    .describe("接続済みモバイル端末/SimulatorからPNGを撮影する。"),
  capture_device_serial: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("撮影対象のAndroid端末serial。capture_device: android と併用。"),
  capture_scroll: z
    .boolean()
    .optional()
    .describe("1画面に収まらん画面をスクロールしながら撮って縦長1枚へ繋ぐ。既定false。"),
  capture_width: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("撮影幅(px)。省略時はFigmaフレームの実幅を自動取得。screenshot_url指定時のみ有効。"),
  frame_name: z
    .string()
    .optional()
    .describe("Figma URLにnode-idが含まれない場合のフレーム名（省略可）。"),
  comparison_conditions: ComparisonConditionsInputSchema.optional().describe(
    "両画像の表示領域・倍率・共通原点の申告。compare_design と同じ意味。",
  ),
  ignore_regions: z
    .array(IgnoreRegionSchema)
    .optional()
    .describe("意図的差分マスク。指定時は共通既定を置き換える（結合しない）。"),
  anchors: z
    .array(AnchorRegionSchema)
    .optional()
    .describe("同幅・異高入力の位置整合検査。指定時は共通既定を置き換える（結合しない）。"),
  design_background: z
    .string()
    .regex(DESIGN_BACKGROUND_PATTERN, "design_background must be a hex color")
    .optional()
    .describe("背景の塗りが無いFigmaノードをどの色の上で評価するか（#RRGGBB）。"),
  threshold: z.number().min(0).max(1).optional().describe("色差の許容閾値（0-1）。"),
  profile: z
    .enum(PROFILE_VALUES)
    .optional()
    .describe("比較プロファイル（strict/balanced/layout）。"),
});

type BatchFrameInput = z.infer<typeof BatchFrameInputSchema>;

interface BatchSharedDefaults {
  project_id?: string;
  campaign_id?: string;
  threshold?: number;
  profile?: BatchProfile;
  design_background?: string;
  ignore_regions?: IgnoreRegion[];
  anchors?: AnchorRegion[];
  figma_contents_only?: boolean;
  figma_use_absolute_bounds?: boolean;
  mask_system_ui?: boolean;
  auto_mask_dynamic?: boolean;
  token_diff?: boolean;
  local_alignment_tolerance_px?: number;
  rasterization_tolerance?: boolean;
}

export interface BatchFrameRequestInput {
  index: number;
  label: string;
}

const defaultLabel = (index: number): string => `frame-${index + 1}`;

const countScreenshotSources = (frame: BatchFrameInput): number =>
  [frame.screenshot, frame.screenshot_url, frame.capture_device].filter(
    (source) => source !== undefined,
  ).length;

/**
 * 入力フレームを検証し、集計で使う表示名を確定する。
 * 構造的な誤りは1件でも比較を始める前に落とす。全部比較してから同じ誤りを
 * フレーム数ぶん返すより、呼び出し側が直すべき箇所が早く分かる。
 */
export const resolveBatchFrameRequests = (
  frames: readonly BatchFrameInput[],
): BatchFrameRequestInput[] => {
  const seenLabels = new Set<string>();
  return frames.map((frame, index) => {
    const label = frame.label ?? defaultLabel(index);
    if (countScreenshotSources(frame) !== 1) {
      throw new Error(
        `frames[${index}] (${label}): screenshot / screenshot_url / capture_device のうち、どれか1つだけを指定してください。`,
      );
    }
    if (seenLabels.has(label)) {
      throw new Error(
        `frames[${index}] の label "${label}" が重複しています。集計で区別できるよう一意にしてください。`,
      );
    }
    seenLabels.add(label);
    return { index, label };
  });
};

const buildRunArgs = (
  frame: BatchFrameInput,
  shared: BatchSharedDefaults,
): CompareDesignRunArgs => ({
  design_source: frame.design_source,
  screenshot: frame.screenshot,
  screenshot_url: frame.screenshot_url,
  capture_device: frame.capture_device,
  capture_device_serial: frame.capture_device_serial,
  capture_scroll: frame.capture_scroll,
  capture_width: frame.capture_width,
  frame_name: frame.frame_name,
  comparison_conditions: frame.comparison_conditions,
  // フレーム指定が共通既定を置き換える。結合すると、どの画面にどのマスクが効いたかを
  // 応答から読み解けなくなる。
  ignore_regions: frame.ignore_regions ?? shared.ignore_regions,
  anchors: frame.anchors ?? shared.anchors,
  threshold: frame.threshold ?? shared.threshold,
  profile: frame.profile ?? shared.profile,
  design_background: frame.design_background ?? shared.design_background,
  project_id: shared.project_id,
  campaign_id: shared.campaign_id,
  figma_contents_only: shared.figma_contents_only,
  figma_use_absolute_bounds: shared.figma_use_absolute_bounds,
  mask_system_ui: shared.mask_system_ui,
  auto_mask_dynamic: shared.auto_mask_dynamic,
  token_diff: shared.token_diff,
  local_alignment_tolerance_px: shared.local_alignment_tolerance_px,
  rasterization_tolerance: shared.rasterization_tolerance,
});

const CONVERGENCE_LABELS: Record<BatchConvergence["status"], string> = {
  converged: "収束",
  continue: "続行",
  blocked: "停止",
  unknown: "評価不能",
};

const describeFrameResult = (frame: BatchFrameResult): string => {
  if (frame.status === "ERROR") {
    return `ERROR 比較できませんでした: ${frame.error ?? "理由不明"}`;
  }
  const parts: string[] = [frame.status];
  if (frame.matchRate !== undefined) {
    parts.push(`一致 ${frame.matchRate.toFixed(2)}%`);
  }
  if (frame.verdictRoute !== undefined) {
    parts.push(`判定経路 ${frame.verdictRoute}`);
  }
  if (frame.remainingIssues !== undefined) {
    parts.push(`残課題 ${frame.remainingIssues} 領域`);
  }
  if (frame.comparisonId !== undefined) {
    parts.push(`(${frame.comparisonId})`);
  }
  return parts.join(" ");
};

// 集約サマリーは buildSummaryText と同じトーンに合わせる。結論を先頭に置き、
// 内訳と次に取れる行動（レポート取得）を後ろへ並べる。
export const buildBatchSummaryText = (result: CompareDesignBatchResult): string => {
  const lines: string[] = [];
  lines.push(
    `一括判定: ${result.verdict} (${result.totalFrames} フレーム中 PASS ${result.passCount} / FAIL ${result.failCount} / UNCERTAIN ${result.uncertainCount} / ERROR ${result.errorCount})`,
  );
  lines.push(
    `収束判定: ${CONVERGENCE_LABELS[result.convergence.status]} — ${result.convergence.message}`,
  );

  lines.push("", "フレームごとの結果:");
  for (const frame of result.frames) {
    lines.push(`  [${frame.index + 1}] ${frame.label}: ${describeFrameResult(frame)}`);
  }

  if (result.recurringIssues.length > 0) {
    lines.push(
      "",
      "共通差分（2フレーム以上に出た差分種別。同一ノード・同一原因とは断定していません）:",
    );
    for (const issue of result.recurringIssues) {
      lines.push(
        `  - ${issue.kind} (${issue.severities.join("/")}): ${issue.frameCount} フレーム (${issue.frameLabels.join(", ")})`,
      );
    }
  }

  lines.push(
    "",
    "全差分レポート（gridSummary/diffReport含む）は generate_diff_report(comparison_id=...) で取得可能。comparisonId はフレームごとの結果に含まれる。",
  );
  return lines.join("\n");
};

export const registerCompareDesignBatch = (server: McpServer): void => {
  const inputSchema = {
    frames: z
      .array(BatchFrameInputSchema)
      .min(1)
      .max(MAX_BATCH_FRAMES)
      .describe(`比較する画面の配列（1〜${MAX_BATCH_FRAMES}件、入力順に逐次比較）。`),
    campaign_id: ComparisonCampaignIdSchema.optional().describe(
      "修正キャンペーンのID。同じ作業の反復では同じIDを使い、画面ごとに独立した履歴を進める。",
    ),
    project_id: z
      .string()
      .regex(/^[a-zA-Z0-9_-]+$/, "Project ID must be alphanumeric with hyphens/underscores only")
      .optional()
      .describe(
        "Crop Region・保存済み ignore_regions・前回使用ノードの自動補完に使うプロジェクトID。",
      ),
    threshold: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("全フレーム共通の色差許容閾値（0-1）。frame 側の指定が優先される。"),
    profile: z
      .enum(PROFILE_VALUES)
      .optional()
      .describe("全フレーム共通の比較プロファイル。frame 側の指定が優先される。"),
    design_background: z
      .string()
      .regex(DESIGN_BACKGROUND_PATTERN, "design_background must be a hex color")
      .optional()
      .describe("全フレーム共通の背景色。frame 側の指定が優先される。"),
    ignore_regions: z
      .array(IgnoreRegionSchema)
      .optional()
      .describe("全フレーム共通の意図的差分マスク。frame 側の指定が優先される（結合しない）。"),
    anchors: z
      .array(AnchorRegionSchema)
      .optional()
      .describe("全フレーム共通の位置整合検査。frame 側の指定が優先される（結合しない）。"),
    figma_contents_only: z
      .boolean()
      .optional()
      .describe(
        "Figma書き出しで対象ノードの内容だけを含める（既定false: ノード自身の背景塗りも書き出す）。",
      ),
    figma_use_absolute_bounds: z
      .boolean()
      .optional()
      .describe("Figma書き出しにノード全体の境界を使う（既定true）。"),
    mask_system_ui: z
      .boolean()
      .optional()
      .describe("モバイル実機/Simulator撮影のOSバーを自動マスクする。"),
    auto_mask_dynamic: z
      .boolean()
      .optional()
      .describe("screenshot_url経路で撮るたびに変わる領域を自動マスクする（既定true）。"),
    token_diff: z
      .boolean()
      .optional()
      .describe("screenshot_url + Figma URL で色・文字を値そのもので突き合わせる（既定true）。"),
    local_alignment_tolerance_px: z
      .number()
      .int()
      .min(0)
      .max(10)
      .optional()
      .describe("採点領域ごとの局所平行移動の許容上限（px、opt-in）。"),
    rasterization_tolerance: z
      .boolean()
      .optional()
      .describe("same-token-rasterization 分類を合否に効かせるかの opt-in（既定false）。"),
  };

  server.registerTool(
    "compare_design_batch",
    {
      description: DESCRIPTION,
      inputSchema,
      outputSchema: CompareDesignBatchResultSchema,
    },
    async (args, extra) => {
      try {
        // strict schema では SDK の汎用エラーに変わるだけで誤記を案内できないため、
        // parse 前に transport が保存した引数名を shape と照合する。
        assertNoUnknownToolArguments("compare_design_batch", Object.keys(inputSchema), extra);
        // 入力の構造的な誤りは保存先を触る前に落とす。storage エラーと混ざると、
        // 呼び出し側が直すべき箇所を取り違える。
        const requests = resolveBatchFrameRequests(args.frames);
        await assertFigdiffStorageWritable();

        const shared: BatchSharedDefaults = {
          project_id: args.project_id,
          campaign_id: args.campaign_id,
          threshold: args.threshold,
          profile: args.profile,
          design_background: args.design_background,
          ignore_regions: args.ignore_regions,
          anchors: args.anchors,
          figma_contents_only: args.figma_contents_only,
          figma_use_absolute_bounds: args.figma_use_absolute_bounds,
          mask_system_ui: args.mask_system_ui,
          auto_mask_dynamic: args.auto_mask_dynamic,
          token_diff: args.token_diff,
          local_alignment_tolerance_px: args.local_alignment_tolerance_px,
          rasterization_tolerance: args.rasterization_tolerance,
        };

        const compareOne: CompareBatchFrame = async (request) => {
          const frame = args.frames[request.index];
          const comparison = await runCompareDesign(buildRunArgs(frame, shared));
          const result = comparison.result;

          try {
            await writeActiveSession({
              comparisonId: result.comparisonId,
              sourceKey: comparison.sourceKey,
              implementationUrl: frame.screenshot_url,
              designSource: frame.design_source,
              designImagePath:
                comparison.parsedDesignSource.type === "local_path"
                  ? comparison.parsedDesignSource.filePath
                  : undefined,
              matchRate: result.matchRate,
              status: result.status ?? "FAIL",
              updatedAt: Date.now(),
            });
          } catch (e: unknown) {
            // 一括比較の結果は active session に依存せん。書けんでも比較は成立する。
            console.warn(
              "[compare_design_batch] active-session save failed:",
              e instanceof Error ? e.message : e,
            );
          }

          return {
            status: result.status ?? "UNCERTAIN",
            matchRate: result.matchRate,
            diffPixelCount: result.diffPixelCount,
            comparisonId: result.comparisonId,
            diffImagePath: result.diffImagePath,
            verdictRoute: result.verdictRoute,
            loopGuard: result.loopGuard,
            remainingIssues: result.remainingIssues,
            issues: (result.diffReport?.issues ?? []).map((issue) => ({
              kind: issue.kind,
              severity: issue.severity,
            })),
            nextAction: result.nextAction,
            diffRegions: result.diffRegions,
          };
        };

        const result = CompareDesignBatchResultSchema.parse(
          await runBatchCompare(requests, compareOne),
        );

        const content: { type: "text"; text: string }[] = [
          // 互換性のため最初の text ブロックは JSON、人間可読サマリは末尾に置く（compare_design と同じ）。
          { type: "text", text: JSON.stringify(result, null, 2) },
          { type: "text", text: buildBatchSummaryText(result) },
        ];
        return { content, structuredContent: result };
      } catch (error) {
        if (isFigdiffStorageError(error)) {
          const payload = toFigdiffStorageErrorPayload(error);
          return {
            content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
            isError: true,
          };
        }
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  );
};

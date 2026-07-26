/**
 * compare_design — Primary MCP Tool
 * Pixel-level diff between Figma design and implementation screenshot.
 * AI should ALWAYS start with this tool.
 */

import { z } from "zod";

import {
  CompareDesignResultSchema,
  IgnoreRegionSchema,
  type CompareDesignResult,
} from "@figdiff/shared";

import { writeActiveSession } from "../service/active-session.js";
import { runCompareDesign } from "../service/compare-design-runner.js";
import { MAX_LOOP_ITERATIONS } from "../service/loop-guard-service.js";
import { persistDetailJson } from "../service/persist-detail.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const MAX_INLINE_DIFF_REGIONS = 20;

const DESCRIPTION = `デザインと実装のピクセル差分を検出します。

## 使用条件
- 実装のCSS/HTML修正時は【必ず】このツールを最初に実行すること
- status が "FAIL" の場合、inspect_node で詳細を取得し修正すること
- status が "PASS" になるまでループすること。matchRate% は参考値であり、完成ゲートではない

## 出力の読み方
- status: "PASS" = 構造SSIM判定上の完了。"FAIL" = 修正またはレビューが必要
- completionCriteria: blocking=true の項目が "PASS" になるまで作業を続行。matchRate は参考値
- nextAction: 次に実行すべきアクション（従うこと）
- diffImagePath: 差分画像のローカルパス。Read ツールで開いて視覚確認できる（~/.figdiff/results/ に保存）
- diffRegions: 差分領域。レスポンス肥大化を防ぐため上位20件のみ。全件は regionsDetailPath のJSONファイルを参照

## 入力
- design_source: Figma URL（node-id付き推奨） or ローカル画像パス（ローカル画像はカレントディレクトリまたは ~/.figdiff/cache 配下。追加は FIGDIFF_ALLOWED_DIRS）
- screenshot: 実装スクリーンショットのローカルパス（screenshot_url / capture_device 使用時は省略可）
- screenshot_url: 撮影対象URL。指定時はPlaywrightで内部撮影しscreenshotの代わりに使用
- capture_device: 接続済みモバイル端末/SimulatorからPNGを撮影しscreenshotの代わりに使用（android/ios-sim/ios-device）。既定でOSステータスバー/ナビゲーションバーを ignore_regions として自動マスク
- capture_width: 撮影幅(px)。省略時はFigmaフレームの実幅を自動取得（screenshot_url指定時のみ有効）
- threshold: 色差の許容閾値（0-1）。profile を指定した場合はそちらが既定値になる
- profile: 比較プロファイル（strict/balanced/layout）。threshold 直接指定で上書き可
- project_id: Crop Region・ignore_regions・前回使用ノード自動補完に使うプロジェクトID（省略可）
- ignore_regions: 既知の意図的差分マスク（省略可）。project_id の保存済みマスク、自動 system UI マスクと結合される。WP原文 vs Figmaプレースホルダ、Google Map埋め込み等の false-positive 抑制に使用。各矩形 {x,y,width,height,label?} 内のピクセルは差分検出/matchRate 分母から除外される
- mask_system_ui: モバイル実機/Simulator撮影のOSステータスバー/ナビゲーションバーを自動マスクするか。capture_device指定時は既定true、それ以外は既定false。set_ignore_regionsで追加の微調整が可能

## Figma URLの例
  "https://www.figma.com/design/ABC123/File?node-id=1-23"
  "https://www.figma.com/design/ABC123/File"

## ローカルパスの例
  "./design/home.png"
  "./screenshots/home.png"

ローカルの design_source はカレントディレクトリまたは ~/.figdiff/cache 配下に置くか、FIGDIFF_ALLOWED_DIRS で許可ディレクトリを追加してください。screenshot のローカルパスはこの allowlist の対象外です。`;

const CONFIDENCE_TO_PERCENTAGE = 100;

function buildDiagnosisLines(result: CompareDesignResult, hasPriorLines: boolean): string[] {
  if (!result.diagnosis) {
    return [];
  }
  const lines: string[] = hasPriorLines ? [""] : [];
  lines.push(result.diagnosis.headline);
  if (result.diagnosis.likelyMisconfig && result.diagnosis.rankedCauses.length > 0) {
    lines.push("", "推定原因（確度順）:");
    for (const cause of result.diagnosis.rankedCauses) {
      lines.push(
        `- [${Math.round(cause.confidence * CONFIDENCE_TO_PERCENTAGE)}%] ${cause.message} → ${cause.suggestedFix}`,
      );
    }
  }
  return lines;
}

function buildPreflightWarningLines(result: CompareDesignResult): string[] {
  const warnings = result.preflight?.warnings ?? [];
  if (warnings.length === 0) {
    return [];
  }
  const lines: string[] = ["", "Pre-flight 警告:"];
  for (const warning of warnings) {
    const fix = warning.suggestedFix ? ` → ${warning.suggestedFix}` : "";
    lines.push(`- [${warning.severity}] ${warning.message}${fix}`);
  }
  return lines;
}

function buildNormalizationLines(result: CompareDesignResult): string[] {
  if (!result.normalization) {
    return [];
  }
  const { designNativeWidth, designNativeHeight, screenshotWidth, screenshotHeight, appliedScale } =
    result.normalization;
  const lines: string[] = [
    "",
    `画像サイズ: design ${designNativeWidth}×${designNativeHeight} / screenshot ${screenshotWidth}×${screenshotHeight} / scale ${appliedScale.toFixed(2)}`,
  ];
  const ratio = screenshotWidth > 0 ? designNativeWidth / screenshotWidth : 1;
  if (ratio < 0.9 || ratio > 1.1) {
    lines.push(`  解像度差 約${ratio.toFixed(2)}x を正規化（軽微なボケが diff に乗る可能性）`);
  }
  if (result.normalization.autoCropped) {
    lines.push(
      `  スクリーンショットがdesignフレーム高を超えていたため、自動でフレーム範囲 (${designNativeWidth}×${designNativeHeight}) にcropして比較しました`,
    );
  }
  return lines;
}

// 並び順は「結論 → 原因 → 内訳 → 警告」。AI/ユーザーが最初の数行で
// 「実差分か設定ミスか」を即断でき、likely_misconfig の時だけ確度順に原因を
// 列挙して最優先の対処に誘導するため、この順序と簡潔な箇条書き形式にしている。
export function buildSummaryText(result: CompareDesignResult): string {
  const lines: string[] = [];

  lines.push(...buildLoopGuardLines(result));

  if (result.diffReport) {
    if (lines.length > 0) lines.push("");
    lines.push(`構造SSIM判定: ${result.diffReport.aggregateVerdict.toUpperCase()}`);
    lines.push(result.diffReport.rationale);
  }

  lines.push(...buildDiagnosisLines(result, lines.length > 0));

  if (result.comparisonHeadline) {
    lines.push("", result.comparisonHeadline.headline);
  }

  lines.push(...buildPreflightWarningLines(result));
  lines.push(...buildNormalizationLines(result));
  lines.push(...buildMaskCandidateLines(result));

  return lines.join("\n");
}

// loopGuard は structuredContent にしか載っておらず、テキスト出力を読む AI からは
// 見えていなかった。停止判定が実装済みなのに使われない直接原因だったため、最初の1行に
// 出す。末尾に置くと長い出力で読み飛ばされ、同じ状態に戻る。
function buildLoopGuardLines(result: CompareDesignResult): string[] {
  const guard = result.loopGuard;
  // compare_design は必ず停止判定を評価するので、undefined は「評価に失敗した」を意味する
  // (状態ファイルが書けない等)。黙って行を落とすと停止判定が見えない元の状態に戻るため、
  // 失敗した事実を出して人間の判断へ回す。
  if (!guard) {
    return [
      "ループ判定: 取得できません (停止判定の評価に失敗しました)",
      "自動修正を続けず、現状を人間に報告してください。~/.figdiff/loop-state/ に書き込めない可能性があります。",
    ];
  }

  const verdict = guard.decision === "stop" ? "停止" : "続行";
  // iteration は上限を超えて増え続けるため "6/5 回" のような読み手を混乱させる分数を
  // 出さない。上限は続行中だけ残量の目安として意味を持つ。
  const progress =
    guard.decision === "stop"
      ? `反復 ${guard.iteration} 回目`
      : `反復 ${guard.iteration} 回目 / 上限 ${MAX_LOOP_ITERATIONS}`;
  // 区切りの空行は後続セクションが自分の前に足す規約なので、ここでは足さない。
  return [`ループ判定: ${verdict} (${progress})`, guard.reason];
}

function buildMaskCandidateLines(result: CompareDesignResult): string[] {
  const report = result.diffReport;
  if (!report || report.aggregateVerdict === "pass") return [];

  const candidates = report.regionScores.filter(
    (r) => (r.textureScore ?? 0) > 0.5 || (r.structure >= 0.9 && r.color < 0.7),
  );

  if (candidates.length === 0) return [];

  const lines = ["", "マスク候補（意図的差分の可能性・採否はAIループが判断）:"];
  for (const c of candidates) {
    const reason =
      (c.textureScore ?? 0) > 0.5
        ? `texture=${(c.textureScore ?? 0).toFixed(2)} (写真/画像領域)`
        : `structure=${c.structure.toFixed(2)} / color=${c.color.toFixed(2)} (意図的な色差)`;
    lines.push(
      `  - ${c.regionId}: {x:${c.bbox.x},y:${c.bbox.y},w:${c.bbox.w},h:${c.bbox.h}} (${reason})`,
    );
    lines.push(
      `    → set_ignore_regions(label:"${c.regionId}-intentional", x:${c.bbox.x}, y:${c.bbox.y}, width:${c.bbox.w}, height:${c.bbox.h})`,
    );
  }
  return lines;
}

export function registerCompareDesign(server: McpServer): void {
  server.registerTool(
    "compare_design",
    {
      description: DESCRIPTION,
      inputSchema: {
        design_source: z
          .string()
          .describe(
            "FigmaのURL（node-id付き推奨）またはデザイン画像のローカルパス。ローカル画像はカレントディレクトリまたは ~/.figdiff/cache 配下、または FIGDIFF_ALLOWED_DIRS で追加した許可ディレクトリ配下に置く。",
          ),
        screenshot: z
          .string()
          .optional()
          .describe(
            "実装スクリーンショットのローカルパス（screenshot_url / capture_device 使用時は省略可）",
          ),
        screenshot_url: z
          .string()
          .url()
          .optional()
          .describe(
            "撮影対象のURL。指定時はPlaywrightで内部撮影し、screenshotの代わりに使用する。screenshot / screenshot_url / capture_device のいずれか一つを指定。別ネットワーク環境（WSL/サンドボックス）でlocalhost到達が失敗する場合は環境変数FIGDIFF_CDP_ENDPOINTにホストChromeのCDPアドレスを設定してください。",
          ),
        capture_device: z
          .enum(["android", "ios-sim", "ios-device"])
          .optional()
          .describe(
            "接続済みモバイル端末/SimulatorからPNGを撮影し、screenshotの代わりに使用する。android=adb、ios-sim=xcrun simctl、ios-device=pymobiledevice3。",
          ),
        capture_width: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "撮影幅(px)。省略時はFigmaフレームの実幅を自動取得。screenshot_url指定時のみ有効。",
          ),
        mask_system_ui: z
          .boolean()
          .optional()
          .describe(
            "モバイル実機/Simulator撮影のOSステータスバー/ナビゲーションバーを自動ignore_regions化する。capture_device指定時は既定true、それ以外は既定false。",
          ),
        frame_name: z
          .string()
          .optional()
          .describe("Figma URLにnode-idが含まれない場合のフレーム名（省略可）"),
        threshold: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe(
            "色差の許容閾値（0-1）。直接指定時は profile より優先される。省略時は profile の値か 0.1。",
          ),
        profile: z
          .enum(["strict", "balanced", "layout"])
          .optional()
          .describe(
            "比較プロファイル。strict=完全一致(threshold 0)、balanced=通常(threshold 0.1、省略時のデフォルト)、layout=構造のみ(threshold 0.4)。threshold を直接指定した場合はそちらが優先される。",
          ),
        project_id: z
          .string()
          .regex(
            /^[a-zA-Z0-9_-]+$/,
            "Project ID must be alphanumeric with hyphens/underscores only",
          )
          .optional()
          .describe(
            "Crop Region・保存済み ignore_regions・前回使用ノードの自動補完に使うプロジェクトID（省略可）",
          ),
        ignore_regions: z
          .array(IgnoreRegionSchema)
          .optional()
          .describe(
            "意図的差分マスク。project_id指定時は保存済みマスクと結合される。各矩形{x,y,width,height,label?}内のピクセルは差分検出/matchRate分母から除外。座標系はcrop適用後のscreenshotピクセル座標。",
          ),
      },
      outputSchema: CompareDesignResultSchema,
    },
    async (args) => {
      try {
        const comparison = await runCompareDesign(args);
        const result = comparison.result;

        const allRegions = result.diffRegions ?? [];
        const sortedRegions = [...allRegions].sort(
          (a, b) => (b.diffPixelCount ?? 0) - (a.diffPixelCount ?? 0),
        );
        const truncated = sortedRegions.length > MAX_INLINE_DIFF_REGIONS;
        const inlineRegions = truncated
          ? sortedRegions.slice(0, MAX_INLINE_DIFF_REGIONS)
          : sortedRegions;
        const regionsDetailPath = truncated
          ? await persistDetailJson(sortedRegions, `${result.comparisonId}.regions`)
          : undefined;

        const resultData = CompareDesignResultSchema.parse({
          ...result,
          diffImagePath: result.diffImagePath,
          diffImageBase64: undefined,
          diffRegions: inlineRegions,
          totalRegionCount: allRegions.length,
          returnedRegionCount: inlineRegions.length,
          regionsTruncated: truncated,
          regionsDetailPath,
        });

        try {
          const designImagePath =
            comparison.parsedDesignSource.type === "local_path"
              ? comparison.parsedDesignSource.filePath
              : undefined;
          await writeActiveSession({
            comparisonId: resultData.comparisonId,
            sourceKey: resultData.comparisonId,
            implementationUrl: args.screenshot_url ?? undefined,
            designSource: args.design_source,
            designImagePath,
            matchRate: resultData.matchRate,
            status: resultData.status ?? "FAIL",
            updatedAt: Date.now(),
          });
        } catch {
          // non-critical
        }

        const content: { type: "text"; text: string }[] = [];

        // 互換性のため最初の text ブロックは JSON のまま維持し、
        // 確信度レイヤーの人間可読サマリ（設定ミス診断・構造/色分離・警告）は末尾に置く。
        const slimResultData = {
          ...resultData,
          gridSummary: undefined,
          diffReport: undefined,
        };

        content.push({
          type: "text",
          text: JSON.stringify(slimResultData, null, 2),
        });

        const summaryText = buildSummaryText(result);
        const hintLine = `全差分レポート（gridSummary/diffReport含む）は generate_diff_report(comparison_id="${result.comparisonId}") で取得可能。`;
        const fullSummary = summaryText.length > 0 ? `${summaryText}\n\n${hintLine}` : hintLine;
        content.push({ type: "text", text: fullSummary });

        return { content, structuredContent: slimResultData };
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

/**
 * compare_design — Primary MCP Tool
 * Pixel-level diff between Figma design and implementation screenshot.
 * AI should ALWAYS start with this tool.
 */

import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";

import { z } from "zod";

import {
  CompareDesignResultSchema,
  IgnoreRegionSchema,
  type CompareDesignResult,
} from "@figdiff/shared";

import { writeActiveSession } from "../service/active-session.js";
import { runCompareDesign } from "../service/compare-design-runner.js";
import { persistDetailJson } from "../service/persist-detail.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const MAX_INLINE_DIFF_REGIONS = 20;

const DESCRIPTION = `デザインと実装のピクセル差分を検出します。

## 使用条件
- 実装のCSS/HTML修正時は【必ず】このツールを最初に実行すること
- status が "FAIL" の場合、inspect_node で詳細を取得し修正すること
- matchRate が 100 かつ status が "PASS" になるまでループすること

## 出力の読み方
- status: "PASS" = 完了。"FAIL" = 修正が必要
- completionCriteria: 各項目が "PASS" になるまで作業を続行
- nextAction: 次に実行すべきアクション（従うこと）
- diffImagePath: 差分画像のローカルパス。Read ツールで開いて視覚確認できる（~/.figdiff/results/ に保存）
- diffRegions: 差分領域。レスポンス肥大化を防ぐため上位20件のみ。全件は regionsDetailPath のJSONファイルを参照

## 入力
- design_source: Figma URL（node-id付き推奨） or ローカル画像パス
- screenshot: 実装スクリーンショットのローカルパス（screenshot_url 使用時はプレースホルダ文字列で可）
- screenshot_url: 撮影対象URL。指定時はPlaywrightで内部撮影しscreenshotの代わりに使用
- capture_width: 撮影幅(px)。省略時はFigmaフレームの実幅を自動取得（screenshot_url指定時のみ有効）
- threshold: 色差の許容閾値（0-1）。profile を指定した場合はそちらが既定値になる
- profile: 比較プロファイル（strict/balanced/layout）。threshold 直接指定で上書き可
- project_id: Crop Region・ignore_regions・前回使用ノード自動補完に使うプロジェクトID（省略可）
- ignore_regions: 既知の意図的差分マスク（省略可）。project_id の保存済みマスクと結合される。WP原文 vs Figmaプレースホルダ、Google Map埋め込み等の false-positive 抑制に使用。各矩形 {x,y,width,height,label?} 内のピクセルは差分検出/matchRate 分母から除外される

## Figma URLの例
  "https://www.figma.com/design/ABC123/File?node-id=1-23"
  "https://www.figma.com/design/ABC123/File"

## ローカルパスの例
  "/path/to/design.png"
  "./screenshots/home.png"`;

const CONFIDENCE_TO_PERCENTAGE = 100;

// 並び順は「結論 → 原因 → 内訳 → 警告」。AI/ユーザーが最初の数行で
// 「実差分か設定ミスか」を即断でき、likely_misconfig の時だけ確度順に原因を
// 列挙して最優先の対処に誘導するため、この順序と簡潔な箇条書き形式にしている。
export function buildSummaryText(result: CompareDesignResult): string {
  const lines: string[] = [];

  if (result.diagnosis) {
    lines.push(result.diagnosis.headline);
    if (result.diagnosis.likelyMisconfig && result.diagnosis.rankedCauses.length > 0) {
      lines.push("");
      lines.push("推定原因（確度順）:");
      for (const cause of result.diagnosis.rankedCauses) {
        lines.push(
          `- [${Math.round(cause.confidence * CONFIDENCE_TO_PERCENTAGE)}%] ${cause.message} → ${cause.suggestedFix}`,
        );
      }
    }
  }

  if (result.comparisonHeadline) {
    lines.push("");
    lines.push(result.comparisonHeadline.headline);
  }

  const warnings = result.preflight?.warnings ?? [];
  if (warnings.length > 0) {
    lines.push("");
    lines.push("Pre-flight 警告:");
    for (const warning of warnings) {
      const fix = warning.suggestedFix ? ` → ${warning.suggestedFix}` : "";
      lines.push(`- [${warning.severity}] ${warning.message}${fix}`);
    }
  }

  if (result.normalization) {
    const {
      designNativeWidth,
      designNativeHeight,
      screenshotWidth,
      screenshotHeight,
      appliedScale,
    } = result.normalization;
    lines.push("");
    lines.push(
      `画像サイズ: design ${designNativeWidth}×${designNativeHeight} / screenshot ${screenshotWidth}×${screenshotHeight} / scale ${appliedScale.toFixed(2)}`,
    );
    const ratio = screenshotWidth > 0 ? designNativeWidth / screenshotWidth : 1;
    if (ratio < 0.9 || ratio > 1.1) {
      lines.push(`  解像度差 約${ratio.toFixed(2)}x を正規化（軽微なボケが diff に乗る可能性）`);
    }
  }

  return lines.join("\n");
}

async function persistDiffImage(base64Data: string, comparisonId: string): Promise<string> {
  const directoryPath = path.join(homedir(), ".figdiff", "results");
  await fs.mkdir(directoryPath, { recursive: true });
  const filePath = path.join(directoryPath, `${comparisonId}.png`);
  await fs.writeFile(filePath, Buffer.from(base64Data, "base64"));
  return filePath;
}

export function registerCompareDesign(server: McpServer): void {
  server.registerTool(
    "compare_design",
    {
      description: DESCRIPTION,
      inputSchema: {
        design_source: z
          .string()
          .describe("FigmaのURL（node-id付き推奨）またはデザイン画像のローカルパス"),
        screenshot: z
          .string()
          .describe(
            "実装スクリーンショットのローカルパス（screenshot_url使用時はプレースホルダ文字列で可）",
          ),
        screenshot_url: z
          .string()
          .url()
          .optional()
          .describe(
            "撮影対象のURL。指定時はPlaywrightで内部撮影し、screenshotの代わりに使用する。screenshotとどちらか一方を指定。",
          ),
        capture_width: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "撮影幅(px)。省略時はFigmaフレームの実幅を自動取得。screenshot_url指定時のみ有効。",
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
        const diffImagePath =
          result.diffImageBase64 && result.matchRate < 100
            ? await persistDiffImage(result.diffImageBase64, result.comparisonId)
            : undefined;

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
          diffImagePath,
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
            status: resultData.status === "PASS" ? "PASS" : "FAIL",
            updatedAt: Date.now(),
          });
        } catch {
          // non-critical
        }

        const content: { type: "text"; text: string }[] = [];

        // 互換性のため最初の text ブロックは JSON のまま維持し、
        // 確信度レイヤーの人間可読サマリ（設定ミス診断・構造/色分離・警告）は末尾に置く。
        content.push({
          type: "text",
          text: JSON.stringify(resultData, null, 2),
        });

        const summaryText = buildSummaryText(result);
        if (summaryText.length > 0) {
          content.push({ type: "text", text: summaryText });
        }

        return { content, structuredContent: resultData };
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

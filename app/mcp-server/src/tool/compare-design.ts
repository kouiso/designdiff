/**
 * compare_design — Primary MCP Tool
 * Pixel-level diff between Figma design and implementation screenshot.
 * AI should ALWAYS start with this tool.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { z } from "zod";

import { CompareDesignResultSchema, IgnoreRegionSchema } from "@figdiff/shared";

import { runCompareDesign } from "../service/compare-design-runner.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const DESCRIPTION = `デザインと実装のピクセル差分を検出します。

## 使用条件
- 実装のCSS/HTML修正時は【必ず】このツールを最初に実行すること
- status が "FAIL" の場合、inspect_node で詳細を取得し修正すること
- matchRate が 100 かつ status が "PASS" になるまでループすること

## 出力の読み方
- status: "PASS" = 完了。"FAIL" = 修正が必要
- completionCriteria: 各項目が "PASS" になるまで作業を続行
- nextAction: 次に実行すべきアクション（従うこと）

## 入力
- design_source: Figma URL（node-id付き推奨） or ローカル画像パス
- screenshot: 実装スクリーンショットのローカルパス
- threshold: 色差の許容閾値（0-1、デフォルト0.1）
- ignore_regions: 既知の意図的差分マスク（省略可）。WP原文 vs Figmaプレースホルダ、Google Map埋め込み等の false-positive 抑制に使用。各矩形 {x,y,width,height,label?} 内のピクセルは差分検出/matchRate 分母から除外される

## Figma URLの例
  "https://www.figma.com/design/ABC123/File?node-id=1-23"
  "https://www.figma.com/design/ABC123/File"

## ローカルパスの例
  "/path/to/design.png"
  "./screenshots/home.png"`;

async function persistDiffImage(base64Data: string, comparisonId: string): Promise<string> {
  const directoryPath = path.join(os.tmpdir(), "figdiff-mcp");
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
        screenshot: z.string().describe("実装スクリーンショットのローカルパス"),
        frame_name: z
          .string()
          .optional()
          .describe("Figma URLにnode-idが含まれない場合のフレーム名（省略可）"),
        threshold: z
          .number()
          .min(0)
          .max(1)
          .default(0.1)
          .describe("色差の許容閾値（0-1）。デフォルト0.1"),
        project_id: z
          .string()
          .optional()
          .describe("Crop Region適用のためのプロジェクトID（省略可）"),
        ignore_regions: z
          .array(IgnoreRegionSchema)
          .optional()
          .describe(
            "意図的差分マスク。各矩形{x,y,width,height,label?}内のピクセルは差分検出/matchRate分母から除外。座標系はcrop適用後のscreenshotピクセル座標。",
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

        const resultData = CompareDesignResultSchema.parse({
          ...result,
          diffImagePath,
          diffImageBase64: undefined,
        });

        const content: (
          | { type: "text"; text: string }
          | { type: "image"; data: string; mimeType: string }
        )[] = [];

        // Add diff image if there are differences
        if (result.diffImageBase64 && result.matchRate < 100) {
          content.push({
            type: "image",
            data: result.diffImageBase64,
            mimeType: "image/png",
          });
        }

        content.push({
          type: "text",
          text: JSON.stringify(resultData, null, 2),
        });

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

/**
 * compare_design — Primary MCP Tool
 * Pixel-level diff between Figma design and implementation screenshot.
 * AI should ALWAYS start with this tool.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import { z } from "zod";

import { parseDesignInput, type FigmaNode, type CropRegion } from "@figdiff/shared";

import { getCropRegion } from "../service/crop-region-store.js";
import { createFigmaService, type FigmaService } from "../service/figma-service.js";
import { compareImages } from "../service/image-compare-service.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

interface McpErrorResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError: true;
}

function mcpError(text: string): McpErrorResult {
  return { content: [{ type: "text", text }], isError: true };
}

async function resolveNodeId(
  figmaService: FigmaService,
  fileKey: string,
  nodeId: string | undefined,
  frameName: string | undefined,
): Promise<string | McpErrorResult> {
  if (nodeId) return nodeId;

  if (frameName) {
    const frames = await figmaService.getFrames(fileKey);
    const frame = frames.find((f) => f.name.toLowerCase() === frameName.toLowerCase());
    if (!frame) {
      return mcpError(
        `Frame "${frameName}" not found. Available frames: ${frames.map((f) => f.name).join(", ")}`,
      );
    }
    return frame.id;
  }

  const frames = await figmaService.getFrames(fileKey);
  return mcpError(
    `No frame specified. Available frames:\n${frames.map((f) => `- ${f.name} (${f.id}, ${f.width}x${f.height})`).join("\n")}\n\nPlease specify frame_name or use a URL with node-id.`,
  );
}

interface CompletionCriterion {
  required: number;
  current: number;
  status: "PASS" | "FAIL";
}

interface CompletionCriteria {
  matchRate: CompletionCriterion;
  diffPixelCount: CompletionCriterion;
  remainingIssues: CompletionCriterion;
}

function buildCompletionCriteria(
  matchRate: number,
  diffPixelCount: number,
  regionCount: number,
): CompletionCriteria {
  return {
    matchRate: {
      required: 100,
      current: matchRate,
      status: matchRate === 100 ? "PASS" : "FAIL",
    },
    diffPixelCount: {
      required: 0,
      current: diffPixelCount,
      status: diffPixelCount === 0 ? "PASS" : "FAIL",
    },
    remainingIssues: {
      required: 0,
      current: regionCount,
      status: regionCount === 0 ? "PASS" : "FAIL",
    },
  };
}

function buildStatus(matchRate: number): "PASS" | "FAIL" {
  return matchRate === 100 ? "PASS" : "FAIL";
}

function buildNextAction(matchRate: number, regionCount: number): string {
  if (matchRate === 100) return "一致率100%です。差分はありません。タスク完了です。";
  return `inspect_node を使って ${regionCount} 箇所の diffRegions の詳細を確認し、CSSを修正してください。修正後は再度 compare_design で検証してください。`;
}

function buildSuggestion(matchRate: number, regionCount: number): string {
  if (matchRate === 100) return "一致率100%です。差分はありません。";
  if (matchRate >= 95)
    return `軽微な差分が${regionCount}箇所あります。inspect_nodeで差分領域のノードを確認してください。`;
  return `大きな差分が${regionCount}箇所あります。inspect_nodeで各差分領域を確認し、修正してください。`;
}

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

## Figma URLの例
  "https://www.figma.com/design/ABC123/File?node-id=1-23"
  "https://www.figma.com/design/ABC123/File"

## ローカルパスの例
  "/path/to/design.png"
  "./screenshots/home.png"`;

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
      },
    },
    async (args) => {
      try {
        const parsed = parseDesignInput(args.design_source);

        let designBase64: string;
        let figmaRootNode: FigmaNode | undefined;

        if (parsed.type === "figma_url") {
          const figmaService = createFigmaService();
          const resolved = await resolveNodeId(
            figmaService,
            parsed.fileKey,
            parsed.nodeId,
            args.frame_name,
          );
          if (typeof resolved !== "string") return resolved;

          designBase64 = await figmaService.getFrameImage(parsed.fileKey, resolved);

          try {
            figmaRootNode = await figmaService.getNodeDetails(parsed.fileKey, resolved);
          } catch {
            // Node details optional — proceed without
          }
        } else {
          // Local file path
          const filePath = path.resolve(parsed.filePath);
          const buffer = await fs.readFile(filePath);
          designBase64 = buffer.toString("base64");
        }

        // Read screenshot
        const screenshotPath = path.resolve(args.screenshot);
        const screenshotBuffer = await fs.readFile(screenshotPath);
        const screenshotBase64 = screenshotBuffer.toString("base64");

        // Check crop region
        let cropRegion: CropRegion | undefined;
        if (args.project_id) {
          const regions = await getCropRegion(args.project_id, args.frame_name);
          if (regions.length > 0) {
            cropRegion = regions[0].region;
          }
        }

        const result = await compareImages(
          {
            designBase64,
            screenshotBase64,
            threshold: args.threshold,
            cropRegion,
          },
          figmaRootNode,
        );

        const regionCount = result.diffRegions.length;
        const status = buildStatus(result.matchRate);
        const suggestion = buildSuggestion(result.matchRate, regionCount);
        const nextAction = buildNextAction(result.matchRate, regionCount);
        const completionCriteria = buildCompletionCriteria(
          result.matchRate,
          result.diffPixelCount,
          regionCount,
        );

        const resultData = {
          status,
          ...result,
          remainingIssues: regionCount,
          completionCriteria,
          nextAction,
          suggestion,
          diffImageBase64: undefined,
        };

        const content: (
          | { type: "text"; text: string }
          | { type: "image"; data: string; mimeType: string }
        )[] = [];

        // Add diff image if there are differences
        if (result.diffImageBase64 && result.matchRate < 100) {
          content.push({
            type: "image" as const,
            data: result.diffImageBase64,
            mimeType: "image/png",
          });
        }

        content.push({
          type: "text" as const,
          text: JSON.stringify(resultData, null, 2),
        });

        return { content };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  );
}

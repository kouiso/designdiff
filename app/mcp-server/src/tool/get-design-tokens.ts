/**
 * get_design_tokens — Secondary MCP Tool
 * Extract design tokens (padding, color, fontSize etc.) from a Figma frame.
 * Use for initial implementation, NOT for iterative fixes.
 */

import { z } from "zod";

import { extractFileKey, extractNodeId } from "@figdiff/shared";

import { extractDesignTokens } from "../service/figma-node-transformer.js";
import { createFigmaService } from "../service/figma-service.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const DESCRIPTION = `Figmaフレーム全体のデザイントークン（padding, color, fontSize等の数値データ）を取得します。

**注意: 実装の修正時はこのツールではなく、compare_design → inspect_node のフローを推奨します。**
このツールは、新規ページの初回実装時や、フレーム全体の概要を把握したい場合に使用してください。
修正作業では、差分がある箇所だけを inspect_node で取得するほうが効率的です。`;

export function registerGetDesignTokens(server: McpServer): void {
  server.registerTool(
    "get_design_tokens",
    {
      description: DESCRIPTION,
      inputSchema: {
        figma_url: z.string().describe("FigmaのURL（node-id付きなら自動でそのフレーム）"),
        frame_name: z.string().optional().describe("対象フレーム名（URLにnode-idがない場合）"),
        depth: z
          .number()
          .int()
          .min(1)
          .max(5)
          .default(2)
          .describe("ノード探索の深さ（デフォルト: 2、最大: 5）。深いほど詳細だがデータ量が増加"),
      },
    },
    async (args) => {
      try {
        const fileKey = extractFileKey(args.figma_url);
        const figmaService = createFigmaService();

        let nodeId = extractNodeId(args.figma_url) ?? undefined;

        // If no node-id, try frame_name
        if (!nodeId && args.frame_name) {
          const frames = await figmaService.getFrames(fileKey);
          const frame = frames.find((f) => f.name.toLowerCase() === args.frame_name!.toLowerCase());
          if (!frame) {
            return {
              content: [
                {
                  type: "text",
                  text: `Frame "${args.frame_name}" not found. Available frames: ${frames.map((f) => f.name).join(", ")}`,
                },
              ],
              isError: true,
            };
          }
          nodeId = frame.id;
        }

        if (!nodeId) {
          const frames = await figmaService.getFrames(fileKey);
          return {
            content: [
              {
                type: "text",
                text: `No frame specified. Available frames:\n${frames.map((f) => `- ${f.name} (${f.id})`).join("\n")}\n\nPlease specify frame_name or use a URL with node-id.`,
              },
            ],
            isError: true,
          };
        }

        const node = await figmaService.getNodeDetails(fileKey, nodeId);
        const tokens = extractDesignTokens(node, args.depth);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ nodeId, tokenCount: tokens.length, tokens }, null, 2),
            },
          ],
        };
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

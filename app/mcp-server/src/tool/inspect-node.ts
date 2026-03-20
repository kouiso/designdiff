/**
 * inspect_node — Secondary MCP Tool
 * Dev Mode-like detailed inspection of Figma nodes.
 * Use after compare_design to drill into diff regions.
 */

import { z } from "zod";

import { extractFileKey } from "@figdiff/shared";

import { transformNodeToInspection } from "../service/figma-node-transformer.js";
import { createFigmaService } from "../service/figma-service.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const DESCRIPTION = `compare_designで差分が見つかったFigmaノードの詳細情報を取得します。
Figma Dev Modeで見られるような、CSS的なプロパティ（padding, gap, color, font等）を返します。

**このツールはcompare_designの後に、差分がある箇所に対して使ってください。**
compare_designの返り値に含まれるnearby_node_idsをそのまま渡すと、
差分に関連するノードの詳細情報を効率よく取得できます。

フレーム全体のスペックが必要な場合は get_design_tokens を使ってください。`;

export function registerInspectNode(server: McpServer): void {
  server.registerTool(
    "inspect_node",
    {
      description: DESCRIPTION,
      inputSchema: {
        figma_url: z.string().describe("FigmaのURL（ファイルURL or node-id付きURL）"),
        node_id: z
          .string()
          .optional()
          .describe(
            "検査するノードのID（例: '1:23'）。compare_designの返り値のnearby_node_idsから取得推奨",
          ),
        node_ids: z
          .array(z.string())
          .max(10)
          .optional()
          .describe("複数ノードを一括取得する場合。最大10個"),
      },
    },
    async (args) => {
      try {
        const fileKey = extractFileKey(args.figma_url);
        const figmaService = createFigmaService();

        // Collect node IDs to inspect
        const ids: string[] = [];
        if (args.node_id) ids.push(args.node_id);
        if (args.node_ids) ids.push(...args.node_ids);

        if (ids.length === 0) {
          return {
            content: [{ type: "text", text: "node_id or node_ids is required." }],
            isError: true,
          };
        }

        // Deduplicate
        const uniqueIds = [...new Set(ids)];

        const inspections = await Promise.all(
          uniqueIds.map(async (nodeId) => {
            const node = await figmaService.getNodeDetails(fileKey, nodeId);
            return transformNodeToInspection(node);
          }),
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                inspections.length === 1 ? inspections[0] : inspections,
                null,
                2,
              ),
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

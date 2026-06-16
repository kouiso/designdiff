/**
 * inspect_node — Secondary MCP Tool
 * Dev Mode-like detailed inspection of Figma nodes.
 * Use after compare_design to drill into diff regions.
 */

import { z } from "zod";

import { extractFileKey } from "@figdiff/shared";

import { transformNodeToInspection } from "../service/figma-node-transformer.js";
import { createFigmaService } from "../service/figma-service.js";
import { persistDetailJson } from "../service/persist-detail.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const DESCRIPTION = `【使用タイミング】compare_design の status が "FAIL" で diffRegions が返された時
【入力】compare_design が返した nearbyNodeIds をそのまま渡す
【出力】各ノードのCSS的プロパティ（padding, gap, color, font等）+ 修正すべき値（cssSuggestion）
【次のアクション】cssSuggestion に従ってコードを修正 → compare_design で再検証

Figma Dev Modeで見られるような詳細情報を取得します。
フレーム全体のスペックが必要な場合は get_design_tokens を使ってください。
レスポンスは肥大化防止のため切り詰める場合がある。全件は *DetailPath の JSON を Read で参照。`;

const INLINE_RESPONSE_BUDGET = 3500;
const MAX_CHILDREN_INLINE = 25;

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
        const figmaService = await createFigmaService();

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
            const node = await figmaService.getNodeDetails(fileKey, nodeId, 1);
            return transformNodeToInspection(node);
          }),
        );

        if (inspections.length === 1) {
          // Single node: only cap children inline
          const inspection = inspections[0];
          const children = inspection.childrenSummary;
          if (children && children.length > MAX_CHILDREN_INLINE) {
            const detailPath = await persistDetailJson(children, `children-${crypto.randomUUID()}`);
            const capped = {
              ...inspection,
              childrenSummary: children.slice(0, MAX_CHILDREN_INLINE),
              childrenTruncated: true,
              childrenCount: children.length,
              childrenDetailPath: detailPath,
            };
            return {
              content: [{ type: "text", text: JSON.stringify(capped) }],
            };
          }
          return {
            content: [{ type: "text", text: JSON.stringify(inspection) }],
          };
        }

        // Multi-node: cap children per inspection, then check total budget
        const capped = inspections.map((inspection) => {
          const children = inspection.childrenSummary;
          if (children && children.length > MAX_CHILDREN_INLINE) {
            return {
              ...inspection,
              childrenSummary: children.slice(0, MAX_CHILDREN_INLINE),
              childrenTruncated: true,
              childrenCount: children.length,
            };
          }
          return inspection;
        });

        const serialized = JSON.stringify(capped);
        if (serialized.length > INLINE_RESPONSE_BUDGET) {
          const detailPath = await persistDetailJson(inspections, `inspect-${crypto.randomUUID()}`);
          const summaries = inspections.map((inspection) => ({
            nodeId: inspection.nodeId,
            nodeName: inspection.nodeName,
            nodeType: inspection.nodeType,
            cssSuggestion: inspection.cssSuggestion,
            detailPath,
          }));
          return {
            content: [{ type: "text", text: JSON.stringify(summaries) }],
          };
        }

        return {
          content: [{ type: "text", text: serialized }],
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

/**
 * get_crop_region — Utility MCP Tool
 * Get configured crop regions for a project.
 */

import { z } from "zod";

import { getCropRegion } from "../service/crop-region-store.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerGetCropRegion(server: McpServer): void {
  server.registerTool(
    "get_crop_region",
    {
      description:
        "プロジェクトに設定された比較範囲を取得します。モバイルのステータスバー除外等に使用。",
      inputSchema: {
        project_id: z.string().describe("プロジェクトID"),
        frame_name: z.string().optional().describe("フレーム名（省略時は全フレームの範囲を返す）"),
      },
    },
    async (args) => {
      try {
        const regions = await getCropRegion(args.project_id, args.frame_name);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ regionCount: regions.length, regions }, null, 2),
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

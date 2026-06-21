/**
 * delete_ignore_region — Utility MCP Tool
 * Delete a persisted ignore region for a project by id.
 */

import { z } from "zod";

import { deleteIgnoreRegion } from "../service/ignore-region-store.js";
import { PROJECT_ID_PATTERN } from "../service/project-store.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerDeleteIgnoreRegion(server: McpServer): void {
  server.registerTool(
    "delete_ignore_region",
    {
      description:
        "プロジェクトのignore-regions.yamlから指定idの意図的差分マスクを削除します。frame_nameは対象確認用に受け取れますが、削除キーはregion idです。座標系はcrop適用後のscreenshotピクセル座標です。",
      inputSchema: {
        project_id: z.string().regex(PROJECT_ID_PATTERN).describe("プロジェクトID"),
        frame_name: z.string().optional().describe("削除対象マスクのフレーム名（任意）"),
        region_id: z.string().min(1).describe("削除する意図的差分マスクのid"),
      },
    },
    async (args) => {
      try {
        const config = await deleteIgnoreRegion(args.project_id, args.region_id);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  deletedRegionId: args.region_id,
                  frameName: args.frame_name,
                  regionCount: config.regions.length,
                },
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

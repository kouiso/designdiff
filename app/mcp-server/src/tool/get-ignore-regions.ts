/**
 * get_ignore_regions — Utility MCP Tool
 * Get persisted ignore regions for a project.
 */

import { z } from "zod";

import { getIgnoreRegionConfig } from "../service/ignore-region-store.js";
import { PROJECT_ID_PATTERN, projectExists } from "../service/project-store.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerGetIgnoreRegions(server: McpServer): void {
  server.registerTool(
    "get_ignore_regions",
    {
      description:
        "プロジェクトに保存された意図的差分マスクを取得します。frame_name指定時はglobal maskと該当frame maskを返します。座標系はcrop適用後のscreenshotピクセル座標です（designはscreenshot幅にリサイズ後にcropされます。Figmaフレームピクセルではありません）。",
      inputSchema: {
        project_id: z.string().regex(PROJECT_ID_PATTERN).describe("プロジェクトID"),
        frame_name: z.string().optional().describe("フレーム名（省略時は全マスクを返す）"),
      },
    },
    async (args) => {
      try {
        const exists = await projectExists(args.project_id);
        if (!exists) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  { projectExists: false, regionCount: 0, regions: [] },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        const regions = await getIgnoreRegionConfig(args.project_id, args.frame_name);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  projectExists: true,
                  coordinateBasis: "post-crop screenshot pixels",
                  regionCount: regions.length,
                  regions,
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

/**
 * set_crop_region — Utility MCP Tool
 * Set a comparison crop region for a project frame.
 */

import { z } from "zod";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { setCropRegion } from "../service/crop-region-store.js";

export function registerSetCropRegion(server: McpServer): void {
  server.registerTool(
    "set_crop_region",
    {
      description: "比較範囲を設定します。モバイルスクショのステータスバー除外等に使用。",
      inputSchema: {
        project_id: z.string().describe("プロジェクトID"),
        frame_name: z.string().describe("フレーム名"),
        region: z
          .object({
            x: z.number().nonnegative().describe("左上X座標"),
            y: z.number().nonnegative().describe("左上Y座標"),
            width: z.number().positive().describe("幅"),
            height: z.number().positive().describe("高さ"),
          })
          .describe("クロップ領域"),
        note: z.string().optional().describe("メモ（例: iOSステータスバー除外）"),
      },
    },
    async (args) => {
      try {
        const entry = await setCropRegion(args.project_id, args.frame_name, args.region, args.note);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: true, entry }, null, 2),
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

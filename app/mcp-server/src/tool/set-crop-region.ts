/**
 * set_crop_region — Utility MCP Tool
 * Set a comparison crop region for a project frame.
 */

import { z } from "zod";

import { setCropRegion } from "../service/crop-region-store.js";
import { PROJECT_ID_PATTERN } from "../service/project-store.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerSetCropRegion(server: McpServer): void {
  server.registerTool(
    "set_crop_region",
    {
      description:
        "比較範囲を設定します。モバイルスクショのステータスバー除外等に使用。座標系はcrop適用後のscreenshotピクセル座標です（designはscreenshot幅にリサイズ後にcropされます。Figmaフレームピクセルではありません）。",
      inputSchema: {
        project_id: z.string().regex(PROJECT_ID_PATTERN).describe("プロジェクトID"),
        frame_name: z.string().describe("フレーム名"),
        region: z
          .object({
            x: z.number().nonnegative().describe("左上X座標"),
            y: z.number().nonnegative().describe("左上Y座標"),
            width: z.number().positive().describe("幅"),
            height: z.number().positive().describe("高さ"),
          })
          .describe(
            "クロップ領域。座標系はcrop適用後のscreenshotピクセル座標です（designはscreenshot幅にリサイズ後にcropされます。Figmaフレームピクセルではありません）。",
          ),
        note: z.string().optional().describe("メモ（例: iOSステータスバー除外）"),
        screenshot_width: z
          .number()
          .positive()
          .optional()
          .describe(
            "この crop を決めたときのスクリーンショット全体の幅。撮影条件が変わったことを検出するために使う。compare_design が報告した値をそのまま渡す。",
          ),
        screenshot_height: z
          .number()
          .positive()
          .optional()
          .describe("この crop を決めたときのスクリーンショット全体の高さ。"),
      },
    },
    async (args) => {
      try {
        const capturedSize =
          args.screenshot_width !== undefined && args.screenshot_height !== undefined
            ? { width: args.screenshot_width, height: args.screenshot_height }
            : undefined;
        const entry = await setCropRegion(
          args.project_id,
          args.frame_name,
          args.region,
          args.note,
          capturedSize,
        );

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

/**
 * set_ignore_regions — Utility MCP Tool
 * Upsert persisted ignore regions for a project by id.
 */

import { z } from "zod";

import { IgnoreRegionConfigEntrySchema } from "@figdiff/shared";

import { setIgnoreRegionConfig } from "../service/ignore-region-store.js";
import { PROJECT_ID_PATTERN } from "../service/project-store.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerSetIgnoreRegions(server: McpServer): void {
  server.registerTool(
    "set_ignore_regions",
    {
      description:
        "プロジェクトの意図的差分マスクをignore-regions.yamlへ保存します。既存マスクはidごとに更新または追加され、削除はdelete_ignore_regionを使います。座標系はcrop適用後のscreenshotピクセル座標です（designはscreenshot幅にリサイズ後にcropされます。Figmaフレームピクセルではありません）。",
      inputSchema: {
        project_id: z.string().regex(PROJECT_ID_PATTERN).describe("プロジェクトID"),
        regions: z
          .array(IgnoreRegionConfigEntrySchema)
          .describe(
            "保存する意図的差分マスク一覧。既存マスクは同じidなら更新され、異なるidなら保持されます。削除はdelete_ignore_regionを使います。座標系はcrop適用後のscreenshotピクセル座標です（designはscreenshot幅にリサイズ後にcropされます。Figmaフレームピクセルではありません）。",
          ),
      },
    },
    async (args) => {
      try {
        const config = await setIgnoreRegionConfig(args.project_id, args.regions);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: true, regionCount: config.regions.length }, null, 2),
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

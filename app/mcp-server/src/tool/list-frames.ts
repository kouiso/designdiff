/**
 * list_figma_frames — Utility MCP Tool
 * List all frames in a Figma file.
 */

import { z } from "zod";

import { extractFileKey } from "@figdiff/shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { createFigmaService } from "../service/figma-service.js";

export function registerListFrames(server: McpServer): void {
  server.registerTool(
    "list_figma_frames",
    {
      description:
        "Figmaファイル内のフレーム一覧を取得します。各フレームのID, 名前, サイズを返します。",
      inputSchema: {
        figma_url: z.string().describe("FigmaファイルのURL"),
      },
    },
    async (args) => {
      try {
        const fileKey = extractFileKey(args.figma_url);
        const figmaService = createFigmaService();
        const frames = await figmaService.getFrames(fileKey);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ frameCount: frames.length, frames }, null, 2),
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

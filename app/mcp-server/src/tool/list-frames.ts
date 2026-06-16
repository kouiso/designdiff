/**
 * list_figma_frames — Utility MCP Tool
 * List all frames in a Figma file.
 */

import { z } from "zod";

import { extractFileKey } from "@figdiff/shared";

import { createFigmaService } from "../service/figma-service.js";
import { persistDetailJson } from "../service/persist-detail.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const INLINE_RESPONSE_BUDGET = 3500;

export function registerListFrames(server: McpServer): void {
  server.registerTool(
    "list_figma_frames",
    {
      description:
        "Figmaファイル内のフレーム一覧を取得します。各フレームのID, 名前, サイズを返します。レスポンスが大きい場合は切り詰め、全件は framesDetailPath の JSON を Read で参照。",
      inputSchema: {
        figma_url: z.string().describe("FigmaファイルのURL"),
      },
    },
    async (args) => {
      try {
        const fileKey = extractFileKey(args.figma_url);
        const figmaService = createFigmaService();
        const frames = await figmaService.getFrames(fileKey);

        const result = { frameCount: frames.length, frames };
        const serialized = JSON.stringify(result);

        if (serialized.length > INLINE_RESPONSE_BUDGET) {
          const framesDetailPath = await persistDetailJson(frames, `frames-${Date.now()}`);
          // Fit as many frames inline as possible within budget
          const skeleton = JSON.stringify({
            frameCount: frames.length,
            frames: [],
            framesTruncated: true,
            framesDetailPath,
          });
          let inlineCount = 0;
          let accumulated = skeleton.length;
          for (const frame of frames) {
            const frameLen = JSON.stringify(frame).length + 1;
            if (accumulated + frameLen > INLINE_RESPONSE_BUDGET) break;
            accumulated += frameLen;
            inlineCount++;
          }
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  frameCount: frames.length,
                  frames: frames.slice(0, inlineCount),
                  framesTruncated: true,
                  framesDetailPath,
                }),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: serialized,
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

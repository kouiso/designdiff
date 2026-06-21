/**
 * list_figma_frames — Utility MCP Tool
 * List all frames in a Figma file.
 */

import { z } from "zod";

import { extractFileKey } from "@figdiff/shared";

import { createFigmaService } from "../service/figma-service.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 500;

interface FrameSummary {
  id: string;
  name: string;
}

function isFrameLike(frame: unknown): frame is { id?: unknown; name?: unknown } {
  return frame !== null && typeof frame === "object";
}

function toIdNameFrame(frame: unknown): FrameSummary {
  if (!isFrameLike(frame)) {
    return { id: "", name: "" };
  }
  return {
    id: typeof frame.id === "string" ? frame.id : "",
    name: typeof frame.name === "string" ? frame.name : "",
  };
}

export function registerListFrames(server: McpServer): void {
  server.registerTool(
    "list_figma_frames",
    {
      description:
        "Figmaファイル内のフレーム一覧を取得します。offset/limit でページングでき、fields='id_name' で軽量なID・名前のみを返します。",
      inputSchema: {
        figma_url: z.string().describe("FigmaファイルのURL"),
        include_nested: z
          .boolean()
          .optional()
          .describe(
            "モーダル・オーバーレイ等、FRAMEノード内にネストされたフレームも含めて取得（default: false）",
          ),
        level: z
          .enum(["page", "all"])
          .optional()
          .describe(
            "page: PAGE/SECTION/GROUP配下のアートボードのみ取得。all: ネストされた全フレームも取得（default: page）",
          ),
        offset: z.number().int().nonnegative().optional().describe("返却開始位置（default: 0）"),
        limit: z
          .number()
          .int()
          .positive()
          .max(MAX_LIMIT)
          .optional()
          .describe(`1ページあたりの最大件数（default: ${DEFAULT_LIMIT}, max: ${MAX_LIMIT}）`),
        fields: z
          .enum(["full", "id_name"])
          .optional()
          .describe(
            "full: ID/名前/サイズ等を返す。id_name: IDと名前のみの軽量一覧を返す（default: full）",
          ),
      },
    },
    async (args) => {
      try {
        const fileKey = extractFileKey(args.figma_url);
        const figmaService = await createFigmaService();
        const level = args.level ?? (args.include_nested ? "all" : "page");
        const frames = await figmaService.getFrames(fileKey, {
          includeNested: args.include_nested,
          level,
        });

        const offset = args.offset ?? 0;
        const limit = args.limit ?? DEFAULT_LIMIT;
        const fields = args.fields ?? "full";
        const pageFrames = frames.slice(offset, offset + limit);
        const projectedFrames = fields === "id_name" ? pageFrames.map(toIdNameFrame) : pageFrames;
        const nextOffset = offset + projectedFrames.length;
        const hasMore = nextOffset < frames.length;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                frameCount: frames.length,
                pageCount: projectedFrames.length,
                offset,
                limit,
                nextOffset: hasMore ? nextOffset : null,
                hasMore,
                includeNested: args.include_nested ?? false,
                level,
                fields,
                frames: projectedFrames,
              }),
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

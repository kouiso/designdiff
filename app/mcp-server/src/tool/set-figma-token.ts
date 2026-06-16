/**
 * set_figma_token — Utility MCP Tool
 * Set a Figma Personal Access Token in the shared credential store.
 */

import { z } from "zod";

import { savePat } from "@figdiff/credential-store";

import { invalidateFigmaService } from "../service/figma-service.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const PAT_MIN_LENGTH = 20;
const PAT_PREFIX = "figd_";

export function registerSetFigmaToken(server: McpServer): void {
  server.registerTool(
    "set_figma_token",
    {
      description:
        "Figma Personal Access Token を設定します。設定後は .mcp.json の FIGMA_TOKEN 環境変数が不要になります。トークンは figd_ で始まる文字列で、FigDiff デスクトップアプリとトークンを共有します。",
      inputSchema: {
        token: z
          .string()
          .min(PAT_MIN_LENGTH, `Token must be at least ${PAT_MIN_LENGTH} characters`)
          .refine((t) => t.startsWith(PAT_PREFIX), {
            message: "Token must start with figd_",
          }),
      },
    },
    async (args) => {
      try {
        savePat(args.token);
        invalidateFigmaService();
        return {
          content: [
            {
              type: "text",
              text: "Figma token saved successfully. The token is now shared between the MCP server and the FigDiff desktop app.",
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error saving token: ${message}` }],
          isError: true,
        };
      }
    },
  );
}

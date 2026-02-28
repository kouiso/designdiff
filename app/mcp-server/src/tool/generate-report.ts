/**
 * generate_diff_report — Utility MCP Tool
 * Generate a Markdown or JSON report from a compare_design result.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";

import { CompareDesignResultSchema } from "@figdiff/shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { generateMarkdownReport, generateJsonReport } from "../service/report-generator.js";

const DESCRIPTION =
  "compare_designの結果からMarkdownまたはJSONレポートを生成します。結果のJSONを直接渡すか、comparison_idで過去の比較結果を参照します。";

export function registerGenerateReport(server: McpServer): void {
  server.registerTool(
    "generate_diff_report",
    {
      description: DESCRIPTION,
      inputSchema: {
        comparison_result: z.string().describe("compare_designの返り値JSON文字列"),
        format: z
          .enum(["markdown", "json"])
          .default("markdown")
          .describe("出力フォーマット（markdown or json）"),
        output_path: z
          .string()
          .optional()
          .describe("レポートをファイルに保存する場合のパス（省略可）"),
      },
    },
    async (args) => {
      try {
        const result = CompareDesignResultSchema.parse(JSON.parse(args.comparison_result));

        const report =
          args.format === "json" ? generateJsonReport(result) : generateMarkdownReport(result);

        // Save to file if output_path is provided
        if (args.output_path) {
          const outputPath = path.resolve(args.output_path);
          await fs.writeFile(outputPath, report, "utf-8");
        }

        return {
          content: [{ type: "text", text: report }],
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

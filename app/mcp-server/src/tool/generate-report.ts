/**
 * generate_diff_report — Utility MCP Tool
 * Generate a Markdown or JSON report from a compare_design result.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import { z } from "zod";

import { CompareDesignResultSchema } from "@figdiff/shared";

import { generateMarkdownReport, generateJsonReport } from "../service/report-generator.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const DESCRIPTION =
  "compare_designの返り値をcomparison_resultにJSON文字列またはオブジェクトで渡して、MarkdownまたはJSONレポートを生成します。";

const comparisonResultInputSchema = z.union([z.string(), z.object({}).passthrough()]);

function normalizeComparisonResultInput(
  input: z.infer<typeof comparisonResultInputSchema>,
): unknown {
  const parsed: unknown = typeof input === "string" ? JSON.parse(input) : input;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return parsed;
  }

  const recordResult = z.record(z.string(), z.unknown()).safeParse(parsed);
  if (!recordResult.success) {
    return parsed;
  }

  const result = recordResult.data;

  return {
    comparisonId: result.comparisonId ?? `cmp-${Date.now()}`,
    ...result,
    totalPixelCount: result.totalPixelCount ?? result.totalPixels,
    diffRegions: result.diffRegions ?? result.regions ?? [],
    suggestion: result.suggestion ?? "",
  };
}

export function registerGenerateReport(server: McpServer): void {
  server.registerTool(
    "generate_diff_report",
    {
      description: DESCRIPTION,
      inputSchema: {
        comparison_result: comparisonResultInputSchema.describe(
          "compare_designの返り値（JSON文字列またはオブジェクト）",
        ),
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
        const result = CompareDesignResultSchema.parse(
          normalizeComparisonResultInput(args.comparison_result),
        );

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

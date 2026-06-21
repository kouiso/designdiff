/**
 * generate_diff_report — Utility MCP Tool
 * Generate a Markdown or JSON report from a compare_design result.
 */

import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";

import { z } from "zod";

import { CompareDesignResultSchema } from "@figdiff/shared";

import { getComparisonEntry } from "../service/comparison-history.js";
import { generateMarkdownReport, generateJsonReport } from "../service/report-generator.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const DESCRIPTION =
  "comparison_id（推奨・軽量）または comparison_result を渡して Markdown または JSON レポートを生成します。comparison_id は compare_design の返り値から取得してください。";

const comparisonResultInputSchema = z.union([z.string(), z.object({}).passthrough()]);
const comparisonResultRecordSchema = z.record(z.string(), z.unknown());

function normalizeComparisonResultInput(
  input: z.infer<typeof comparisonResultInputSchema>,
): unknown {
  const parsed: unknown = typeof input === "string" ? JSON.parse(input) : input;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return parsed;
  }

  const resultParse = comparisonResultRecordSchema.safeParse(parsed);
  if (!resultParse.success) {
    return parsed;
  }

  const result = resultParse.data;

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
        comparison_id: z
          .string()
          .optional()
          .describe(
            "compare_design が返した comparisonId。comparison_result の代わりに指定可（推奨・軽量）",
          ),
        comparison_result: comparisonResultInputSchema
          .optional()
          .describe(
            "compare_designの返り値（JSON文字列またはオブジェクト）。comparison_id と二者択一",
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
        let rawResult: unknown;

        if (args.comparison_id) {
          const entry = await getComparisonEntry(args.comparison_id);
          if (!entry) {
            return {
              content: [
                {
                  type: "text",
                  text: "Error: comparison_id が見つかりません。compare_design を再実行するか comparison_result を直接渡してください。",
                },
              ],
              isError: true,
            };
          }
          // 古い履歴では diffImagePath がないため、現行の安定パスをIDから補完する。
          const pngPath = path.join(
            homedir(),
            ".figdiff",
            "results",
            `diff-${args.comparison_id}.png`,
          );
          let diffImagePath: string | undefined;
          try {
            await fs.access(pngPath);
            diffImagePath = pngPath;
          } catch {
            // PNG が存在しない場合は undefined のまま（差分なし or tmpdir保存）
          }
          rawResult = diffImagePath ? { ...entry.result, diffImagePath } : entry.result;
        } else if (args.comparison_result !== undefined) {
          rawResult = normalizeComparisonResultInput(args.comparison_result);
        } else {
          return {
            content: [
              {
                type: "text",
                text: "Error: comparison_id または comparison_result のどちらかを指定してください。",
              },
            ],
            isError: true,
          };
        }

        const result = CompareDesignResultSchema.parse(rawResult);

        const report =
          args.format === "json" ? generateJsonReport(result) : generateMarkdownReport(result);

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
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  );
}

/**
 * generate_diff_report — Utility MCP Tool
 * Generate a Markdown or JSON report from a compare_design result.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import { z } from "zod";

import { CompareDesignResultSchema, LoopGuardReportSchema } from "@figdiff/shared";

import { getComparisonEntry } from "../service/comparison-history.js";
import { generateMarkdownReport, generateJsonReport } from "../service/report-generator.js";
import { getFigdiffResultsDir } from "../util/figdiff-paths.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const DESCRIPTION =
  "comparison_id（推奨・軽量）または comparison_result を渡して Markdown または JSON レポートを生成します。comparison_id は compare_design の返り値から取得してください。";

const comparisonResultInputSchema = z.union([z.string(), z.object({}).passthrough()]);
const comparisonResultRecordSchema = z.record(z.string(), z.unknown());
const LEGACY_MAX_STEPS = 5;
const legacyLoopGuardSchema = z
  .object({
    iteration: z.number().int().positive(),
    decision: z.enum(["continue", "stop"]),
    reason: z.string().min(1),
  })
  .strict();

const normalizeLegacyLoopGuard = (value: unknown): unknown => {
  const current = LoopGuardReportSchema.safeParse(value);
  if (current.success) {
    return value;
  }

  const legacy = legacyLoopGuardSchema.safeParse(value);
  if (!legacy.success) {
    return value;
  }

  const { iteration, decision, reason: message } = legacy.data;
  const steps = message.match(/(\d+)\s*\/\s*(\d+)/);
  const upperBound = message.match(/上限\s*\((\d+)\s*回\)/);
  const maxStepsText = steps?.[2] ?? upperBound?.[1];
  const parsedMaxSteps = maxStepsText === undefined ? undefined : Number(maxStepsText);
  const maxSteps =
    parsedMaxSteps !== undefined && Number.isSafeInteger(parsedMaxSteps)
      ? Math.max(iteration, parsedMaxSteps)
      : Math.max(iteration, LEGACY_MAX_STEPS);
  const reason =
    decision === "continue"
      ? "continue"
      : message.includes("UNCERTAIN")
        ? "uncertain"
        : message.includes("PASS")
          ? "no-regression"
          : message.includes("上限")
            ? "max-steps"
            : "regression";

  return {
    stop: decision === "stop",
    step: iteration,
    maxSteps,
    remainingSteps: maxSteps - iteration,
    reason,
    message,
    iteration,
    decision,
  };
};

export const normalizeComparisonResultInput = (
  input: z.infer<typeof comparisonResultInputSchema>,
): unknown => {
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
    loopGuard: normalizeLegacyLoopGuard(result.loopGuard),
  };
};

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
          const pngPath = path.join(getFigdiffResultsDir(), `diff-${args.comparison_id}.png`);
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

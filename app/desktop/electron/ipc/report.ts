import { writeFile } from "node:fs/promises";

import { dialog } from "electron";
import { z } from "zod";

import {
  CompareDesignResultSchema,
  generateJsonReport,
  generateMarkdownReport,
} from "@figdiff/shared";

const requestSchema = z.object({
  result: CompareDesignResultSchema,
  format: z.enum(["markdown", "json"]),
});

export async function saveComparisonReport(request: unknown): Promise<string | null> {
  const { result, format } = requestSchema.parse(request);
  const extension = format === "json" ? "json" : "md";
  const content = format === "json" ? generateJsonReport(result) : generateMarkdownReport(result);
  // 保存先はネイティブダイアログで選ぶ。画面側から任意のパスを渡せる窓口にはしない。
  const choice = await dialog.showSaveDialog({
    defaultPath: `figdiff-report.${extension}`,
    filters: [{ name: format === "json" ? "JSON" : "Markdown", extensions: [extension] }],
    properties: ["showOverwriteConfirmation", "createDirectory"],
  });
  if (choice.canceled || !choice.filePath) return null;
  await writeFile(choice.filePath, content, "utf8");
  return choice.filePath;
}

import * as fs from "node:fs/promises";
import * as path from "node:path";

import { getFigdiffResultsDir } from "../util/figdiff-paths.js";

export async function persistDetailJson(payload: unknown, name: string): Promise<string> {
  const directoryPath = getFigdiffResultsDir();
  await fs.mkdir(directoryPath, { recursive: true });
  const filePath = path.join(directoryPath, `${name}.json`);
  await fs.writeFile(filePath, JSON.stringify(payload));
  return filePath;
}

export function diffImageFileName(comparisonId: string): string {
  return `diff-${comparisonId}.png`;
}

export async function persistDiffImage(base64Data: string, comparisonId: string): Promise<string> {
  const directoryPath = getFigdiffResultsDir();
  await fs.mkdir(directoryPath, { recursive: true });
  const filePath = path.join(directoryPath, diffImageFileName(comparisonId));
  await fs.writeFile(filePath, Buffer.from(base64Data, "base64"));
  return filePath;
}

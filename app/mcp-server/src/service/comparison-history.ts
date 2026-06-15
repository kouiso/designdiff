import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";

import { CompareDesignResultSchema } from "@figdiff/shared";
import type { CompareDesignResult, DiffReport, ParsedDesignInput } from "@figdiff/shared";

const MAX_REPORTS_PER_KEY = 5;

function resultsDir(): string {
  return path.join(homedir(), ".figdiff", "results");
}

export interface ComparisonHistoryEntry {
  comparisonId: string;
  sourceKey: string;
  result: CompareDesignResult;
}

const historyBySourceKey = new Map<string, ComparisonHistoryEntry[]>();
const historyByComparisonId = new Map<string, ComparisonHistoryEntry>();

function hasDiffReport(entry: ComparisonHistoryEntry): entry is ComparisonHistoryEntry & {
  result: CompareDesignResult & { diffReport: DiffReport };
} {
  return entry.result.diffReport !== undefined;
}

export function buildComparisonSourceKey(
  parsedDesign: ParsedDesignInput,
  resolvedNodeId?: string,
): string {
  if (parsedDesign.type === "figma_url") {
    return `figma:${parsedDesign.fileKey}:${resolvedNodeId ?? parsedDesign.nodeId ?? "root"}`;
  }

  return `local:${path.resolve(parsedDesign.filePath)}`;
}

export async function recordComparison(entry: ComparisonHistoryEntry): Promise<void> {
  const existingEntries = historyBySourceKey.get(entry.sourceKey) ?? [];
  const nextEntries = [...existingEntries, entry];

  while (nextEntries.length > MAX_REPORTS_PER_KEY) {
    const removed = nextEntries.shift();
    if (removed) {
      historyByComparisonId.delete(removed.comparisonId);
      try {
        const dir = resultsDir();
        await fs.rm(path.join(dir, `${removed.comparisonId}.json`), { force: true });
        await fs.rm(path.join(dir, `${removed.comparisonId}.png`), { force: true });
      } catch {
        // 古い履歴の削除失敗は現在の比較結果の保存を妨げないため無視する。
      }
    }
  }

  historyBySourceKey.set(entry.sourceKey, nextEntries);
  historyByComparisonId.set(entry.comparisonId, entry);

  try {
    const dir = resultsDir();
    await fs.mkdir(dir, { recursive: true });
    const diskEntry = {
      comparisonId: entry.comparisonId,
      sourceKey: entry.sourceKey,
      result: { ...entry.result, diffImageBase64: undefined },
    };
    await fs.writeFile(
      path.join(dir, `${entry.comparisonId}.json`),
      JSON.stringify(diskEntry, null, 2),
      "utf-8",
    );
  } catch {
    // ディスク保存に失敗しても同一プロセス内の履歴参照は継続できるため無視する。
  }
}

export async function getComparisonEntry(
  comparisonId: string,
): Promise<ComparisonHistoryEntry | undefined> {
  const inMemory = historyByComparisonId.get(comparisonId);
  if (inMemory) return inMemory;

  try {
    const dir = resultsDir();
    const filePath = path.join(dir, `${comparisonId}.json`);
    // Path traversal guard: resolved path must stay within resultsDir
    if (!filePath.startsWith(dir + path.sep) && filePath !== dir) return undefined;
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const {
      comparisonId: storedId,
      sourceKey,
      result: rawResult,
    } = parsed as Record<string, unknown>;
    const result = CompareDesignResultSchema.parse(rawResult);
    return {
      comparisonId: typeof storedId === "string" ? storedId : comparisonId,
      sourceKey: typeof sourceKey === "string" ? sourceKey : "unknown",
      result,
    };
  } catch {
    return undefined;
  }
}

export function getRecentReports(sourceKey: string): DiffReport[] {
  const entries = historyBySourceKey.get(sourceKey) ?? [];
  return entries.filter(hasDiffReport).map((entry) => entry.result.diffReport);
}

export function clearComparisonHistory(): void {
  historyBySourceKey.clear();
  historyByComparisonId.clear();
}

import * as path from "node:path";

import type { CompareDesignResult, DiffReport, ParsedDesignInput } from "@figdiff/shared";

const MAX_REPORTS_PER_KEY = 5;

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

export function recordComparison(entry: ComparisonHistoryEntry): void {
  const existingEntries = historyBySourceKey.get(entry.sourceKey) ?? [];
  const nextEntries = [...existingEntries, entry];

  while (nextEntries.length > MAX_REPORTS_PER_KEY) {
    const removed = nextEntries.shift();
    if (removed) {
      historyByComparisonId.delete(removed.comparisonId);
    }
  }

  historyBySourceKey.set(entry.sourceKey, nextEntries);
  historyByComparisonId.set(entry.comparisonId, entry);
}

export function getComparisonEntry(comparisonId: string): ComparisonHistoryEntry | undefined {
  return historyByComparisonId.get(comparisonId);
}

export function getRecentReports(sourceKey: string): DiffReport[] {
  const entries = historyBySourceKey.get(sourceKey) ?? [];
  return entries.filter(hasDiffReport).map((entry) => entry.result.diffReport);
}

export function clearComparisonHistory(): void {
  historyBySourceKey.clear();
  historyByComparisonId.clear();
}

import * as fs from "node:fs/promises";
import * as path from "node:path";

import { CompareDesignResultSchema } from "@figdiff/shared";
import type { CompareDesignResult, DiffReport, ParsedDesignInput } from "@figdiff/shared";

import { getFigdiffResultsDir } from "../util/figdiff-paths.js";

import { normalizeLegacyLoopGuard } from "./comparison-result-compat.js";
import { diffImageFileName } from "./persist-detail.js";

const MAX_REPORTS_PER_KEY = 5;

function resultsDir(): string {
  return getFigdiffResultsDir();
}

export interface ComparisonHistoryEntry {
  comparisonId: string;
  sourceKey: string;
  result: CompareDesignResult;
  captureWidth?: number;
  captureHeight?: number;
}

export interface RecentComparison {
  report: DiffReport;
  captureWidth?: number;
  captureHeight?: number;
}

const historyBySourceKey = new Map<string, ComparisonHistoryEntry[]>();
const historyByComparisonId = new Map<string, ComparisonHistoryEntry>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasDiffReport(entry: ComparisonHistoryEntry): entry is ComparisonHistoryEntry & {
  result: CompareDesignResult & { diffReport: DiffReport };
} {
  return entry.result.diffReport !== undefined;
}

export function buildComparisonSourceKey(
  parsedDesign: ParsedDesignInput,
  resolvedNodeId?: string,
  // 下地の色を変えると、同じ画面でも構造と色の数値が別物になる。
  // 履歴を分けないと、下地を変えただけの回が「実装が悪化した」として並ぶ。
  designBackground?: string,
): string {
  const backgroundSuffix = designBackground ? `@${designBackground.toLowerCase()}` : "";
  if (parsedDesign.type === "figma_url") {
    return `figma:${parsedDesign.fileKey}:${resolvedNodeId ?? parsedDesign.nodeId ?? "root"}${backgroundSuffix}`;
  }

  return `local:${path.resolve(parsedDesign.filePath)}${backgroundSuffix}`;
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
        await fs.rm(path.join(dir, diffImageFileName(removed.comparisonId)), { force: true });
        await fs.rm(path.join(dir, `${removed.comparisonId}.png`), { force: true });
        await fs.rm(path.join(dir, `${removed.comparisonId}.regions.json`), { force: true });
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
      captureWidth: entry.captureWidth,
      captureHeight: entry.captureHeight,
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
    if (!isRecord(parsed)) return undefined;
    const storedId = parsed.comparisonId;
    const sourceKey = parsed.sourceKey;
    const captureWidth = parsed.captureWidth;
    const captureHeight = parsed.captureHeight;
    const rawResult = parsed.result;
    const normalizedResult = isRecord(rawResult)
      ? { ...rawResult, loopGuard: normalizeLegacyLoopGuard(rawResult.loopGuard) }
      : rawResult;
    const result = CompareDesignResultSchema.parse(normalizedResult);
    return {
      comparisonId: typeof storedId === "string" ? storedId : comparisonId,
      sourceKey: typeof sourceKey === "string" ? sourceKey : "unknown",
      captureWidth: typeof captureWidth === "number" ? captureWidth : undefined,
      captureHeight: typeof captureHeight === "number" ? captureHeight : undefined,
      result,
    };
  } catch {
    return undefined;
  }
}

export function getRecentComparisons(sourceKey: string): RecentComparison[] {
  const entries = historyBySourceKey.get(sourceKey) ?? [];
  return entries.filter(hasDiffReport).map((entry) => ({
    report: entry.result.diffReport,
    captureWidth: entry.captureWidth,
    captureHeight: entry.captureHeight,
  }));
}

export function getRecentReports(sourceKey: string): DiffReport[] {
  return getRecentComparisons(sourceKey).map((entry) => entry.report);
}

export function clearComparisonHistory(): void {
  historyBySourceKey.clear();
  historyByComparisonId.clear();
}

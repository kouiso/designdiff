import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import type { CompareDesignResult, DiffReport, ParsedDesignInput } from "@figdiff/shared";

import {
  buildComparisonSourceKey,
  clearComparisonHistory,
  getComparisonEntry,
  getRecentComparisons,
  getRecentReports,
  recordComparison,
} from "./comparison-history.js";

function createReport(weightedStructure: number): DiffReport {
  return {
    alignment: {
      translation: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      confidence: 1,
      residual: 0,
    },
    regionScores: [
      {
        regionId: "section-body",
        figmaNodeId: "section-body",
        bbox: { x: 0, y: 0, w: 100, h: 100 },
        structure: weightedStructure,
        color: 0,
        shape: 0,
        layout: 0,
      },
    ],
    issues: [],
    weightedAggregate: {
      weightedStructure,
      weightedColor: 0,
      totalWeight: 1,
    },
    aggregateVerdict: "inconclusive",
    rationale: "test",
  };
}

function createResult(comparisonId: string, diffReport: DiffReport): CompareDesignResult {
  return {
    comparisonId,
    matchRate: 90,
    diffPixelCount: 10,
    totalPixelCount: 100,
    diffRegions: [],
    suggestion: "test",
    diffReport,
  };
}

describe("comparison-history", () => {
  it("figma source は fileKey と nodeId でキー化する", () => {
    const parsed: ParsedDesignInput = { type: "figma_url", fileKey: "abc123", nodeId: "1:2" };

    expect(buildComparisonSourceKey(parsed)).toBe("figma:abc123:1:2");
  });

  it("履歴は 1 キーあたり 5 件まで保持する", async () => {
    clearComparisonHistory();
    const sourceKey = "figma:file:node";

    for (let index = 0; index < 6; index++) {
      await recordComparison({
        comparisonId: `cmp-${index}`,
        sourceKey,
        result: createResult(`cmp-${index}`, createReport(0.8 + index * 0.01)),
      });
    }

    expect(getRecentReports(sourceKey)).toHaveLength(5);
    expect(await getComparisonEntry("cmp-0")).toBeUndefined();
    expect((await getComparisonEntry("cmp-5"))?.comparisonId).toBe("cmp-5");
  });

  it("撮影寸法が違う履歴を判別して除外できる", async () => {
    clearComparisonHistory();
    const sourceKey = "figma:file:dimensions";
    const report1440 = createReport(0.8);
    const report2166 = createReport(0.7);

    await recordComparison({
      comparisonId: "cmp-1440",
      sourceKey,
      result: createResult("cmp-1440", report1440),
      captureWidth: 1440,
      captureHeight: 900,
    });
    await recordComparison({
      comparisonId: "cmp-2166",
      sourceKey,
      result: createResult("cmp-2166", report2166),
      captureWidth: 2166,
      captureHeight: 1354,
    });

    const matchingComparisons = getRecentComparisons(sourceKey).filter(
      (entry) => entry.captureWidth === 2166 && entry.captureHeight === 1354,
    );

    expect(matchingComparisons).toEqual([
      {
        report: report2166,
        captureWidth: 2166,
        captureHeight: 1354,
      },
    ]);
  });

  it("履歴上限から外れた比較の永続化ファイルを削除する", async () => {
    clearComparisonHistory();
    const originalHome = process.env.HOME;
    const originalFigdiffHome = process.env.FIGDIFF_HOME;
    const testHome = await fs.mkdtemp(path.join(tmpdir(), "figdiff-history-evict-"));
    const sourceKey = "figma:file:evict";

    try {
      process.env.HOME = testHome;
      // HOME を差し替えて解決先を見る検体。vitest.setup.ts の FIGDIFF_HOME が
      // 残っとるとそちらが勝つので、同じ場所へ向け直す。
      process.env.FIGDIFF_HOME = path.join(testHome, ".figdiff");
      const resultsDir = path.join(testHome, ".figdiff", "results");
      await fs.mkdir(resultsDir, { recursive: true });

      for (let index = 0; index < 6; index++) {
        const comparisonId = `cmp-evict-${index}`;
        await fs.writeFile(path.join(resultsDir, `diff-${comparisonId}.png`), "diff");
        await fs.writeFile(path.join(resultsDir, `${comparisonId}.png`), "legacy");
        await fs.writeFile(path.join(resultsDir, `${comparisonId}.regions.json`), "[]");
        await recordComparison({
          comparisonId,
          sourceKey,
          result: createResult(comparisonId, createReport(0.8 + index * 0.01)),
        });
      }

      await expect(fs.stat(path.join(resultsDir, "diff-cmp-evict-0.png"))).rejects.toThrow();
      await expect(fs.stat(path.join(resultsDir, "cmp-evict-0.png"))).rejects.toThrow();
      await expect(fs.stat(path.join(resultsDir, "cmp-evict-0.regions.json"))).rejects.toThrow();
      await expect(fs.stat(path.join(resultsDir, "diff-cmp-evict-5.png"))).resolves.toBeDefined();
      expect(getRecentReports(sourceKey)).toHaveLength(5);
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalFigdiffHome === undefined) delete process.env.FIGDIFF_HOME;
      else process.env.FIGDIFF_HOME = originalFigdiffHome;
      clearComparisonHistory();
      await fs.rm(testHome, { recursive: true, force: true });
    }
  });

  it("メモリ履歴がない場合はディスクから比較結果を復元する", async () => {
    clearComparisonHistory();
    const originalHome = process.env.HOME;
    const originalFigdiffHome = process.env.FIGDIFF_HOME;
    const testHome = await fs.mkdtemp(path.join(tmpdir(), "figdiff-history-"));

    try {
      process.env.HOME = testHome;
      // HOME を差し替えて解決先を見る検体。vitest.setup.ts の FIGDIFF_HOME が
      // 残っとるとそちらが勝つので、同じ場所へ向け直す。
      process.env.FIGDIFF_HOME = path.join(testHome, ".figdiff");
      const comparisonId = `cmp-disk-${Date.now()}`;
      const sourceKey = "figma:file:disk";

      await recordComparison({
        comparisonId,
        sourceKey,
        result: {
          ...createResult(comparisonId, createReport(0.9)),
          diffImagePath: path.join(testHome, ".figdiff", "results", `diff-${comparisonId}.png`),
          diffImageBase64: "base64-data",
        },
      });

      clearComparisonHistory();

      const restored = await getComparisonEntry(comparisonId);

      expect(restored?.comparisonId).toBe(comparisonId);
      expect(restored?.sourceKey).toBe(sourceKey);
      expect(restored?.result.diffImagePath).toBe(
        path.join(testHome, ".figdiff", "results", `diff-${comparisonId}.png`),
      );
      expect(restored?.result.diffImageBase64).toBeUndefined();
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalFigdiffHome === undefined) delete process.env.FIGDIFF_HOME;
      else process.env.FIGDIFF_HOME = originalFigdiffHome;
      await fs.rm(testHome, { recursive: true, force: true });
    }
  });
});

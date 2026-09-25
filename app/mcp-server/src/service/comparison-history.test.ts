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
  it("isolates nondefault Figma export conditions without changing the default key", () => {
    const parsed: ParsedDesignInput = {
      type: "figma_url",
      fileKey: "fixture",
      nodeId: [8, 13].join(":"),
    };
    const baseline = buildComparisonSourceKey(parsed);
    expect(
      buildComparisonSourceKey(parsed, undefined, undefined, {
        contentsOnly: true,
        useAbsoluteBounds: true,
      }),
    ).toBe(baseline);
    const keys = [
      baseline,
      buildComparisonSourceKey(parsed, undefined, undefined, { contentsOnly: false }),
      buildComparisonSourceKey(parsed, undefined, undefined, { useAbsoluteBounds: false }),
      buildComparisonSourceKey(parsed, undefined, undefined, {
        contentsOnly: false,
        useAbsoluteBounds: false,
      }),
    ];
    expect(new Set(keys).size).toBe(4);
  });

  it("figma source は fileKey と nodeId でキー化する", () => {
    const parsed: ParsedDesignInput = { type: "figma_url", fileKey: "abc123", nodeId: "1:2" };

    expect(buildComparisonSourceKey(parsed)).toBe("figma:abc123:1:2");
  });

  it("直近の履歴は 5 件に絞っても過去の比較 ID は読み戻せる", async () => {
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
    expect((await getComparisonEntry("cmp-0"))?.comparisonId).toBe("cmp-0");
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

  it("再比較とメモリ消去後も全比較の JSON・画像・領域を保持する", async () => {
    clearComparisonHistory();
    const originalFigdiffHome = process.env.FIGDIFF_HOME;
    const testHome = await fs.mkdtemp(path.join(tmpdir(), "figdiff-history-evict-"));
    const sourceKey = "figma:file:evict";
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM5sAAAAASUVORK5CYII=",
      "base64",
    );
    const regions = JSON.stringify([{ bounds: { x: 0, y: 0, width: 1, height: 1 } }]);
    const comparisonCount = 12;

    try {
      process.env.FIGDIFF_HOME = path.join(testHome, ".figdiff");
      const resultsDir = path.join(testHome, ".figdiff", "results");
      await fs.mkdir(resultsDir, { recursive: true });

      for (let index = 0; index < comparisonCount; index++) {
        const comparisonId = `cmp-evict-${index}`;
        await fs.writeFile(path.join(resultsDir, `diff-${comparisonId}.png`), png);
        await fs.writeFile(path.join(resultsDir, `${comparisonId}.png`), png);
        await fs.writeFile(path.join(resultsDir, `${comparisonId}.regions.json`), regions);
        await recordComparison({
          comparisonId,
          sourceKey,
          result: createResult(comparisonId, createReport(0.8 + index * 0.01)),
        });
      }

      expect(getRecentReports(sourceKey)).toHaveLength(5);
      clearComparisonHistory();

      for (let index = 0; index < comparisonCount; index++) {
        const comparisonId = `cmp-evict-${index}`;
        const restored = await getComparisonEntry(comparisonId);
        expect(restored?.comparisonId).toBe(comparisonId);
        expect(restored?.sourceKey).toBe(sourceKey);
        expect(restored?.result).toEqual(
          createResult(comparisonId, createReport(0.8 + index * 0.01)),
        );
        await expect(
          fs.readFile(path.join(resultsDir, `diff-${comparisonId}.png`)),
        ).resolves.toEqual(png);
        await expect(fs.readFile(path.join(resultsDir, `${comparisonId}.png`))).resolves.toEqual(
          png,
        );
        await expect(
          fs.readFile(path.join(resultsDir, `${comparisonId}.regions.json`), "utf-8"),
        ).resolves.toBe(regions);
      }
    } finally {
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

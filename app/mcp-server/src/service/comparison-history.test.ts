import { describe, expect, it } from "vitest";

import type { CompareDesignResult, DiffReport, ParsedDesignInput } from "@figdiff/shared";

import {
  buildComparisonSourceKey,
  clearComparisonHistory,
  getComparisonEntry,
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

  it("メモリ履歴がない場合はディスクから比較結果を復元する", async () => {
    clearComparisonHistory();
    const comparisonId = `cmp-disk-${Date.now()}`;
    const sourceKey = "figma:file:disk";

    await recordComparison({
      comparisonId,
      sourceKey,
      result: {
        ...createResult(comparisonId, createReport(0.9)),
        diffImageBase64: "base64-data",
      },
    });

    clearComparisonHistory();

    const restored = await getComparisonEntry(comparisonId);

    expect(restored?.comparisonId).toBe(comparisonId);
    expect(restored?.sourceKey).toBe(sourceKey);
    expect(restored?.result.diffImageBase64).toBeUndefined();
  });
});

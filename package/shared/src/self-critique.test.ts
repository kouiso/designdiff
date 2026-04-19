import { describe, expect, it } from "vitest";

import { selfCritique } from "./self-critique.js";

import type { DiffReport, RegionScore } from "./type.js";

function createRegionScore(regionId: string, structure: number, figmaNodeId?: string): RegionScore {
  return {
    regionId,
    bbox: { x: 0, y: 0, w: 100, h: 100 },
    figmaNodeId,
    structure,
    color: 0,
    shape: 0,
    layout: 0,
  };
}

function createReport(
  weightedStructure: number,
  verdict: DiffReport["aggregateVerdict"],
): DiffReport {
  const sectionScore = createRegionScore("section-body", weightedStructure, "section-body");

  return {
    alignment: {
      translation: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      confidence: 1,
      residual: 0,
    },
    regionScores: [sectionScore],
    issues: [],
    weightedAggregate: {
      weightedStructure,
      weightedColor: 0,
      totalWeight: 1,
    },
    aggregateVerdict: verdict,
    rationale: "test",
  };
}

describe("selfCritique", () => {
  it("直前比較より 0.05 超悪化したら regression を返す", () => {
    const critique = selfCritique(createReport(0.7, "fail"), [createReport(0.8, "inconclusive")]);

    expect(critique.concern).toBe("regression");
    expect(critique.worstDeltaSection).toBe("section-body");
  });

  it("直近 3 回が fail のまま横ばいなら plateau を返す", () => {
    const critique = selfCritique(createReport(0.801, "fail"), [
      createReport(0.8, "fail"),
      createReport(0.805, "fail"),
    ]);

    expect(critique.concern).toBe("plateau");
  });

  it("直近 3 回が単調でなく狭い範囲を往復したら oscillation を返す", () => {
    const critique = selfCritique(createReport(0.85, "inconclusive"), [
      createReport(0.83, "inconclusive"),
      createReport(0.86, "inconclusive"),
    ]);

    expect(critique.concern).toBe("oscillation");
  });

  it("改善傾向なら healthy を返す", () => {
    const critique = selfCritique(createReport(0.91, "inconclusive"), [
      createReport(0.82, "fail"),
      createReport(0.87, "inconclusive"),
    ]);

    expect(critique.concern).toBe("healthy");
  });
});

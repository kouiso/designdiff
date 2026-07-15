import { describe, expect, it } from "vitest";

import {
  calculatePearsonCorrelation,
  computeCorrelationMetrics,
} from "../../../../verification/script/measure-correlation.mjs";

describe("measure correlation metrics", () => {
  it("3 variants がすべて正解なら accuracy が 100% になること", () => {
    const metrics = computeCorrelationMetrics([
      {
        fixtureId: "pair-a",
        variantName: "correct",
        expectedVerdict: "pass",
        computedVerdict: "pass",
        expectedIssueKinds: [],
        computedIssueKinds: [],
        weightedStructure: 1,
        weightedColor: 0,
        humanSeverity: 1,
        matchesVerdict: true,
        issueKindRecall: null,
        issueKindPrecision: null,
        matchedIssueKinds: [],
        missedIssueKinds: [],
        unexpectedIssueKinds: [],
        worstSectionId: "whole-frame",
        worstSectionScore: 1,
      },
      {
        fixtureId: "pair-a",
        variantName: "borderline",
        expectedVerdict: "inconclusive",
        computedVerdict: "inconclusive",
        expectedIssueKinds: ["position"],
        computedIssueKinds: ["position"],
        weightedStructure: 0.95,
        weightedColor: 1,
        humanSeverity: 0.5,
        matchesVerdict: true,
        issueKindRecall: 1,
        issueKindPrecision: 1,
        matchedIssueKinds: ["position"],
        missedIssueKinds: [],
        unexpectedIssueKinds: [],
        worstSectionId: "section-1",
        worstSectionScore: 0.95,
      },
      {
        fixtureId: "pair-b",
        variantName: "broken",
        expectedVerdict: "fail",
        computedVerdict: "fail",
        expectedIssueKinds: ["color", "size"],
        computedIssueKinds: ["color", "size"],
        weightedStructure: 0.7,
        weightedColor: 8,
        humanSeverity: 0,
        matchesVerdict: true,
        issueKindRecall: 1,
        issueKindPrecision: 1,
        matchedIssueKinds: ["color", "size"],
        missedIssueKinds: [],
        unexpectedIssueKinds: [],
        worstSectionId: "section-2",
        worstSectionScore: 0.7,
      },
    ]);

    expect(metrics.verdictAccuracy.percentage).toBe(100);
    expect(metrics.verdictAccuracy.matched).toBe(3);
    expect(metrics.issueKindRecall.percentage).toBe(100);
    expect(metrics.issueKindPrecision.percentage).toBe(100);
  });

  it("1 variant を誤判定すると accuracy が 66.7% になること", () => {
    const metrics = computeCorrelationMetrics([
      {
        fixtureId: "pair-a",
        variantName: "correct",
        expectedVerdict: "pass",
        computedVerdict: "pass",
        expectedIssueKinds: [],
        computedIssueKinds: [],
        weightedStructure: 1,
        weightedColor: 0,
        humanSeverity: 1,
        matchesVerdict: true,
        issueKindRecall: null,
        issueKindPrecision: null,
        matchedIssueKinds: [],
        missedIssueKinds: [],
        unexpectedIssueKinds: [],
        worstSectionId: "whole-frame",
        worstSectionScore: 1,
      },
      {
        fixtureId: "pair-a",
        variantName: "borderline",
        expectedVerdict: "inconclusive",
        computedVerdict: "fail",
        expectedIssueKinds: ["position"],
        computedIssueKinds: ["position", "size"],
        weightedStructure: 0.9,
        weightedColor: 1.5,
        humanSeverity: 0.5,
        matchesVerdict: false,
        issueKindRecall: 1,
        issueKindPrecision: 0.5,
        matchedIssueKinds: ["position"],
        missedIssueKinds: [],
        unexpectedIssueKinds: ["size"],
        worstSectionId: "section-1",
        worstSectionScore: 0.9,
      },
      {
        fixtureId: "pair-b",
        variantName: "broken",
        expectedVerdict: "fail",
        computedVerdict: "fail",
        expectedIssueKinds: ["color"],
        computedIssueKinds: ["color"],
        weightedStructure: 0.65,
        weightedColor: 10,
        humanSeverity: 0,
        matchesVerdict: true,
        issueKindRecall: 1,
        issueKindPrecision: 1,
        matchedIssueKinds: ["color"],
        missedIssueKinds: [],
        unexpectedIssueKinds: [],
        worstSectionId: "section-2",
        worstSectionScore: 0.65,
      },
    ]);

    expect(metrics.verdictAccuracy.percentage).toBe(66.7);
    expect(metrics.verdictAccuracy.matched).toBe(2);
    expect(metrics.falseClassifications).toHaveLength(1);
  });

  it("Pearson の計算が既知入力と一致すること", () => {
    expect(calculatePearsonCorrelation([1, 0.5, 0], [1, 0.5, 0])).toBe(1);
    expect(calculatePearsonCorrelation([0, 1, 2], [1, 0.5, 0])).toBe(-1);
  });
});

import { describe, expect, it } from "vitest";

import { buildInspectorFixture } from "@/test-fixture/compare-inspector-fixture";

import { buildScoreBreakdown } from "./compare-score";

function structScore(result: ReturnType<typeof buildInspectorFixture>) {
  return buildScoreBreakdown(result).find((item) => item.label === "STRUCT")?.score;
}

describe("buildScoreBreakdown STRUCT", () => {
  it("weightedStructure が無ければ matchRate へ逃げず null を返す", () => {
    expect(structScore(buildInspectorFixture())).toBeNull();
  });

  it("weightedStructure があればその値を百分率で返す", () => {
    const result = buildInspectorFixture();
    if (!result.diffReport) throw new Error("fixture has no diffReport");
    const weightedAggregate = {
      ...(result.diffReport.weightedAggregate ?? {}),
      weightedStructure: 0.9,
    };
    const score = structScore({
      ...result,
      diffReport: { ...result.diffReport, weightedAggregate },
    });
    expect(score).toBeCloseTo(90);
  });
});

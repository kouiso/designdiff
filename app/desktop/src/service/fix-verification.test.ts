import { describe, expect, it } from "vitest";

import type { RegionScore } from "@figdiff/shared";

import {
  compareFixConditions,
  type FixComparisonSnapshot,
  verifyDesktopFix,
} from "./fix-verification";

import type { FixTargetRegionMeasurement } from "./diff-report";
import type { DesktopCompareResult } from "./image-compare";

const region = (regionId: string, structure: number, color = 0, shape = 0): RegionScore => ({
  regionId,
  bbox: { x: 0, y: 0, w: 10, h: 10 },
  structure,
  color,
  shape,
  layout: 0,
});

const result = (
  comparisonId: string,
  regionScores: RegionScore[],
  aggregateVerdict: "pass" | "fail" | "inconclusive" = "fail",
): DesktopCompareResult => ({
  comparisonId,
  matchRate: 90,
  diffPixelCount: 10,
  totalPixelCount: 100,
  diffRegions: [],
  suggestion: "test",
  diffImageBase64: "diff",
  comparisonGeometry: {
    canvas_width: 100,
    canvas_height: 100,
    design_original_width: 100,
    design_original_height: 100,
    screenshot_original_width: 100,
    screenshot_original_height: 100,
  },
  ignoredRegionIds: [],
  incompatibleIgnoreRegionIds: [],
  legacyIgnoreRegionIds: [],
  diffReport: {
    alignment: {
      translation: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      confidence: 1,
      residual: 0,
    },
    regionScores,
    issues: [],
    aggregateVerdict,
    rationale: "test",
  },
});

const snapshot = (
  runId: number,
  compareResult: DesktopCompareResult,
  targetRegion: FixTargetRegionMeasurement | null = null,
): FixComparisonSnapshot => ({
  runId,
  result: compareResult,
  screenshotImage: `screenshot-${runId}`,
  conditions: {
    designImage: "design",
    threshold: 0.1,
    cropRegion: null,
    ignoreRegionEntries: [],
    fileKey: "file",
    nodeId: "frame",
    fixTarget: null,
  },
  targetRegion,
});

const measuredTarget = (structure: number, color = 0, shape = 0): FixTargetRegionMeasurement => ({
  status: "measured",
  nodeId: "12:34",
  nodeName: "Button label",
  score: {
    ...region("fix-target:12:34", structure, color, shape),
    figmaNodeId: "12:34",
  },
  evaluatedPixelCount: 100,
  totalPixelCount: 100,
});

describe("verifyDesktopFix", () => {
  it("局所3軸の改善と現在比較全体の不合格を別々に返す", () => {
    const baseline = snapshot(1, result("before", [region("target", 0.2, 4, 0.3)]));
    const current = snapshot(2, result("after", [region("target", 0.5, 1, 0.1)], "fail"));

    const verification = verifyDesktopFix(baseline, current, "target");
    expect(verification).toMatchObject({
      status: "matched",
      localVerdict: "improved",
      currentAggregateVerdict: "fail",
      colorDelta: -3,
    });
    if (verification.status === "matched") {
      expect(verification.structureDelta).toBeCloseTo(0.3);
      expect(verification.shapeDelta).toBeCloseTo(-0.2);
    }
  });

  it("対象外領域のstructure悪化を副作用として返す", () => {
    const baseline = snapshot(1, result("before", [region("target", 0.2), region("footer", 0.9)]));
    const current = snapshot(2, result("after", [region("target", 0.5), region("footer", 0.7)]));

    const verification = verifyDesktopFix(baseline, current, "target");
    expect(verification).toMatchObject({ status: "matched" });
    if (verification.status === "matched") {
      expect(verification.sideEffects[0]?.nodeId).toBe("footer");
      expect(verification.sideEffects[0]?.delta).toBeCloseTo(-0.2);
    }
  });

  it("任意Figmaノードの独立採点を対象にし、grid悪化を副作用として残す", () => {
    const baseline = snapshot(
      1,
      result("before", [region("top-left", 0.9)]),
      measuredTarget(0.2, 4, 0.3),
    );
    const current = snapshot(
      2,
      result("after", [region("top-left", 0.6)]),
      measuredTarget(0.8, 1, 0.1),
    );

    const verification = verifyDesktopFix(baseline, current, "12-34");
    expect(verification).toMatchObject({
      status: "matched",
      targetId: "12-34",
      localVerdict: "improved",
    });
    if (verification.status === "matched") {
      expect(verification.sideEffects).toHaveLength(1);
      expect(verification.sideEffects[0]?.nodeId).toBe("top-left");
      expect(verification.sideEffects[0]?.delta).toBeCloseTo(-0.3);
    }
  });

  it("任意Figmaノードが一方で全maskなら数値判定しない", () => {
    const baseline = snapshot(1, result("before", [region("top-left", 0.9)]), {
      status: "unmeasured",
      nodeId: "12:34",
      nodeName: "Button label",
      reason: "fully-ignored",
    });
    const current = snapshot(2, result("after", [region("top-left", 0.9)]), measuredTarget(0.8));

    expect(verifyDesktopFix(baseline, current, "12:34")).toEqual({
      status: "target-unmeasured",
      targetId: "12:34",
      which: "baseline",
      reason: "fully-ignored",
    });
  });

  it("現在側の任意Figmaノードがcanvas外なら数値判定しない", () => {
    const baseline = snapshot(1, result("before", [region("top-left", 0.9)]), measuredTarget(0.8));
    const current = snapshot(2, result("after", [region("top-left", 0.9)]), {
      status: "unmeasured",
      nodeId: "12:34",
      nodeName: "Button label",
      reason: "outside-canvas",
    });

    expect(verifyDesktopFix(baseline, current, "12:34")).toEqual({
      status: "target-unmeasured",
      targetId: "12:34",
      which: "current",
      reason: "outside-canvas",
    });
  });

  it("正規化すると同じtarget候補が複数ある場合は任意の一件を採用しない", () => {
    const baseline = snapshot(
      1,
      result("before", [
        { ...region("first", 0.2), figmaNodeId: "12:34" },
        { ...region("second", 0.3), figmaNodeId: "12-34" },
      ]),
    );
    const current = snapshot(
      2,
      result("after", [
        { ...region("first", 0.8), figmaNodeId: "12:34" },
        { ...region("second", 0.7), figmaNodeId: "12-34" },
      ]),
    );

    expect(verifyDesktopFix(baseline, current, "12:34")).toEqual({
      status: "ambiguous",
      targetId: "12:34",
      phase: "target",
      candidateRegionIds: ["first", "second"],
    });
  });

  it("Figma版または対象座標が変わった回は条件不一致にする", () => {
    const baseline = snapshot(1, result("before", [region("top-left", 0.9)]));
    const current = snapshot(2, result("after", [region("top-left", 0.9)]));
    baseline.conditions.fixTarget = {
      sourceVersion: "v1",
      rootNodeId: "1:1",
      targetNodeId: "12:34",
      rootBox: { x: 0, y: 0, width: 100, height: 100 },
      targetBox: { x: 10, y: 10, width: 20, height: 20 },
    };
    current.conditions.fixTarget = {
      ...baseline.conditions.fixTarget,
      sourceVersion: "v2",
    };

    expect(verifyDesktopFix(baseline, current, "12:34")).toEqual({
      status: "conditions-mismatch",
      differences: ["fixTarget"],
    });
  });

  it("同じmask IDの座標変更を条件不一致として拒否する", () => {
    const baseline = snapshot(1, result("before", [region("target", 0.2)]));
    const current = snapshot(2, result("after", [region("target", 0.5)]));
    baseline.conditions.ignoreRegionEntries = [{ id: "mask", x: 1, y: 2, width: 10, height: 10 }];
    current.conditions.ignoreRegionEntries = [{ id: "mask", x: 2, y: 2, width: 10, height: 10 }];

    expect(compareFixConditions(baseline, current)).toContain("ignoreRegions");
    expect(verifyDesktopFix(baseline, current, "target")).toEqual({
      status: "conditions-mismatch",
      differences: ["ignoreRegions"],
    });
  });

  it("mask配列とcoordinate contextのプロパティ順だけの差は同じ条件として扱う", () => {
    const baseline = snapshot(1, result("before", [region("target", 0.2)]));
    const current = snapshot(2, result("after", [region("target", 0.5)]));
    const geometry = baseline.result.comparisonGeometry;
    baseline.conditions.ignoreRegionEntries = [
      { id: "second", x: 2, y: 2, width: 10, height: 10 },
      { id: "first", x: 1, y: 1, width: 10, height: 10, coordinate_context: geometry },
    ];
    current.conditions.ignoreRegionEntries = [
      {
        id: "first",
        x: 1,
        y: 1,
        width: 10,
        height: 10,
        coordinate_context: {
          screenshot_original_height: geometry.screenshot_original_height,
          screenshot_original_width: geometry.screenshot_original_width,
          design_original_height: geometry.design_original_height,
          design_original_width: geometry.design_original_width,
          canvas_height: geometry.canvas_height,
          canvas_width: geometry.canvas_width,
        },
      },
      { id: "second", x: 2, y: 2, width: 10, height: 10 },
    ];

    expect(compareFixConditions(baseline, current)).toEqual([]);
  });

  it("画像寸法やcropなど比較条件が変わった回に局所verdictを作らない", () => {
    const baseline = snapshot(1, result("before", [region("target", 0.2)]));
    const current = snapshot(2, result("after", [region("target", 0.5)]));
    current.conditions.cropRegion = { x: 0, y: 0, width: 50, height: 50 };
    current.result.comparisonGeometry.screenshot_original_height = 200;

    expect(verifyDesktopFix(baseline, current, "target")).toEqual({
      status: "conditions-mismatch",
      differences: ["cropRegion", "imageGeometry"],
    });
  });
});

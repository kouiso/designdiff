import type { DiffIssue, RegionScore } from "@figdiff/shared";

import type { DesktopCompareResult } from "@/service/image-compare";

const REGION_SIZE = { w: 320, h: 120 };

function region(regionId: string, y: number, scope?: "root" | "section"): RegionScore {
  return {
    regionId,
    scope,
    bbox: { x: 0, y, ...REGION_SIZE },
    structure: 0.95,
    color: 1.2,
    shape: 0,
    layout: 0,
  };
}

export const INSPECTOR_FIXTURE_ISSUES: DiffIssue[] = [
  {
    regionId: "btn-primary",
    bbox: { x: 16, y: 560, w: 288, h: 48 },
    kind: "color",
    severity: "critical",
    figmaNodeId: "1:10",
    evidence: {
      signal: "deltaE",
      value: 6.8,
      threshold: 2,
      expected: "#3B5BDB",
      actual: "#4C6EF5",
    },
  },
  {
    regionId: "card-margin",
    bbox: { x: 16, y: 240, w: 288, h: 32 },
    kind: "position",
    severity: "major",
    figmaNodeId: "1:20",
    evidence: {
      signal: "offset",
      value: 8,
      threshold: 2,
      expected: { x: 0, y: 0 },
      actual: { x: 0, y: 8 },
    },
  },
  {
    regionId: "heading-font",
    bbox: { x: 16, y: 32, w: 200, h: 28 },
    kind: "typography",
    severity: "minor",
    evidence: {
      signal: "fontWeight",
      value: 100,
      threshold: 0,
      expected: 700,
      actual: 600,
    },
  },
];

/** 差分1 / 要確認2 / 一致2 になる、検査パネル用の現実的な比較結果。 */
export function buildInspectorFixture(): DesktopCompareResult {
  return {
    comparisonId: "fixture-445",
    matchRate: 78,
    diffPixelCount: 4200,
    totalPixelCount: 192000,
    suggestion: "compare.suggestionMinor",
    diffImageBase64: "",
    diffRegions: [
      {
        id: 0,
        bounds: { x: 16, y: 240, width: 288, height: 368 },
        diffPixelCount: 4200,
        nearbyNodeIds: ["1:10", "1:20"],
        nearbyNodeNames: ["プライマリボタンの背景色", "カード下マージン"],
      },
    ],
    comparisonGeometry: {
      canvas_width: 320,
      canvas_height: 660,
      design_original_width: 320,
      design_original_height: 660,
      screenshot_original_width: 320,
      screenshot_original_height: 660,
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
      regionScores: [
        region("root", 0, "root"),
        region("btn-primary", 560, "section"),
        region("card-margin", 240, "section"),
        region("heading-font", 32, "section"),
        region("balance-card", 80, "section"),
        region("transaction-list", 380, "section"),
      ],
      issues: INSPECTOR_FIXTURE_ISSUES,
      aggregateVerdict: "fail",
      rationale: "1 critical issue",
    },
  };
}

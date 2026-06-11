import { describe, expect, it } from "vitest";

import type { RegionScore } from "../type.js";

import { buildComparisonHeadline } from "./headline.js";

const region = (overrides: Partial<RegionScore>): RegionScore => ({
  regionId: "r",
  bbox: { x: 0, y: 0, w: 100, h: 100 },
  structure: 1,
  color: 0,
  shape: 0,
  layout: 0,
  ...overrides,
});

describe("buildComparisonHeadline", () => {
  it("regionScores が空なら matchRate をそのまま structureMatch にする", () => {
    const headline = buildComparisonHeadline([], 42);
    expect(headline.structureMatch).toBe(42);
    expect(headline.colorOnlyRegions).toBe(0);
    expect(headline.structuralRegions).toBe(0);
  });

  it("色のみ差分と構造差分を分離して数える", () => {
    const headline = buildComparisonHeadline(
      [
        region({ structure: 0.99, color: 8 }), // 色のみ
        region({ structure: 0.99, color: 8 }), // 色のみ
        region({ structure: 0.6, color: 1 }), // 構造差分
        region({ structure: 1, color: 0 }), // 一致
      ],
      30,
    );
    expect(headline.colorOnlyRegions).toBe(2);
    expect(headline.structuralRegions).toBe(1);
    expect(headline.headline).toContain("色のみ差分 2領域");
    expect(headline.headline).toContain("構造差分 1領域");
  });
});

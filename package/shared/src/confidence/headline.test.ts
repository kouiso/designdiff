import { describe, expect, it } from "vitest";

import { buildComparisonHeadline } from "./headline.js";

import type { RegionScore } from "../type.js";

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

  it("canvas が無ければ従来どおり行の単純平均を使う", () => {
    const headline = buildComparisonHeadline(
      [region({ structure: 0 }), region({ structure: 1, bbox: { x: 0, y: 0, w: 10, h: 10 } })],
      99,
    );
    expect(headline.structureMatch).toBe(50);
  });

  it("差分クラスタだけの行は比較面全体に対する面積で薄め、ほぼ一致の画面を 0% にしない", () => {
    // 1512x3697 の画面で 20x20 のグリフ差分が 2 つだけ出た状況。
    const headline = buildComparisonHeadline(
      [
        region({ regionId: "c1", bbox: { x: 10, y: 10, w: 20, h: 20 }, structure: 0 }),
        region({ regionId: "c2", bbox: { x: 100, y: 100, w: 20, h: 20 }, structure: 0 }),
      ],
      99.99,
      { width: 1512, height: 3697 },
    );
    expect(headline.structureMatch).toBe(99.99);
    expect(headline.structuralRegions).toBe(2);
    expect(headline.headline).toContain("構造一致 99.99%");
  });

  it("比較面を覆うセクション行は面積加重平均になり、余白を足さない", () => {
    const headline = buildComparisonHeadline(
      [
        region({ regionId: "top", bbox: { x: 0, y: 0, w: 100, h: 75 }, structure: 1 }),
        region({ regionId: "bottom", bbox: { x: 0, y: 75, w: 100, h: 25 }, structure: 0.6 }),
      ],
      80,
      { width: 100, height: 100 },
    );
    expect(headline.structureMatch).toBe(90);
  });

  it("重なって比較面より広くなった行でも 0〜100 に収まる", () => {
    const headline = buildComparisonHeadline(
      [
        region({ regionId: "a", bbox: { x: 0, y: 0, w: 100, h: 100 }, structure: 0.5 }),
        region({ regionId: "b", bbox: { x: 0, y: 0, w: 100, h: 100 }, structure: 0.5 }),
      ],
      50,
      { width: 100, height: 100 },
    );
    expect(headline.structureMatch).toBe(50);
  });

  it("canvas の寸法が不正なら単純平均へ戻す", () => {
    const headline = buildComparisonHeadline(
      [region({ structure: 0 }), region({ structure: 1 })],
      50,
      { width: 0, height: Number.NaN },
    );
    expect(headline.structureMatch).toBe(50);
  });
});

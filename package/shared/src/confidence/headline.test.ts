import { describe, expect, it } from "vitest";

import { buildComparisonHeadline } from "./headline.js";

import type { RegionScore } from "../type.js";

const region = (overrides: Partial<RegionScore>): RegionScore => ({
  regionId: "diff-cluster-0-0-1-1",
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
        region({
          regionId: "diff-cluster-10-10-20-20",
          bbox: { x: 10, y: 10, w: 20, h: 20 },
          structure: 0,
        }),
        region({
          regionId: "diff-cluster-100-100-20-20",
          bbox: { x: 100, y: 100, w: 20, h: 20 },
          structure: 0,
        }),
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

  it("採点上限で行にならなかった差分面は、検出されなかった面として構造一致に数えない", () => {
    // 100x200 の比較面。採点済みの行は上半分 100x100 (構造 1)。下半分は未採点の差分クラスタ。
    // 手計算: 一致 10,000 画素 / 比較面 20,000 画素 = 50%。未採点面を一致に数えると 100%。
    const rows = [region({ bbox: { x: 0, y: 0, w: 100, h: 100 }, structure: 1 })];
    const canvas = { width: 100, height: 200 };

    expect(buildComparisonHeadline(rows, 50, canvas).structureMatch).toBe(100);
    expect(
      buildComparisonHeadline(rows, 50, { ...canvas, unscoredDiffArea: 10000 }).structureMatch,
    ).toBe(50);
    // 未採点面が比較面の一部だけなら、残りは従来どおり一致に数える: (10,000 + 5,000) / 20,000 = 75%。
    expect(
      buildComparisonHeadline(rows, 50, { ...canvas, unscoredDiffArea: 5000 }).structureMatch,
    ).toBe(75);
  });

  it("canvas の寸法が不正なら単純平均へ戻す", () => {
    const headline = buildComparisonHeadline(
      [region({ structure: 0 }), region({ structure: 1 })],
      50,
      { width: 0, height: Number.NaN },
    );
    expect(headline.structureMatch).toBe(50);
  });

  it("ignore region で外した画素は構造一致として数えない", () => {
    // 100x100 の 99% を ignore で外し、残り 1% (100 画素) が構造 0。
    const headline = buildComparisonHeadline(
      [region({ bbox: { x: 0, y: 0, w: 10, h: 10 }, structure: 0 })],
      0,
      { width: 100, height: 100, maskedPixelCount: 9900 },
    );
    expect(headline.structureMatch).toBe(0);
  });

  it("Figma ノードの行が混ざる比較では、行の外を構造一致として数えない", () => {
    // 比較面 100x100 のうち左上 10x10 だけを Figma セクション行が採点し、構造 0。
    // 行の外は採点していない面なので、一致 99% とは言わず 0% になる。
    const headline = buildComparisonHeadline(
      [region({ regionId: "1:23", bbox: { x: 0, y: 0, w: 10, h: 10 }, structure: 0 })],
      50,
      { width: 100, height: 100 },
    );
    expect(headline.structureMatch).toBe(0);
  });

  it("Figma ノードの行は、ignore region で外した画素がある比較では面積で重み付けせず単純平均にする", () => {
    // 100x100 のセクション (構造 0) はほぼ全面が ignore、続く 100x1 のセクション (構造 1) は外していない。
    // 面積で重み付けすると 1/10,001 ≒ 0.01% に落ちるが、セクションごとの評価は同じ重みなので 50%。
    const headline = buildComparisonHeadline(
      [
        region({ regionId: "1:1", bbox: { x: 0, y: 0, w: 100, h: 100 }, structure: 0 }),
        region({ regionId: "1:2", bbox: { x: 0, y: 100, w: 100, h: 1 }, structure: 1 }),
      ],
      50,
      { width: 100, height: 101, maskedPixelCount: 9900 },
    );
    expect(headline.structureMatch).toBe(50);
  });

  it.each([
    "section",
    "diff-cluster-",
  ])("%s の重みはマスク外の実際の採点画素数に合わせる", (prefix) => {
    const mask = new Uint8Array(100 * 200);
    mask.fill(1, 0, 9900);
    const headline = buildComparisonHeadline(
      [
        region({ regionId: `${prefix}a`, bbox: { x: 0, y: 0, w: 100, h: 100 }, structure: 0 }),
        region({ regionId: `${prefix}b`, bbox: { x: 0, y: 100, w: 100, h: 100 }, structure: 1 }),
      ],
      99.01,
      { width: 100, height: 200, maskedPixelCount: 9900, scoringMask: mask },
    );
    // 一致10000画素 / 採点10100画素。除外9900画素はどちらの重みにも入らない。
    expect(headline.structureMatch).toBe(99.01);
  });

  it("重なる行と不規則なマスクでも採点面の和集合を二重計上しない", () => {
    const headline = buildComparisonHeadline(
      [
        region({ bbox: { x: 0, y: 0, w: 2, h: 2 }, structure: 0.5 }),
        region({ bbox: { x: 0, y: 0, w: 2, h: 1 }, structure: 1 }),
      ],
      62.5,
      { width: 2, height: 2, maskedPixelCount: 1, scoringMask: new Uint8Array([1, 0, 0, 0]) },
    );
    // 行ごとの面積は3と1。加重平均(0.5*3+1*1)/4、和集合の採点面は3画素。
    expect(headline.structureMatch).toBe(62.5);
  });

  it("contain余白内の行は構造一致率の重みへ入れない", () => {
    const headline = buildComparisonHeadline(
      [
        region({ regionId: "left-margin", bbox: { x: 0, y: 0, w: 2, h: 10 }, structure: 0 }),
        region({ regionId: "content", bbox: { x: 2, y: 2, w: 6, h: 6 }, structure: 1 }),
      ],
      100,
      { width: 10, height: 10, contentBounds: { x: 2, y: 2, w: 6, h: 6 } },
    );
    expect(headline.structureMatch).toBe(100);
    expect(headline.structuralRegions).toBe(0);
  });

  it("採点画素が残っていないときに完全一致を報告しない", () => {
    const headline = buildComparisonHeadline([region({ structure: 1 })], 0, {
      width: 2,
      height: 2,
      scoringMask: new Uint8Array([1, 1, 1, 1]),
      maskedPixelCount: 4,
    });
    expect(headline.structureMatch).toBe(0);
    expect(headline.structuralRegions).toBe(0);
  });

  it("採点マスクが比較面全体を覆わない入力は拒否する", () => {
    expect(() =>
      buildComparisonHeadline([region({})], 100, {
        width: 2,
        height: 2,
        scoringMask: new Uint8Array(3),
      }),
    ).toThrow("scoringMask");
  });

  it("実マスクを使う場合も未採点の差分面を一致に数えない", () => {
    const headline = buildComparisonHeadline(
      [region({ bbox: { x: 0, y: 0, w: 100, h: 100 }, structure: 1 })],
      50,
      {
        width: 100,
        height: 200,
        scoringMask: new Uint8Array(20000),
        unscoredDiffArea: 10000,
      },
    );
    expect(headline.structureMatch).toBe(50);
  });
});

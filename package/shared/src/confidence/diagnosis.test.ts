import { describe, expect, it } from "vitest";

import { diagnoseComparison } from "./diagnosis.js";

import type { NormalizationReport, PreflightWarning, RegionScore } from "../type.js";

const region = (overrides: Partial<RegionScore>): RegionScore => ({
  regionId: "r",
  bbox: { x: 0, y: 0, w: 100, h: 100 },
  structure: 1,
  color: 0,
  shape: 0,
  layout: 0,
  ...overrides,
});

const widthWarning: PreflightWarning = {
  code: "width_mismatch",
  severity: "critical",
  message: "幅が違います",
  suggestedFix: "capture_width を合わせてください",
};

const normalizationReport = (overrides?: Partial<NormalizationReport>): NormalizationReport => ({
  designNativeWidth: 1082,
  designNativeHeight: 3931,
  screenshotWidth: 1082,
  screenshotHeight: 1021,
  cropApplied: true,
  containResized: true,
  appliedScale: 0.26,
  ...overrides,
});

// normalizationCause の確度（diagnosis.ts の CONFIDENCE_NORMALIZATION と一致）。
const CONFIDENCE_NORMALIZATION_FOR_TEST = 0.8;

describe("diagnoseComparison", () => {
  it("一致率が高ければ clean", () => {
    const result = diagnoseComparison({
      matchRate: 99.5,
      regionScores: [region({})],
      preflightWarnings: [],
    });
    expect(result.verdict).toBe("clean");
    expect(result.likelyMisconfig).toBe(false);
  });

  it("低一致率 + width_mismatch 警告で likely_misconfig になり原因に width_mismatch が入る", () => {
    const result = diagnoseComparison({
      matchRate: 8,
      regionScores: [region({ structure: 0.99 })],
      preflightWarnings: [widthWarning],
    });
    expect(result.verdict).toBe("likely_misconfig");
    expect(result.likelyMisconfig).toBe(true);
    expect(result.rankedCauses[0].code).toBe("width_mismatch");
    expect(result.headline).toContain("セットアップ問題");
  });

  it("構造は高いが色差が大きいと global_color_shift を検出する", () => {
    const result = diagnoseComparison({
      matchRate: 12,
      regionScores: [region({ structure: 0.97, color: 25 })],
      preflightWarnings: [],
    });
    expect(result.rankedCauses.some((c) => c.code === "global_color_shift")).toBe(true);
    expect(result.verdict).toBe("likely_misconfig");
  });

  it("contain で大きく圧縮された場合 crop_compression を検出する", () => {
    const result = diagnoseComparison({
      matchRate: 5,
      regionScores: [region({ structure: 0.4 })],
      preflightWarnings: [],
      normalization: normalizationReport(),
    });
    expect(result.rankedCauses.some((c) => c.code === "crop_compression")).toBe(true);
  });

  it("極端な圧縮(appliedScale<0.5)は matchRate が高くても likely_misconfig", () => {
    const normalization = normalizationReport({ cropApplied: false });
    const result = diagnoseComparison({
      matchRate: 79,
      regionScores: [region({ structure: 0.55 })],
      preflightWarnings: [],
      normalization,
    });
    expect(result.verdict).toBe("likely_misconfig");
    expect(result.rankedCauses.some((c) => c.code === "aspect_mismatch")).toBe(true);
  });

  it("clean のときは rankedCauses を空にする", () => {
    const result = diagnoseComparison({
      matchRate: 99.9,
      regionScores: [region({ structure: 1, color: 0 })],
      preflightWarnings: [{ code: "width_mismatch", severity: "warning", message: "幅差" }],
    });
    expect(result.verdict).toBe("clean");
    expect(result.rankedCauses).toEqual([]);
  });

  it("crop_out_of_bounds 警告があれば containResized=false でも likely_misconfig", () => {
    const result = diagnoseComparison({
      matchRate: 9,
      regionScores: [region({ structure: 0.5 })],
      preflightWarnings: [
        {
          code: "crop_out_of_bounds",
          severity: "critical",
          message: "crop が範囲外",
          suggestedFix: "crop を更新してください",
        },
      ],
    });
    expect(result.verdict).toBe("likely_misconfig");
    expect(result.rankedCauses.some((c) => c.code === "crop_compression")).toBe(true);
  });

  it("crop_compression の重複は確度の高い方だけ残す", () => {
    const result = diagnoseComparison({
      matchRate: 5,
      regionScores: [region({ structure: 0.4 })],
      preflightWarnings: [{ code: "crop_stale", severity: "warning", message: "古い crop" }],
      normalization: normalizationReport(),
    });
    const cropCauses = result.rankedCauses.filter((c) => c.code === "crop_compression");
    expect(cropCauses).toHaveLength(1);
    expect(cropCauses[0].confidence).toBe(CONFIDENCE_NORMALIZATION_FOR_TEST);
  });

  it("低一致率でも設定ミスの署名が無ければ real_diff", () => {
    const result = diagnoseComparison({
      matchRate: 60,
      regionScores: [region({ structure: 0.6, color: 1 })],
      preflightWarnings: [],
    });
    expect(result.verdict).toBe("real_diff");
    expect(result.likelyMisconfig).toBe(false);
  });
});

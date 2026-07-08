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

  it("低一致率 + aspect_ratio_mismatch 警告で likely_misconfig になり原因に aspect_mismatch が入る", () => {
    const result = diagnoseComparison({
      matchRate: 8,
      regionScores: [region({ structure: 0.99 })],
      preflightWarnings: [
        {
          code: "aspect_ratio_mismatch",
          severity: "warning",
          message: "同一縦横比の別解像度",
          suggestedFix: "capture_width を合わせてください",
        },
      ],
    });
    expect(result.verdict).toBe("likely_misconfig");
    expect(result.likelyMisconfig).toBe(true);
    expect(result.rankedCauses[0].code).toBe("aspect_mismatch");
    expect(result.rankedCauses[0].suggestedFix).toContain("capture_width");
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

  it("極端な圧縮(appliedScale<0.6)は matchRate が高くても likely_misconfig", () => {
    const normalization = normalizationReport({
      designNativeWidth: 1080,
      designNativeHeight: 1080,
      screenshotWidth: 1080,
      screenshotHeight: 2340,
      cropApplied: false,
      appliedScale: 0.46,
    });
    const result = diagnoseComparison({
      matchRate: 79,
      regionScores: [region({ structure: 0.55 })],
      preflightWarnings: [],
      normalization,
    });
    expect(result.verdict).toBe("likely_misconfig");
    const cause = result.rankedCauses.find((c) => c.code === "aspect_mismatch");
    expect(cause?.classification).toBe("wrong_frame_or_misconfig");
    expect(cause?.suggestedFix).toContain("list_figma_frames");
  });

  it("Issue #237 の詳細テンプレート対短い記事ページは likely_misconfig", () => {
    const result = diagnoseComparison({
      matchRate: 79,
      regionScores: [region({ structure: 0.55 })],
      preflightWarnings: [],
      normalization: normalizationReport({
        designNativeWidth: 1512,
        designNativeHeight: 3346,
        screenshotWidth: 1512,
        screenshotHeight: 1798,
        cropApplied: false,
        containResized: true,
        appliedScale: 0.5373580394500896,
      }),
    });

    expect(result.verdict).toBe("likely_misconfig");
    expect(result.likelyMisconfig).toBe(true);
    const cause = result.rankedCauses.find((c) => c.code === "aspect_mismatch");
    expect(cause?.classification).toBe("wrong_frame_or_misconfig");
  });

  it("極端に縦長な Figma フレームは wrong-frame 候補として list_figma_frames guidance を返す", () => {
    const result = diagnoseComparison({
      matchRate: 79,
      regionScores: [region({ structure: 0.55 })],
      preflightWarnings: [],
      normalization: normalizationReport({
        designNativeWidth: 1080,
        designNativeHeight: 6000,
        screenshotWidth: 1080,
        screenshotHeight: 2340,
        cropApplied: false,
        appliedScale: 0.39,
      }),
    });
    const cause = result.rankedCauses.find((c) => c.code === "aspect_mismatch");
    // Issue #237 の実例と同じく、極端な contain 圧縮はフルページ撮影差より誤フレームを優先する。
    expect(result.verdict).toBe("likely_misconfig");
    expect(cause?.classification).toBe("wrong_frame_or_misconfig");
    expect(cause?.suggestedFix).toContain("list_figma_frames");
  });

  it("軽い縦横比差は letterbox 除外済みとして実差分確認に誘導する", () => {
    const result = diagnoseComparison({
      matchRate: 60,
      regionScores: [region({ structure: 0.6, color: 1 })],
      preflightWarnings: [],
      normalization: normalizationReport({
        designNativeWidth: 1080,
        designNativeHeight: 2300,
        screenshotWidth: 1080,
        screenshotHeight: 2340,
        cropApplied: false,
        appliedScale: 1,
      }),
    });
    const cause = result.rankedCauses.find((c) => c.code === "aspect_mismatch");
    expect(result.verdict).toBe("real_diff");
    expect(cause?.classification).toBe("mild_aspect_mismatch");
    expect(cause?.message).toContain("レターボックス余白は差分から除外済み");
    expect(result.headline).toContain("レターボックス余白");
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

  it("critical の crop_out_of_bounds は matchRate が 100 でも likely_misconfig", () => {
    const result = diagnoseComparison({
      matchRate: 100,
      regionScores: [region({ structure: 1, color: 0 })],
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
    expect(result.likelyMisconfig).toBe(true);
  });

  it("warning の crop_out_of_bounds は matchRate が 99.9 なら clean", () => {
    const result = diagnoseComparison({
      matchRate: 99.9,
      regionScores: [region({ structure: 1, color: 0 })],
      preflightWarnings: [
        {
          code: "crop_out_of_bounds",
          severity: "warning",
          message: "crop が範囲外",
          suggestedFix: "crop を更新してください",
        },
      ],
    });
    expect(result.verdict).toBe("clean");
    expect(result.likelyMisconfig).toBe(false);
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

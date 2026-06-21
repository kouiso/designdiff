import { describe, expect, it } from "vitest";

import { runPreflight } from "./preflight.js";

// フレーム幅と一致する標準的なスクショ幅。これとズレると width_mismatch になる前提。
const STANDARD_WIDTH = 1082;
const STANDARD_HEIGHT = 3000;
const WIDE_SCREEN_WIDTH = 1440; // 撮影幅がフレームより明確に広い（>20%）ケース。
const SLIGHTLY_WIDE_WIDTH = 1100; // 許容を超えるが20%未満のケース。
const TALL_SCREEN_HEIGHT = 3931;
const SHORT_CROP_HEIGHT = 1021; // TALL_SCREEN_HEIGHT の60%未満。
const OUT_OF_BOUNDS_CROP_HEIGHT = 5000;
const SUFFICIENT_CHILD_COUNT = 12;

describe("runPreflight", () => {
  const base = { screenshotWidth: STANDARD_WIDTH, screenshotHeight: STANDARD_HEIGHT };

  it("幅が一致していれば width 警告を出さない", () => {
    const report = runPreflight({
      ...base,
      figmaFrameWidth: STANDARD_WIDTH,
      figmaFrameHeight: STANDARD_HEIGHT,
    });
    expect(report.warnings.find((w) => w.code === "width_mismatch")).toBeUndefined();
  });

  it("幅が許容を超えてズレると width_mismatch を出す", () => {
    const report = runPreflight({
      screenshotWidth: WIDE_SCREEN_WIDTH,
      screenshotHeight: STANDARD_HEIGHT,
      figmaFrameWidth: STANDARD_WIDTH,
    });
    const warning = report.warnings.find((w) => w.code === "width_mismatch");
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe("critical");
    expect(warning?.suggestedFix).toContain(String(STANDARD_WIDTH));
  });

  it("capture_device 由来の幅ズレでは capture_width を提案しない", () => {
    const report = runPreflight({
      screenshotWidth: WIDE_SCREEN_WIDTH,
      screenshotHeight: STANDARD_HEIGHT,
      figmaFrameWidth: STANDARD_WIDTH,
      screenshotSource: "capture_device",
    });
    const warning = report.warnings.find((w) => w.code === "width_mismatch");
    expect(warning?.suggestedFix).not.toContain("capture_width");
    expect(warning?.suggestedFix).toContain("物理ピクセル");
  });

  it("レンダリング画像幅が一致するDPR差は info に留める", () => {
    const report = runPreflight({
      screenshotWidth: 1080,
      screenshotHeight: 2340,
      figmaFrameWidth: 1080,
      figmaLogicalFrameWidth: 390,
      screenshotSource: "capture_device",
    });

    expect(report.warnings.find((w) => w.code === "width_mismatch")).toBeUndefined();
    expect(report.warnings.find((w) => w.code === "logical_physical_width")?.severity).toBe("info");
  });

  it("わずかな幅差(<20%)は warning 止まり", () => {
    const report = runPreflight({
      screenshotWidth: SLIGHTLY_WIDE_WIDTH,
      screenshotHeight: STANDARD_HEIGHT,
      figmaFrameWidth: STANDARD_WIDTH,
    });
    expect(report.warnings.find((w) => w.code === "width_mismatch")?.severity).toBe("warning");
  });

  it("crop が画像範囲を超えると crop_out_of_bounds を出す", () => {
    const report = runPreflight({
      ...base,
      cropRegion: { x: 0, y: 0, width: STANDARD_WIDTH, height: OUT_OF_BOUNDS_CROP_HEIGHT },
    });
    expect(report.warnings.find((w) => w.code === "crop_out_of_bounds")?.severity).toBe("critical");
  });

  it("crop 高さがスクショ高さの60%未満なら crop_stale を出す", () => {
    const report = runPreflight({
      screenshotWidth: STANDARD_WIDTH,
      screenshotHeight: TALL_SCREEN_HEIGHT,
      cropRegion: { x: 0, y: 0, width: STANDARD_WIDTH, height: SHORT_CROP_HEIGHT },
      cropUpdatedAt: "2026-01-01T00:00:00.000Z",
    });
    const warning = report.warnings.find((w) => w.code === "crop_stale");
    expect(warning).toBeDefined();
    expect(warning?.message).toContain("2026-01-01");
  });

  it("子要素が0個なら blank_frame を出す（種別未指定の後方互換）", () => {
    const report = runPreflight({ ...base, figmaChildCount: 0 });
    expect(report.warnings.find((w) => w.code === "blank_frame")).toBeDefined();
  });

  it("コンテナ種別（FRAME）で子0個なら blank_frame を出す", () => {
    const report = runPreflight({ ...base, figmaChildCount: 0, figmaNodeType: "FRAME" });
    expect(report.warnings.find((w) => w.code === "blank_frame")).toBeDefined();
  });

  it("描画可能なリーフノード（TEXT）は子0個でも blank_frame を出さない", () => {
    const report = runPreflight({ ...base, figmaChildCount: 0, figmaNodeType: "TEXT" });
    expect(report.warnings.find((w) => w.code === "blank_frame")).toBeUndefined();
  });

  it("リーフノード（RECTANGLE）は子0個でも blank_frame を出さない", () => {
    const report = runPreflight({ ...base, figmaChildCount: 0, figmaNodeType: "RECTANGLE" });
    expect(report.warnings.find((w) => w.code === "blank_frame")).toBeUndefined();
  });

  it("子要素が1個の正当なフレームは blank_frame を出さない", () => {
    const report = runPreflight({ ...base, figmaChildCount: 1 });
    expect(report.warnings.find((w) => w.code === "blank_frame")).toBeUndefined();
  });

  it("通常の十分な子要素では blank_frame を出さない", () => {
    const report = runPreflight({ ...base, figmaChildCount: SUFFICIENT_CHILD_COUNT });
    expect(report.warnings.find((w) => w.code === "blank_frame")).toBeUndefined();
  });
});

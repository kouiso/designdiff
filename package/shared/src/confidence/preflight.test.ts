import { describe, expect, it } from "vitest";

import { runPreflight } from "./preflight.js";

// フレーム幅と一致する標準的なスクショ幅。これとズレると width_mismatch になる前提。
const STANDARD_WIDTH = 1082;
const STANDARD_HEIGHT = 3000;
const WIDE_SCREEN_WIDTH = 1440; // 撮影幅がフレームより明確に広い（>20%）ケース。
const SLIGHTLY_WIDE_WIDTH = 1100; // 許容を超えるが20%未満の同一縦横比ケース。
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

  it("幅と縦横比が許容を超えてズレると width_mismatch を出す", () => {
    const report = runPreflight({
      screenshotWidth: WIDE_SCREEN_WIDTH,
      screenshotHeight: STANDARD_HEIGHT,
      figmaFrameWidth: STANDARD_WIDTH,
      figmaFrameHeight: STANDARD_HEIGHT,
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
      figmaFrameHeight: STANDARD_HEIGHT,
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
      figmaFrameHeight: 2340,
      figmaLogicalFrameWidth: 390,
      screenshotSource: "capture_device",
    });

    expect(report.warnings.find((w) => w.code === "width_mismatch")).toBeUndefined();
    expect(report.warnings.find((w) => w.code === "logical_physical_width")?.severity).toBe("info");
  });

  it("わずかな幅差(<20%)でも同一縦横比の解像度差は warning として残す", () => {
    const report = runPreflight({
      screenshotWidth: SLIGHTLY_WIDE_WIDTH,
      screenshotHeight: (STANDARD_HEIGHT * SLIGHTLY_WIDE_WIDTH) / STANDARD_WIDTH,
      figmaFrameWidth: STANDARD_WIDTH,
      figmaFrameHeight: STANDARD_HEIGHT,
    });
    const warning = report.warnings.find((w) => w.code === "aspect_ratio_mismatch");
    expect(warning?.severity).toBe("warning");
    expect(warning?.suggestedFix).toContain(`capture_width=${STANDARD_WIDTH}`);
    expect(warning?.suggestedFix).toContain("vw");
    expect(warning?.suggestedFix).toContain("viewport");
    expect(report.warnings.find((w) => w.code === "logical_physical_width")).toBeUndefined();
  });

  it("同一縦横比でも標準DPRではない別解像度は aspect_ratio_mismatch を出す", () => {
    const report = runPreflight({
      screenshotWidth: 1170,
      screenshotHeight: 2532,
      figmaFrameWidth: 1080,
      figmaFrameHeight: 2340,
      screenshotSource: "capture_device",
    });

    const warning = report.warnings.find((w) => w.code === "aspect_ratio_mismatch");
    expect(warning?.severity).toBe("warning");
    expect(report.warnings.find((w) => w.code === "logical_physical_width")).toBeUndefined();
  });

  it("幅が一致していても縦横比が大きく違えば高さ向けの修正を提案する", () => {
    const report = runPreflight({
      screenshotWidth: 1080,
      screenshotHeight: 1920,
      figmaFrameWidth: 1080,
      figmaFrameHeight: 2340,
    });

    const warning = report.warnings.find((w) => w.code === "aspect_ratio_mismatch");
    expect(warning?.severity).toBe("critical");
    expect(warning?.suggestedFix).not.toContain("capture_width=");
    expect(warning?.suggestedFix).toContain("content height");
    expect(warning?.suggestedFix).toContain("縦方向");
  });

  it("レンダリング画像幅とスクショ幅が一致するDPR差は info", () => {
    const report = runPreflight({
      screenshotWidth: 1080,
      screenshotHeight: 2340,
      figmaFrameWidth: 1080,
      figmaFrameHeight: 2340,
      figmaLogicalFrameWidth: 390,
      screenshotSource: "capture_device",
    });

    expect(report.warnings.find((w) => w.code === "aspect_ratio_mismatch")).toBeUndefined();
    expect(report.warnings.find((w) => w.code === "logical_physical_width")?.severity).toBe("info");
  });

  it("screenshot_url の幅ズレでは capture_width と vw/viewport 確認を提案する", () => {
    const report = runPreflight({
      screenshotWidth: WIDE_SCREEN_WIDTH,
      screenshotHeight: STANDARD_HEIGHT,
      figmaFrameWidth: STANDARD_WIDTH,
      figmaFrameHeight: STANDARD_HEIGHT,
      screenshotSource: "screenshot_url",
    });

    const warning = report.warnings.find(
      (w) => w.code === "width_mismatch" || w.code === "aspect_ratio_mismatch",
    );
    expect(warning?.suggestedFix).toContain("capture_width");
    expect(warning?.suggestedFix).toContain("vw");
    expect(warning?.suggestedFix).toContain("viewport");
  });

  it("1080.4px の丸め差は幅警告にしない", () => {
    const report = runPreflight({
      screenshotWidth: 1080.4,
      screenshotHeight: 2340,
      figmaFrameWidth: 1080,
      figmaFrameHeight: 2340,
      widthTolerancePx: 1,
    });

    expect(report.warnings.find((w) => w.code === "width_mismatch")).toBeUndefined();
    expect(report.warnings.find((w) => w.code === "aspect_ratio_mismatch")).toBeUndefined();
  });

  it("crop が画像範囲を超えると crop_out_of_bounds を出す", () => {
    const report = runPreflight({
      ...base,
      cropRegion: { x: 0, y: 0, width: STANDARD_WIDTH, height: OUT_OF_BOUNDS_CROP_HEIGHT },
    });
    expect(report.warnings.find((w) => w.code === "crop_out_of_bounds")?.severity).toBe("critical");
  });

  // crop の大きさは古さの根拠にならない。小さい crop は、古い設定とも
  // 意図して絞った範囲とも読める。保存時の撮影寸法が無い crop では判定しない。
  it("crop が小さいだけでは crop_stale を出さない", () => {
    const report = runPreflight({
      screenshotWidth: STANDARD_WIDTH,
      screenshotHeight: TALL_SCREEN_HEIGHT,
      cropRegion: { x: 0, y: 0, width: STANDARD_WIDTH, height: SHORT_CROP_HEIGHT },
      cropUpdatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(report.warnings.find((w) => w.code === "crop_stale")).toBeUndefined();
  });

  // 古さの根拠は「保存したときの撮影寸法と、今回の撮影寸法が違うこと」。
  it("保存時の撮影寸法が今回と違えば crop_stale を出す", () => {
    const report = runPreflight({
      screenshotWidth: 390,
      screenshotHeight: 700,
      rawScreenshotWidth: 390,
      rawScreenshotHeight: 800,
      cropRegion: { x: 0, y: 0, width: 390, height: 700 },
      cropCapturedWidth: 1440,
      cropCapturedHeight: 3000,
    });
    const stale = report.warnings.find((w) => w.code === "crop_stale");
    expect(stale?.severity).toBe("critical");
    expect(stale?.message).toContain("1440x3000");
    expect(stale?.message).toContain("390x800");
  });

  // 意図して狭くした crop は、撮影寸法が保存時と同じなら古くない。
  it("撮影寸法が保存時と同じなら、狭い crop でも crop_stale を出さない", () => {
    const report = runPreflight({
      screenshotWidth: STANDARD_WIDTH,
      screenshotHeight: SHORT_CROP_HEIGHT,
      rawScreenshotWidth: STANDARD_WIDTH,
      rawScreenshotHeight: TALL_SCREEN_HEIGHT,
      cropRegion: { x: 0, y: 0, width: STANDARD_WIDTH, height: SHORT_CROP_HEIGHT },
      cropCapturedWidth: STANDARD_WIDTH,
      cropCapturedHeight: TALL_SCREEN_HEIGHT,
    });
    expect(report.warnings.find((w) => w.code === "crop_stale")).toBeUndefined();
  });

  // crop 後の寸法と比べると x + width > width となり、判定が x > 許容値 に退化する。
  // 保存 crop は x=0 で作られるため、この形では永久に発火しなくなっていた。
  it("crop 前の実寸法を渡せば、x=0 の保存 crop でも範囲外を検出する", () => {
    const report = runPreflight({
      screenshotWidth: 1550,
      screenshotHeight: 900,
      rawScreenshotWidth: 1512,
      rawScreenshotHeight: 900,
      cropRegion: { x: 0, y: 0, width: 1550, height: 900 },
    });

    const warning = report.warnings.find((w) => w.code === "crop_out_of_bounds");
    expect(warning?.severity).toBe("critical");
    expect(warning?.message).toContain("1512x900");
  });

  // set_crop_region は比較範囲を意図的に絞るための機能。絞った crop を
  // 「古い設定」と報告すると、実際の不具合が設定ミスとして UNCERTAIN へ倒れる。
  it("意図的に絞った保存 crop を古い設定として報告しない", () => {
    const report = runPreflight({
      screenshotWidth: 1000,
      screenshotHeight: 300,
      rawScreenshotWidth: 1000,
      rawScreenshotHeight: 1000,
      cropRegion: { x: 0, y: 0, width: 1000, height: 300 },
      cropUpdatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(report.warnings.find((w) => w.code === "crop_stale")).toBeUndefined();
    expect(report.warnings.find((w) => w.code === "crop_out_of_bounds")).toBeUndefined();
  });

  // 壊れた寸法をそのまま境界に使うと、範囲外の crop でも判定が偽になって黙る。
  it("生の寸法が壊れていても範囲外を見逃さない", () => {
    for (const rawScreenshotWidth of [Number.NaN, Number.POSITIVE_INFINITY, 0, -10]) {
      const report = runPreflight({
        screenshotWidth: 1512,
        screenshotHeight: 900,
        rawScreenshotWidth,
        rawScreenshotHeight: 900,
        cropRegion: { x: 0, y: 0, width: 5000, height: 900 },
      });

      expect(report.warnings.find((w) => w.code === "crop_out_of_bounds")?.severity).toBe(
        "critical",
      );
    }
  });

  // CropRegionSchema は非負・正の寸法を保証するが、runPreflight は共有パッケージの
  // 公開関数で、この入力型はその制約を持たない。
  it("左端・上端の範囲外も範囲外として扱う", () => {
    const report = runPreflight({
      screenshotWidth: 1512,
      screenshotHeight: 900,
      rawScreenshotWidth: 1512,
      rawScreenshotHeight: 900,
      cropRegion: { x: -10, y: -10, width: 100, height: 100 },
    });

    expect(report.warnings.find((w) => w.code === "crop_out_of_bounds")?.severity).toBe("critical");
  });

  it("矩形として成立しない寸法も範囲外として扱う", () => {
    for (const cropRegion of [
      { x: 0, y: 0, width: 0, height: 100 },
      { x: 0, y: 0, width: 100, height: -5 },
      { x: Number.NaN, y: 0, width: 100, height: 100 },
    ]) {
      const report = runPreflight({
        screenshotWidth: 1512,
        screenshotHeight: 900,
        rawScreenshotWidth: 1512,
        rawScreenshotHeight: 900,
        cropRegion,
      });

      expect(report.warnings.find((w) => w.code === "crop_out_of_bounds")).toBeDefined();
    }
  });

  it("実寸法に収まる crop では何も出さない", () => {
    const report = runPreflight({
      screenshotWidth: 1512,
      screenshotHeight: 900,
      rawScreenshotWidth: 1512,
      rawScreenshotHeight: 900,
      cropRegion: { x: 0, y: 0, width: 1512, height: 900 },
    });

    expect(report.warnings.find((w) => w.code === "crop_out_of_bounds")).toBeUndefined();
    expect(report.warnings.find((w) => w.code === "crop_stale")).toBeUndefined();
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

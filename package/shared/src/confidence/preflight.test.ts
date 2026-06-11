import { describe, expect, it } from "vitest";

import { runPreflight } from "./preflight.js";

describe("runPreflight", () => {
  const base = { screenshotWidth: 1082, screenshotHeight: 3000 };

  it("幅が一致していれば width 警告を出さない", () => {
    const report = runPreflight({ ...base, figmaFrameWidth: 1082, figmaFrameHeight: 3000 });
    expect(report.warnings.find((w) => w.code === "width_mismatch")).toBeUndefined();
  });

  it("幅が許容を超えてズレると width_mismatch を出す", () => {
    const report = runPreflight({
      screenshotWidth: 1440,
      screenshotHeight: 3000,
      figmaFrameWidth: 1082,
    });
    const warning = report.warnings.find((w) => w.code === "width_mismatch");
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe("critical");
    expect(warning?.suggestedFix).toContain("1082");
  });

  it("わずかな幅差(<20%)は warning 止まり", () => {
    const report = runPreflight({
      screenshotWidth: 1100,
      screenshotHeight: 3000,
      figmaFrameWidth: 1082,
    });
    expect(report.warnings.find((w) => w.code === "width_mismatch")?.severity).toBe("warning");
  });

  it("crop が画像範囲を超えると crop_out_of_bounds を出す", () => {
    const report = runPreflight({
      ...base,
      cropRegion: { x: 0, y: 0, width: 1082, height: 5000 },
    });
    expect(report.warnings.find((w) => w.code === "crop_out_of_bounds")?.severity).toBe("critical");
  });

  it("crop 高さがスクショ高さの60%未満なら crop_stale を出す", () => {
    const report = runPreflight({
      screenshotWidth: 1082,
      screenshotHeight: 3931,
      cropRegion: { x: 0, y: 0, width: 1082, height: 1021 },
      cropUpdatedAt: "2026-01-01T00:00:00.000Z",
    });
    const warning = report.warnings.find((w) => w.code === "crop_stale");
    expect(warning).toBeDefined();
    expect(warning?.message).toContain("2026-01-01");
  });

  it("子要素が1個以下なら blank_frame を出す", () => {
    const report = runPreflight({ ...base, figmaChildCount: 0 });
    expect(report.warnings.find((w) => w.code === "blank_frame")).toBeDefined();
  });

  it("通常の十分な子要素では blank_frame を出さない", () => {
    const report = runPreflight({ ...base, figmaChildCount: 12 });
    expect(report.warnings.find((w) => w.code === "blank_frame")).toBeUndefined();
  });
});

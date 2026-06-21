import { describe, expect, it } from "vitest";

import { buildSystemBarIgnoreRegions } from "./system-bar-ignore-regions.js";

describe("buildSystemBarIgnoreRegions", () => {
  it("Pixel 7 screenshot の上下 system bar マスク座標を返すこと", () => {
    expect(buildSystemBarIgnoreRegions(1080, 2400, "android")).toEqual([
      { x: 0, y: 0, width: 1080, height: 72, label: "system:status-bar" },
      { x: 0, y: 2328, width: 1080, height: 72, label: "system:navigation-bar" },
    ]);
  });

  it("iPhone 14 Pro は notch と home indicator の実px presetを使うこと", () => {
    expect(buildSystemBarIgnoreRegions(1179, 2556, "ios-device")).toEqual([
      { x: 0, y: 0, width: 1179, height: 162, label: "system:status-bar" },
      { x: 0, y: 2454, width: 1179, height: 102, label: "system:navigation-bar" },
    ]);
  });

  it("iPhone SE は home indicator を mask しないこと", () => {
    expect(buildSystemBarIgnoreRegions(750, 1334, "ios-sim")).toEqual([
      { x: 0, y: 0, width: 750, height: 40, label: "system:status-bar" },
    ]);
  });

  it("cropRegion が system bar を切り落とす場合は post-crop 座標に誤配置しないこと", () => {
    expect(
      buildSystemBarIgnoreRegions(1080, 2400, "android", {
        x: 0,
        y: 120,
        width: 1080,
        height: 2160,
      }),
    ).toEqual([]);
  });

  it("cropRegion と重なる system bar だけを post-crop 座標へ変換すること", () => {
    expect(
      buildSystemBarIgnoreRegions(1080, 2400, "android", {
        x: 10,
        y: 2360,
        width: 500,
        height: 40,
      }),
    ).toEqual([{ x: 0, y: 0, width: 500, height: 40, label: "system:navigation-bar" }]);
  });

  it("landscape では高さに対して小さい上限に抑えること", () => {
    expect(buildSystemBarIgnoreRegions(2556, 1179, "ios-device")).toEqual([
      { x: 0, y: 0, width: 2556, height: 96, label: "system:status-bar" },
      { x: 0, y: 1083, width: 2556, height: 96, label: "system:navigation-bar" },
    ]);
  });
});

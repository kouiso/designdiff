import { describe, expect, it } from "vitest";

import { buildSystemBarIgnoreRegions } from "./system-bar-ignore-regions.js";

describe("buildSystemBarIgnoreRegions", () => {
  it("Android screenshot の上下 system bar マスク座標を返すこと", () => {
    expect(buildSystemBarIgnoreRegions(100, 100, "android")).toEqual([
      { x: 0, y: 0, width: 100, height: 4, label: "system:status-bar" },
      { x: 0, y: 97, width: 100, height: 3, label: "system:navigation-bar" },
    ]);
  });

  it("iOS screenshot では iOS 向け比率を使うこと", () => {
    expect(buildSystemBarIgnoreRegions(200, 1000, "ios-device")).toEqual([
      { x: 0, y: 0, width: 200, height: 40, label: "system:status-bar" },
      { x: 0, y: 980, width: 200, height: 20, label: "system:navigation-bar" },
    ]);
  });
});

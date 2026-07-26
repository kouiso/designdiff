import { describe, expect, it } from "vitest";

import type { IgnoreRegion } from "@figdiff/shared";

import { shiftRegionsIntoCropSpace } from "./compare-design-runner.js";

const region = (x: number, y: number, width: number, height: number): IgnoreRegion => ({
  x,
  y,
  width,
  height,
  label: "auto:dynamic",
});

describe("shiftRegionsIntoCropSpace", () => {
  it("crop が無ければそのまま返す", () => {
    const regions = [region(10, 20, 30, 40)];
    expect(shiftRegionsIntoCropSpace(regions, undefined)).toEqual(regions);
  });

  it("crop の原点ぶん平行移動する", () => {
    const result = shiftRegionsIntoCropSpace([region(100, 200, 50, 60)], {
      x: 40,
      y: 80,
      width: 400,
      height: 400,
    });

    expect(result).toEqual([{ x: 60, y: 120, width: 50, height: 60, label: "auto:dynamic" }]);
  });

  it("crop からはみ出した部分は切り落とす", () => {
    const result = shiftRegionsIntoCropSpace([region(0, 0, 200, 200)], {
      x: 50,
      y: 50,
      width: 100,
      height: 100,
    });

    expect(result).toEqual([{ x: 0, y: 0, width: 100, height: 100, label: "auto:dynamic" }]);
  });

  it("crop の外に完全に出ている領域は捨てる", () => {
    const result = shiftRegionsIntoCropSpace([region(0, 0, 20, 20)], {
      x: 100,
      y: 100,
      width: 100,
      height: 100,
    });

    expect(result).toEqual([]);
  });

  it("境界で接するだけの領域は捨てる", () => {
    const result = shiftRegionsIntoCropSpace([region(0, 0, 100, 100)], {
      x: 100,
      y: 0,
      width: 100,
      height: 100,
    });

    expect(result).toEqual([]);
  });

  it("label を保持する", () => {
    const result = shiftRegionsIntoCropSpace(
      [{ x: 10, y: 10, width: 10, height: 10, label: "auto:dynamic" }],
      { x: 0, y: 0, width: 100, height: 100 },
    );

    expect(result[0].label).toBe("auto:dynamic");
  });
});

import { describe, expect, it } from "vitest";

import { applyIgnoreRegions, buildIgnoreMask } from "./ignore-region-mask.js";

describe("ignore region mask", () => {
  it("clips overlapping regions and counts every masked pixel once", () => {
    expect(
      buildIgnoreMask(4, 3, [
        { x: -1, y: 0, width: 3, height: 2 },
        { x: 1, y: 1, width: 3, height: 2 },
      ]).maskedPixelCount,
    ).toBe(9);
  });

  it("normal regions clear both inputs and system regions copy design into screenshot", () => {
    const design = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
    const screenshot = new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]);
    applyIgnoreRegions(design, screenshot, 2, 1, [
      { x: 0, y: 0, width: 1, height: 1 },
      { x: 1, y: 0, width: 1, height: 1, label: "system:status" },
    ]);
    expect([...design]).toEqual([0, 0, 0, 0, 40, 50, 60, 255]);
    expect([...screenshot]).toEqual([0, 0, 0, 0, 40, 50, 60, 255]);
  });

  it("rejects invalid geometry and pixel buffers", () => {
    expect(() => buildIgnoreMask(0, 1, [])).toThrow("Invalid image geometry");
    expect(() =>
      applyIgnoreRegions(new Uint8ClampedArray(3), new Uint8ClampedArray(4), 1, 1, []),
    ).toThrow("Invalid pixel buffer length");
  });
});

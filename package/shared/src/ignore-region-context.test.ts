import { describe, expect, it } from "vitest";

import { classifyIgnoreRegionEntries } from "./ignore-region-context.js";

const context = {
  canvas_width: 100,
  canvas_height: 80,
  design_original_width: 200,
  design_original_height: 160,
  screenshot_original_width: 100,
  screenshot_original_height: 80,
  crop_region: { x: 1, y: 2, width: 90, height: 70 },
};

describe("ignore region coordinate context", () => {
  it("keeps legacy entries but rejects context-bound entries when geometry differs", () => {
    const classification = classifyIgnoreRegionEntries(
      [
        { id: "legacy", x: 0, y: 0, width: 1, height: 1 },
        { id: "bound", x: 0, y: 0, width: 1, height: 1, coordinate_context: context },
      ],
      { ...context, canvas_width: 101 },
    );
    expect(classification.legacy.map((entry) => entry.id)).toEqual(["legacy"]);
    expect(classification.applicable.map((entry) => entry.id)).toEqual(["legacy"]);
    expect(classification.incompatible.map((entry) => entry.id)).toEqual(["bound"]);
  });

  it("accepts an exactly matching context", () => {
    const entry = { id: "bound", x: 0, y: 0, width: 1, height: 1, coordinate_context: context };
    expect(classifyIgnoreRegionEntries([entry], context).applicable).toEqual([entry]);
  });
});

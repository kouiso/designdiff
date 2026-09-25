import { describe, expect, it } from "vitest";

import { compareFixRegions } from "./fix-region-comparison.js";

import type { RegionScore } from "./type.js";

function region(
  nodeId: string,
  structure: number,
  options: {
    color?: number;
    shape?: number;
    scope?: "section" | "root";
    overlappingNodeIds?: string[];
  } = {},
): RegionScore {
  return {
    regionId: `region-${nodeId}`,
    figmaNodeId: nodeId,
    bbox: { x: 0, y: 0, w: 10, h: 10 },
    structure,
    color: options.color ?? 0,
    shape: options.shape ?? 0,
    layout: 0,
    scope: options.scope,
    overlappingNodeIds: options.overlappingNodeIds,
  };
}

describe("compareFixRegions", () => {
  it("overlap側のIDでも対象行を照合し、3軸の実測deltaを返す", () => {
    const result = compareFixRegions(
      [region("top", 0.2, { color: 4, shape: 0.3, overlappingNodeIds: ["1:2"] })],
      [region("top", 0.5, { color: 1, shape: 0.1, overlappingNodeIds: ["1:2"] })],
      "1-2",
    );

    expect(result.status).toBe("matched");
    if (result.status === "matched") {
      expect(result.structureDelta).toBeCloseTo(0.3);
      expect(result.colorDelta).toBe(-3);
      expect(result.shapeDelta).toBeCloseTo(-0.2);
      expect(result.sideEffects).toEqual([]);
    }
  });

  it("代表IDが変わっても共有するoverlap aliasで副作用を照合する", () => {
    const result = compareFixRegions(
      [
        region("target", 0.2, { overlappingNodeIds: ["target-under"] }),
        region("old-top", 0.8, { overlappingNodeIds: ["shared-layer"] }),
      ],
      [
        region("target", 0.5, { overlappingNodeIds: ["target-under"] }),
        region("new-top", 0.7, { overlappingNodeIds: ["shared-layer"] }),
      ],
      "target-under",
    );

    expect(result.status).toBe("matched");
    if (result.status === "matched") {
      expect(result.sideEffects).toHaveLength(1);
      expect(result.sideEffects[0]?.nodeId).toBe("new-top");
      expect(result.sideEffects[0]?.delta).toBeCloseTo(-0.1);
    }
  });

  it("同じaliasが複数行を指す場合は任意の先頭行を選ばない", () => {
    const targetAmbiguous = compareFixRegions(
      [
        region("first", 0.2, { overlappingNodeIds: ["target"] }),
        region("second", 0.8, { overlappingNodeIds: ["target"] }),
      ],
      [region("current", 0.5, { overlappingNodeIds: ["target"] })],
      "target",
    );

    expect(targetAmbiguous).toEqual({
      status: "ambiguous",
      nodeId: "target",
      phase: "target",
      candidateRegionIds: ["region-first", "region-second"],
    });

    const sideEffectAmbiguous = compareFixRegions(
      [region("target", 0.2), region("old-a", 0.8), region("old-b", 0.7)],
      [region("target", 0.5), region("new-side", 0.1, { overlappingNodeIds: ["old-a", "old-b"] })],
      "target",
    );

    expect(sideEffectAmbiguous).toEqual({
      status: "ambiguous",
      nodeId: "new-side",
      phase: "side-effect",
      candidateRegionIds: ["region-old-a", "region-old-b"],
    });
  });

  it("対象行と同じaliasを持つ行やroot行を副作用へ重複計上しない", () => {
    const result = compareFixRegions(
      [
        region("target", 0.2, { overlappingNodeIds: ["target-under"] }),
        region("duplicate", 0.9, { overlappingNodeIds: ["target"] }),
        region("whole-frame", 0.9, { scope: "root" }),
      ],
      [
        region("target", 0.5, { overlappingNodeIds: ["target-under"] }),
        region("duplicate", 0.1, { overlappingNodeIds: ["target"] }),
        region("whole-frame", 0.1, { scope: "root" }),
      ],
      "target-under",
    );

    expect(result).toMatchObject({ status: "matched", sideEffects: [] });
  });

  it("structure悪化が閾値を超えた場合だけ副作用にする", () => {
    const previous = [
      region("target", 0.2),
      region("at-boundary", 0.75),
      region("beyond-boundary", 0.75),
      region("color-only", 0.75, { color: 1, shape: 0.1 }),
    ];
    const current = [
      region("target", 0.5),
      region("at-boundary", 0.7),
      region("beyond-boundary", 0.699),
      region("color-only", 0.75, { color: 9, shape: 0.9 }),
    ];

    const result = compareFixRegions(previous, current, "target");

    expect(result.status).toBe("matched");
    if (result.status === "matched") {
      expect(result.sideEffects.map((effect) => effect.nodeId)).toEqual(["beyond-boundary"]);
    }
  });

  it("対象が欠けた場合は現在比較の代表IDとaliasを診断用に返す", () => {
    const currentRoot = region("whole-frame", 0.5, {
      scope: "root",
      overlappingNodeIds: ["1:2"],
    });
    const result = compareFixRegions([], [currentRoot], "whole-frame");

    expect(result).toEqual({
      status: "missing",
      previousRegion: undefined,
      currentRegion: currentRoot,
      availableRegionIds: ["whole-frame", "1:2"],
    });
  });
});

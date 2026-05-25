import { describe, expect, it } from "vitest";

import { buildTargetNodeIds } from "./compare-design-runner.js";

describe("buildTargetNodeIds", () => {
  it("regionScores の figmaNodeId を structure の低い順で優先して返す", () => {
    const targetNodeIds = buildTargetNodeIds(
      {
        alignment: {
          translation: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          confidence: 1,
          residual: 0,
        },
        regionScores: [
          {
            regionId: "hero",
            figmaNodeId: "hero-node",
            bbox: { x: 0, y: 0, w: 100, h: 100 },
            structure: 0.98,
            color: 0,
            shape: 0,
            layout: 0,
          },
          {
            regionId: "cta",
            figmaNodeId: "cta-node",
            bbox: { x: 0, y: 100, w: 100, h: 100 },
            structure: 0.71,
            color: 2,
            shape: 1,
            layout: 0,
          },
        ],
        issues: [],
        aggregateVerdict: "fail",
        rationale: "test",
      },
      [
        {
          id: 1,
          bounds: { x: 0, y: 0, width: 10, height: 10 },
          diffPixelCount: 50,
          nearbyNodeIds: ["legacy-fallback"],
          nearbyNodeNames: ["Legacy"],
        },
      ],
    );

    expect(targetNodeIds).toEqual(["cta-node", "hero-node", "legacy-fallback"]);
  });

  it("figmaNodeId が無い場合は nearbyNodeIds にフォールバックする", () => {
    const targetNodeIds = buildTargetNodeIds(undefined, [
      {
        id: 1,
        bounds: { x: 10, y: 20, width: 40, height: 50 },
        diffPixelCount: 100,
        nearbyNodeIds: ["node-a", "node-b", "node-a"],
        nearbyNodeNames: ["A", "B", "A"],
      },
    ]);

    expect(targetNodeIds).toEqual(["node-a", "node-b"]);
  });
});

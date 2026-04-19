import { describe, expect, it } from "vitest";

import { computeVerdict } from "./type.js";

import type { Alignment, DiffIssue, RegionScore } from "./type.js";

const alignment: Alignment = {
  translation: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  confidence: 1,
  residual: 0,
};

const createRegionScore = (overrides: Partial<RegionScore> = {}): RegionScore => ({
  regionId: "region-1",
  bbox: { x: 0, y: 0, w: 100, h: 100 },
  structure: 0.98,
  color: 1.2,
  shape: 0.1,
  layout: 0.1,
  ...overrides,
});

const createIssue = (overrides: Partial<DiffIssue> = {}): DiffIssue => ({
  regionId: "region-1",
  bbox: { x: 0, y: 0, w: 100, h: 100 },
  kind: "color",
  severity: "major",
  evidence: {
    signal: "delta-e",
    value: 4.2,
    threshold: 3,
    expected: "#ffffff",
    actual: "#f0f0f0",
  },
  ...overrides,
});

describe("computeVerdict", () => {
  it("1 region で閾値を満たす場合は pass を返す", () => {
    const result = computeVerdict({
      alignment,
      regionScores: [createRegionScore({ structure: 0.97, color: 2.1 })],
      issues: [createIssue()],
    });

    expect(result.verdict).toBe("pass");
    expect(result.weightedAggregate.weightedStructure).toBeCloseTo(0.97, 6);
    expect(result.rationale).toContain("weighted structure score");
  });

  it("critical issue がある場合は fail を返す", () => {
    const result = computeVerdict({
      alignment,
      regionScores: [createRegionScore()],
      issues: [createIssue({ severity: "critical", kind: "missing" })],
    });

    expect(result.verdict).toBe("fail");
    expect(result.rationale).toContain("critical severity issue");
  });

  it("5 region の weighted structure が fail 閾値を下回る場合は fail を返す", () => {
    const result = computeVerdict({
      alignment,
      regionScores: [
        createRegionScore({ regionId: "r1", bbox: { x: 0, y: 0, w: 100, h: 100 }, structure: 0.7 }),
        createRegionScore({
          regionId: "r2",
          bbox: { x: 100, y: 0, w: 100, h: 100 },
          structure: 0.75,
        }),
        createRegionScore({
          regionId: "r3",
          bbox: { x: 200, y: 0, w: 100, h: 100 },
          structure: 0.78,
        }),
        createRegionScore({
          regionId: "r4",
          bbox: { x: 300, y: 0, w: 100, h: 100 },
          structure: 0.79,
        }),
        createRegionScore({
          regionId: "r5",
          bbox: { x: 400, y: 0, w: 100, h: 100 },
          structure: 0.8,
        }),
      ],
      issues: [],
    });

    expect(result.verdict).toBe("fail");
    expect(result.weightedAggregate.weightedStructure).toBeLessThan(0.8);
    expect(result.rationale).toContain("below fail threshold");
  });

  it("1 つの bad region があっても 9 つの green region が支配的なら即 fail にはならない", () => {
    const result = computeVerdict({
      alignment,
      regionScores: [
        createRegionScore({
          regionId: "bad",
          bbox: { x: 0, y: 0, w: 100, h: 100 },
          structure: 0.2,
        }),
        ...Array.from({ length: 9 }, (_, index) =>
          createRegionScore({
            regionId: `good-${index + 1}`,
            bbox: { x: (index + 1) * 100, y: 0, w: 100, h: 100 },
            structure: 0.99,
            color: 1.1,
          }),
        ),
      ],
      issues: [createIssue()],
    });

    expect(result.weightedAggregate.weightedStructure).toBeGreaterThan(0.9);
    expect(result.verdict).toBe("inconclusive");
  });

  it("weighted color が高すぎる場合は inconclusive を返す", () => {
    const result = computeVerdict({
      alignment,
      regionScores: [
        createRegionScore({ regionId: "region-1", structure: 0.97, color: 3.4 }),
        createRegionScore({ regionId: "region-2", structure: 0.98, color: 3.2 }),
      ],
      issues: [createIssue()],
    });

    expect(result.verdict).toBe("inconclusive");
    expect(result.rationale).toContain("do not satisfy pass thresholds");
  });
});

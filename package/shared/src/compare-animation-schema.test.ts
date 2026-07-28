import { describe, expect, it } from "vitest";

import { CompareAnimationResultSchema } from "./schema.js";

const base = {
  frames: [
    {
      atMs: 0,
      screenshotPath: "f0.png",
      status: "PASS",
      matchRate: 1,
      comparisonId: "cmp-0",
    },
  ],
  alignments: [],
  temporal: {
    status: "PASS",
    rationale: "一致しとる。",
    maxAbsDriftMs: null,
    orderViolation: false,
  },
  driftMeasured: false,
  driftUnmeasuredReason: "設計側が1枚だけのため。",
  evidencePaths: ["f0.png"],
};

describe("CompareAnimationResultSchema", () => {
  it("測っていない場合に理由が付いていれば通す", () => {
    expect(CompareAnimationResultSchema.safeParse(base).success).toBe(true);
  });

  it("測っていないのにズレの値が入っていれば弾く", () => {
    const result = CompareAnimationResultSchema.safeParse({
      ...base,
      temporal: { ...base.temporal, maxAbsDriftMs: 0 },
    });
    expect(result.success).toBe(false);
  });

  it("測っていないのに理由が無ければ弾く", () => {
    const { driftUnmeasuredReason: _omitted, ...withoutReason } = base;
    expect(CompareAnimationResultSchema.safeParse(withoutReason).success).toBe(false);
  });

  it("測った場合はズレの値を持てる", () => {
    const result = CompareAnimationResultSchema.safeParse({
      ...base,
      driftMeasured: true,
      driftUnmeasuredReason: undefined,
      temporal: { ...base.temporal, maxAbsDriftMs: 20 },
      alignments: [{ designAtMs: 0, matchedAtMs: 20, driftMs: 20, mismatchRate: 0 }],
      frameTimeSource: "seek",
    });
    expect(result.success).toBe(true);
  });
});

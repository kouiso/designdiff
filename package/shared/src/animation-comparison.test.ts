import { describe, expect, it } from "vitest";

import { type CompareOneFrame, runAnimationCompare } from "./animation-comparison.js";

/** 呼ばれた組み合わせを記録しつつ、あらかじめ決めた一致率を返す差し替え。 */
function stubCompare(
  matchRates: Record<string, number>,
  calls: { design: string; screenshot: string }[] = [],
): CompareOneFrame {
  return async (designSource, screenshotPath) => {
    calls.push({ design: designSource, screenshot: screenshotPath });
    const key = `${designSource}|${screenshotPath}`;
    const matchRate = matchRates[key] ?? 0;
    return {
      status: matchRate >= 0.99 ? "PASS" : "FAIL",
      matchRate,
      comparisonId: `cmp-${screenshotPath}`,
      diffImagePath: `${screenshotPath}.diff.png`,
    };
  };
}

describe("runAnimationCompare 設計側が1枚のとき", () => {
  it("treats a single explicit design frame as static and uses that frame's source", async () => {
    const calls: { design: string; screenshot: string }[] = [];
    const result = await runAnimationCompare(
      {
        designSource: "fallback.png",
        designFrames: [{ path: "explicit.png", atMs: 100 }],
        implFrames: [{ path: "implementation.png", atMs: 130 }],
      },
      stubCompare({ "explicit.png|implementation.png": 1 }, calls),
    );
    expect(calls).toEqual([{ design: "explicit.png", screenshot: "implementation.png" }]);
    expect(result.driftMeasured).toBe(false);
    expect(result.temporal.maxAbsDriftMs).toBeNull();
    expect(result.alignments).toEqual([]);
  });

  const implFrames = [
    { path: "f0.png", atMs: 0 },
    { path: "f1.png", atMs: 100 },
  ];

  it("各時刻を同じ設計と比べ、証拠のパスを返す", async () => {
    const result = await runAnimationCompare(
      { designSource: "design.png", implFrames },
      stubCompare({ "design.png|f0.png": 1, "design.png|f1.png": 1 }),
    );
    expect(result.frames.map((frame) => frame.atMs)).toEqual([0, 100]);
    expect(result.evidencePaths).toEqual(["f0.png", "f1.png"]);
    expect(result.temporal.status).toBe("PASS");
  });

  it("時刻のズレは測らず、測っていない理由を返す", async () => {
    const result = await runAnimationCompare(
      { designSource: "design.png", implFrames },
      stubCompare({ "design.png|f0.png": 1, "design.png|f1.png": 1 }),
    );
    expect(result.driftMeasured).toBe(false);
    expect(result.temporal.maxAbsDriftMs).toBeNull();
    expect(result.driftUnmeasuredReason).toMatch(/design_frames/);
  });

  it("1枚でも見た目が違えば全体を不合格にする", async () => {
    const result = await runAnimationCompare(
      { designSource: "design.png", implFrames },
      stubCompare({ "design.png|f0.png": 1, "design.png|f1.png": 0.5 }),
    );
    expect(result.temporal.status).toBe("FAIL");
  });

  it("実装側が1枚も無ければ落とす", async () => {
    await expect(
      runAnimationCompare({ designSource: "design.png", implFrames: [] }, stubCompare({})),
    ).rejects.toThrow(/1枚もありません/);
  });
});

describe("runAnimationCompare 設計側が時刻つきで複数のとき", () => {
  const implFrames = [
    { path: "f0.png", atMs: 0 },
    { path: "f1.png", atMs: 100 },
    { path: "f2.png", atMs: 200 },
  ];
  const designFrames = [
    { path: "d0.png", atMs: 0 },
    { path: "d1.png", atMs: 100 },
  ];

  it("設計の各時刻に対して、いちばん合う実装の時刻を選びズレを出す", async () => {
    const result = await runAnimationCompare(
      { designSource: "unused", designFrames, implFrames, driftWindowMs: 150 },
      stubCompare({
        "d0.png|f0.png": 1,
        "d0.png|f1.png": 0.2,
        "d1.png|f0.png": 0.2,
        "d1.png|f1.png": 0.4,
        "d1.png|f2.png": 1,
      }),
    );
    expect(result.driftMeasured).toBe(true);
    expect(result.alignments.map((alignment) => alignment.matchedAtMs)).toEqual([0, 200]);
    expect(result.alignments.map((alignment) => alignment.driftMs)).toEqual([0, 100]);
  });

  it("ズレが許容を超えたら不合格にする", async () => {
    const result = await runAnimationCompare(
      {
        designSource: "unused",
        designFrames,
        implFrames,
        driftWindowMs: 150,
        driftFailMs: 50,
      },
      stubCompare({
        "d0.png|f0.png": 1,
        "d0.png|f1.png": 0.2,
        "d1.png|f0.png": 0.2,
        "d1.png|f1.png": 0.4,
        "d1.png|f2.png": 1,
      }),
    );
    expect(result.temporal.status).toBe("FAIL");
    expect(result.temporal.maxAbsDriftMs).toBe(100);
  });

  it("見に行く範囲の外にある時刻は比べない", async () => {
    const calls: { design: string; screenshot: string }[] = [];
    await runAnimationCompare(
      { designSource: "unused", designFrames, implFrames, driftWindowMs: 0 },
      stubCompare({ "d0.png|f0.png": 1, "d1.png|f1.png": 1 }, calls),
    );
    expect(calls).toEqual([
      { design: "d0.png", screenshot: "f0.png" },
      { design: "d1.png", screenshot: "f1.png" },
    ]);
  });

  it("範囲内に実装側の絵が無い時刻は、対応づけずに人へ回す", async () => {
    const result = await runAnimationCompare(
      {
        designSource: "unused",
        designFrames: [
          { path: "d9.png", atMs: 5_000 },
          { path: "d10.png", atMs: 6_000 },
        ],
        implFrames,
        driftWindowMs: 10,
      },
      stubCompare({}),
    );
    expect(result.alignments.map((alignment) => alignment.matchedAtMs)).toEqual([null, null]);
    expect(result.temporal.status).toBe("UNCERTAIN");
  });
});

describe("設計時刻ごとの比較結果", () => {
  it("同じ画像パスを別時刻で再利用しても、時刻ごとの結果と証跡を保持する", async () => {
    const result = await runAnimationCompare(
      {
        designSource: "unused",
        designFrames: [
          { path: "d0.png", atMs: 0 },
          { path: "d1.png", atMs: 100 },
        ],
        implFrames: [
          { path: "shared.png", atMs: 0 },
          { path: "shared.png", atMs: 100 },
        ],
        driftWindowMs: 0,
        driftFailMs: 200,
      },
      async (design) => ({
        status: design === "d0.png" ? "FAIL" : "PASS",
        matchRate: design === "d0.png" ? 0.8 : 1,
        comparisonId: `comparison-${design}`,
        diffImagePath: `diff-${design}`,
      }),
    );

    expect(result.frames).toEqual([
      {
        atMs: 0,
        screenshotPath: "shared.png",
        status: "FAIL",
        matchRate: 0.8,
        comparisonId: "comparison-d0.png",
        diffImagePath: "diff-d0.png",
      },
      {
        atMs: 100,
        screenshotPath: "shared.png",
        status: "PASS",
        matchRate: 1,
        comparisonId: "comparison-d1.png",
        diffImagePath: "diff-d1.png",
      },
    ]);
    expect(result.evidencePaths).toEqual(["shared.png", "shared.png"]);
    expect(result.temporal.status).toBe("FAIL");
  });

  it("同じ実装画像が別設計に一致しても、元の設計への不一致を隠さない", async () => {
    const result = await runAnimationCompare(
      {
        designSource: "unused",
        designFrames: [
          { path: "d0.png", atMs: 0 },
          { path: "d1.png", atMs: 100 },
        ],
        implFrames: [
          { path: "i0.png", atMs: 0 },
          { path: "i1.png", atMs: 100 },
        ],
        driftWindowMs: 150,
        driftFailMs: 200,
      },
      stubCompare({
        "d0.png|i0.png": 0.8,
        "d0.png|i1.png": 0.1,
        "d1.png|i0.png": 1,
        "d1.png|i1.png": 0.2,
      }),
    );
    expect(result.alignments.map((alignment) => alignment.matchedAtMs)).toEqual([0, 0]);
    expect(result.alignments[0].mismatchRate).toBeCloseTo(0.2);
    expect(result.temporal.status).toBe("FAIL");
  });
});

describe("比較callbackの一致率境界", () => {
  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -0.01,
    1.01,
  ])("静止画比較の不正な一致率 %s を拒否する", async (matchRate) => {
    await expect(
      runAnimationCompare(
        {
          designSource: "design.png",
          implFrames: [{ path: "frame.png", atMs: 0 }],
        },
        async () => ({ status: "PASS", matchRate, comparisonId: "invalid-static" }),
      ),
    ).rejects.toThrow(/matchRate/);
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -0.01,
    1.01,
  ])("複数設計比較の不正な一致率 %s を拒否する", async (matchRate) => {
    await expect(
      runAnimationCompare(
        {
          designSource: "unused",
          designFrames: [
            { path: "d0.png", atMs: 0 },
            { path: "d1.png", atMs: 100 },
          ],
          implFrames: [
            { path: "i0.png", atMs: 0 },
            { path: "i1.png", atMs: 100 },
          ],
          driftWindowMs: 0,
        },
        async () => ({ status: "PASS", matchRate, comparisonId: "invalid-animation" }),
      ),
    ).rejects.toThrow(/matchRate/);
  });
});

it("別設計の高い一致率で選択比較のUNCERTAINを隠さない", async () => {
  const result = await runAnimationCompare(
    {
      designSource: "unused",
      designFrames: [
        { path: "uncertain.png", atMs: 0 },
        { path: "pass.png", atMs: 100 },
      ],
      implFrames: [{ path: "frame.png", atMs: 0 }],
      driftWindowMs: 150,
      driftFailMs: 200,
    },
    async (design) => ({
      status: design === "uncertain.png" ? "UNCERTAIN" : "PASS",
      matchRate: design === "uncertain.png" ? 0.99 : 1,
      comparisonId: design,
    }),
  );
  expect(result.temporal.status).toBe("UNCERTAIN");
});

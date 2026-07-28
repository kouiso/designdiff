import { describe, expect, it } from "vitest";

import { type CompareOneFrame, runAnimationCompare } from "./animation-compare-service.js";

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
        designFrames: [{ path: "d9.png", atMs: 5_000 }],
        implFrames,
        driftWindowMs: 10,
      },
      stubCompare({}),
    );
    expect(result.alignments[0].matchedAtMs).toBeNull();
    expect(result.temporal.status).toBe("UNCERTAIN");
  });
});

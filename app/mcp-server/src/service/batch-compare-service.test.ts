import { describe, expect, it } from "vitest";

import type { DiffRegion } from "@figdiff/shared";

import {
  DEFAULT_MAX_INLINE_BATCH_REGIONS,
  type BatchFrameComparison,
  type BatchFrameRequest,
  runBatchCompare,
} from "./batch-compare-service.js";

const makeRegion = (id: number, diffPixelCount: number): DiffRegion => ({
  id,
  bounds: { x: id, y: id, width: 10, height: 10 },
  diffPixelCount,
  nearbyNodeIds: [],
  nearbyNodeNames: [],
});

const makeComparison = (overrides: Partial<BatchFrameComparison> = {}): BatchFrameComparison => ({
  status: "PASS",
  matchRate: 100,
  diffPixelCount: 0,
  comparisonId: "cmp-test",
  diffRegions: [],
  issues: [],
  ...overrides,
});

const stopGuard = (reason: "no-regression" | "regression" | "max-steps" | "uncertain") => ({
  stop: true,
  step: 1,
  maxSteps: 10,
  remainingSteps: 9,
  reason,
  message: `${reason} message`,
});

const continueGuard = () => ({
  stop: false,
  step: 1,
  maxSteps: 10,
  remainingSteps: 9,
  reason: "continue" as const,
  message: "continue message",
});

const requests: BatchFrameRequest[] = [
  { index: 0, label: "home" },
  { index: 1, label: "detail" },
  { index: 2, label: "settings" },
];

const respondWith = (
  responses: readonly (BatchFrameComparison | Error)[],
): { compareOne: (frame: BatchFrameRequest) => Promise<BatchFrameComparison>; calls: string[] } => {
  const calls: string[] = [];
  const compareOne = async (frame: BatchFrameRequest): Promise<BatchFrameComparison> => {
    calls.push(frame.label);
    const response = responses[frame.index];
    if (response instanceof Error) throw response;
    if (response === undefined) throw new Error(`missing response for ${frame.label}`);
    return response;
  };
  return { compareOne, calls };
};

describe("runBatchCompare — aggregate verdict", () => {
  it("全フレーム PASS なら verdict は PASS で件数が揃う", async () => {
    const { compareOne } = respondWith([
      makeComparison({ comparisonId: "cmp-a", loopGuard: stopGuard("no-regression") }),
      makeComparison({ comparisonId: "cmp-b", loopGuard: stopGuard("no-regression") }),
      makeComparison({ comparisonId: "cmp-c", loopGuard: stopGuard("no-regression") }),
    ]);

    const result = await runBatchCompare(requests, compareOne);

    expect(result.verdict).toBe("PASS");
    expect(result).toMatchObject({
      totalFrames: 3,
      passCount: 3,
      failCount: 0,
      uncertainCount: 0,
      errorCount: 0,
    });
    expect(result.comparisonIds).toEqual(["cmp-a", "cmp-b", "cmp-c"]);
    expect(result.frames.map((frame) => frame.label)).toEqual(["home", "detail", "settings"]);
  });

  it("FAIL が1件でもあれば verdict は FAIL", async () => {
    const { compareOne } = respondWith([
      makeComparison({ status: "PASS", comparisonId: "cmp-a" }),
      makeComparison({ status: "FAIL", matchRate: 80, comparisonId: "cmp-b" }),
      makeComparison({ status: "PASS", comparisonId: "cmp-c" }),
    ]);

    const result = await runBatchCompare(requests, compareOne);

    expect(result.verdict).toBe("FAIL");
    expect(result).toMatchObject({ passCount: 2, failCount: 1, errorCount: 0 });
  });

  it("UNCERTAIN は PASS と区別して数える", async () => {
    const { compareOne } = respondWith([
      makeComparison({ status: "UNCERTAIN", comparisonId: "cmp-a" }),
      makeComparison({ status: "PASS", comparisonId: "cmp-b" }),
      makeComparison({ status: "PASS", comparisonId: "cmp-c" }),
    ]);

    const result = await runBatchCompare(requests, compareOne);

    expect(result.verdict).toBe("UNCERTAIN");
    expect(result.uncertainCount).toBe(1);
  });

  it("実行エラーは FAIL より優先して verdict を ERROR にする", async () => {
    const { compareOne } = respondWith([
      makeComparison({ status: "FAIL", comparisonId: "cmp-a" }),
      new Error("screenshot not found"),
      makeComparison({ status: "PASS", comparisonId: "cmp-c" }),
    ]);

    const result = await runBatchCompare(requests, compareOne);

    expect(result.verdict).toBe("ERROR");
    expect(result.frames[1]).toMatchObject({
      label: "detail",
      status: "ERROR",
      error: "screenshot not found",
    });
    // エラーでも比較できたフレームは残る。
    expect(result.frames[0]?.status).toBe("FAIL");
    expect(result.frames[2]?.status).toBe("PASS");
    expect(result.comparisonIds).toEqual(["cmp-a", "cmp-c"]);
  });
});

describe("runBatchCompare — per-item isolation and order", () => {
  it("1件の例外で残りを打ち切らず、入力順に逐次実行する", async () => {
    const { compareOne, calls } = respondWith([
      makeComparison({ comparisonId: "cmp-a" }),
      new Error("boom"),
      makeComparison({ comparisonId: "cmp-c" }),
    ]);

    const result = await runBatchCompare(requests, compareOne);

    expect(calls).toEqual(["home", "detail", "settings"]);
    expect(result.frames.map((frame) => frame.status)).toEqual(["PASS", "ERROR", "PASS"]);
    expect(result.errorCount).toBe(1);
  });

  it("ERROR フレームは数値を 0 で埋めず未設定のまま返す", async () => {
    const { compareOne } = respondWith([new Error("decode failed")]);

    const result = await runBatchCompare([{ index: 0, label: "broken" }], compareOne);

    expect(result.frames[0]?.matchRate).toBeUndefined();
    expect(result.frames[0]?.diffPixelCount).toBeUndefined();
    expect(result.frames[0]?.comparisonId).toBeUndefined();
    expect(result.frames[0]?.diffRegions).toEqual([]);
  });

  it("フレームが空なら比較を始めずエラーにする", async () => {
    let called = false;
    const compareOne = async (): Promise<BatchFrameComparison> => {
      called = true;
      return makeComparison();
    };

    await expect(runBatchCompare([], compareOne)).rejects.toThrow(
      "比較するフレームが1件もありません",
    );
    expect(called).toBe(false);
  });
});

describe("runBatchCompare — region truncation", () => {
  it("差分領域は既定で上位3件のみ返し、全件数と切り詰めを明示する", async () => {
    const regions = [makeRegion(1, 5), makeRegion(2, 90), makeRegion(3, 30), makeRegion(4, 1)];
    const { compareOne } = respondWith([
      makeComparison({ status: "FAIL", comparisonId: "cmp-a", diffRegions: regions }),
    ]);

    const result = await runBatchCompare([{ index: 0, label: "home" }], compareOne);
    const frame = result.frames[0];

    expect(DEFAULT_MAX_INLINE_BATCH_REGIONS).toBe(3);
    expect(frame?.diffRegions.map((region) => region.id)).toEqual([2, 3, 1]);
    expect(frame?.totalRegionCount).toBe(4);
    expect(frame?.returnedRegionCount).toBe(3);
    expect(frame?.regionsTruncated).toBe(true);
  });

  it("全件が上限以内なら切り詰めない", async () => {
    const { compareOne } = respondWith([
      makeComparison({ diffRegions: [makeRegion(1, 5), makeRegion(2, 90)] }),
    ]);

    const result = await runBatchCompare([{ index: 0, label: "home" }], compareOne);

    expect(result.frames[0]?.regionsTruncated).toBe(false);
    expect(result.frames[0]?.returnedRegionCount).toBe(2);
  });
});

describe("runBatchCompare — recurring issues", () => {
  it("2フレーム以上に出た種別だけを件数降順で返す", async () => {
    const { compareOne } = respondWith([
      makeComparison({
        issues: [
          { kind: "color", severity: "critical" },
          { kind: "position", severity: "major" },
        ],
      }),
      makeComparison({
        issues: [
          { kind: "color", severity: "minor" },
          { kind: "position", severity: "major" },
          { kind: "size", severity: "minor" },
        ],
      }),
      makeComparison({ issues: [{ kind: "color", severity: "critical" }] }),
    ]);

    const result = await runBatchCompare(requests, compareOne);

    expect(result.recurringIssues).toEqual([
      {
        kind: "color",
        frameCount: 3,
        frameLabels: ["home", "detail", "settings"],
        severities: ["critical", "minor"],
      },
      {
        kind: "position",
        frameCount: 2,
        frameLabels: ["home", "detail"],
        severities: ["major"],
      },
    ]);
  });

  it("同じ種別が1フレームに複数あってもフレーム数は1として数える", async () => {
    const { compareOne } = respondWith([
      makeComparison({
        issues: [
          { kind: "color", severity: "critical" },
          { kind: "color", severity: "minor" },
        ],
      }),
      makeComparison({ issues: [{ kind: "color", severity: "major" }] }),
    ]);

    const result = await runBatchCompare([...requests].slice(0, 2), compareOne);

    expect(result.recurringIssues).toHaveLength(1);
    expect(result.recurringIssues[0]).toMatchObject({
      kind: "color",
      frameCount: 2,
      severities: ["critical", "major", "minor"],
    });
  });

  it("1フレームにしか出ない種別は共通差分に含めない", async () => {
    const { compareOne } = respondWith([
      makeComparison({ issues: [{ kind: "missing", severity: "critical" }] }),
      makeComparison({ issues: [] }),
    ]);

    const result = await runBatchCompare([...requests].slice(0, 2), compareOne);

    expect(result.recurringIssues).toEqual([]);
  });

  it("フレーム単位の issueKinds は重複を畳んで返す", async () => {
    const { compareOne } = respondWith([
      makeComparison({
        issues: [
          { kind: "color", severity: "critical" },
          { kind: "color", severity: "minor" },
          { kind: "position", severity: "major" },
        ],
      }),
    ]);

    const result = await runBatchCompare([{ index: 0, label: "home" }], compareOne);

    expect(result.frames[0]?.issueKinds).toEqual(["color", "position"]);
  });
});

describe("runBatchCompare — convergence", () => {
  it("続行できるフレームがあれば continue", async () => {
    const { compareOne } = respondWith([
      makeComparison({ status: "FAIL", loopGuard: continueGuard() }),
      makeComparison({ status: "PASS", loopGuard: stopGuard("no-regression") }),
    ]);

    const result = await runBatchCompare([...requests].slice(0, 2), compareOne);

    expect(result.convergence.status).toBe("continue");
    expect(result.convergence.continuingLabels).toEqual(["home"]);
    expect(result.convergence.convergedLabels).toEqual(["detail"]);
  });

  it("全フレームが no-regression で停止したら converged", async () => {
    const { compareOne } = respondWith([
      makeComparison({ status: "PASS", loopGuard: stopGuard("no-regression") }),
      makeComparison({ status: "PASS", loopGuard: stopGuard("no-regression") }),
    ]);

    const result = await runBatchCompare([...requests].slice(0, 2), compareOne);

    expect(result.convergence.status).toBe("converged");
    expect(result.convergence.message).toContain("全 2 フレームが収束");
  });

  it("続行が無く成功以外で停止したフレームがあれば blocked", async () => {
    const { compareOne } = respondWith([
      makeComparison({ status: "FAIL", loopGuard: stopGuard("regression") }),
      makeComparison({ status: "PASS", loopGuard: stopGuard("no-regression") }),
    ]);

    const result = await runBatchCompare([...requests].slice(0, 2), compareOne);

    expect(result.convergence.status).toBe("blocked");
    expect(result.convergence.blockedLabels).toEqual(["home"]);
  });

  it("実行エラーのフレームは評価不能として blocked に数える", async () => {
    const { compareOne } = respondWith([
      new Error("boom"),
      makeComparison({ status: "PASS", loopGuard: stopGuard("no-regression") }),
    ]);

    const result = await runBatchCompare([...requests].slice(0, 2), compareOne);

    expect(result.convergence.status).toBe("blocked");
    expect(result.convergence.unevaluatedLabels).toEqual(["home"]);
  });

  it("停止判定が無いフレームは評価不能として扱う", async () => {
    const { compareOne } = respondWith([makeComparison({ status: "PASS" })]);

    const result = await runBatchCompare([{ index: 0, label: "home" }], compareOne);

    expect(result.convergence.status).toBe("blocked");
    expect(result.convergence.unevaluatedLabels).toEqual(["home"]);
  });
});

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  LOOP_STATE_TTL_MS,
  MAX_LOOP_ITERATIONS,
  recordIterationAndEvaluate,
  resetLoopState,
  type LoopIterationInput,
} from "./loop-guard-service.js";

describe("loop-guard-service", () => {
  let stateDir: string;
  const baseNow = 1_700_000_000_000;

  beforeEach(async () => {
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "figdiff-loop-guard-"));
  });

  afterEach(async () => {
    await fs.rm(stateDir, { recursive: true, force: true });
  });

  function input(overrides: Partial<LoopIterationInput> = {}): LoopIterationInput {
    return {
      sourceKey: "figma:file:1:2",
      comparisonId: `cmp-${Math.random().toString(36).slice(2)}`,
      matchRate: 80,
      captureWidth: 1440,
      captureHeight: 900,
      structuralVerdict: "fail",
      status: "FAIL",
      ...overrides,
    };
  }

  it("continues on the first failing iteration", async () => {
    const report = await recordIterationAndEvaluate(input(), { stateDir, now: baseNow });

    expect(report.iteration).toBe(1);
    expect(report.decision).toBe("continue");
  });

  it("stops immediately when status is PASS", async () => {
    const report = await recordIterationAndEvaluate(
      input({ status: "PASS", structuralVerdict: "pass", matchRate: 100 }),
      { stateDir, now: baseNow },
    );

    expect(report.decision).toBe("stop");
    expect(report.reason).toContain("PASS");
  });

  it("stops and requests human review when status is UNCERTAIN", async () => {
    const report = await recordIterationAndEvaluate(input({ status: "UNCERTAIN" }), {
      stateDir,
      now: baseNow,
    });

    expect(report.decision).toBe("stop");
    expect(report.reason).toContain("UNCERTAIN");
    expect(report.reason).toContain("人間");
  });

  it("stops when the iteration limit is reached", async () => {
    let report: Awaited<ReturnType<typeof recordIterationAndEvaluate>> | undefined;
    // 反復ごとに matchRate を大きく動かし、停滞判定に先に引っかからないようにする。
    const rates = [10, 30, 50, 70, 90];
    for (let i = 0; i < MAX_LOOP_ITERATIONS; i++) {
      report = await recordIterationAndEvaluate(input({ matchRate: rates[i] }), {
        stateDir,
        now: baseNow + i * 1000,
      });
    }

    expect(report?.iteration).toBe(MAX_LOOP_ITERATIONS);
    expect(report?.decision).toBe("stop");
    expect(report?.reason).toContain("上限");
  });

  it("stops on stagnation: two consecutive sub-threshold matchRate deltas", async () => {
    const rates = [80.0, 80.2, 80.3];
    let report: Awaited<ReturnType<typeof recordIterationAndEvaluate>> | undefined;
    for (let i = 0; i < rates.length; i++) {
      report = await recordIterationAndEvaluate(input({ matchRate: rates[i] }), {
        stateDir,
        now: baseNow + i * 1000,
      });
    }

    expect(report?.iteration).toBe(3);
    expect(report?.decision).toBe("stop");
    expect(report?.reason).toContain("停滞");
  });

  it("stops with identical-result reason for three identical comparison outputs", async () => {
    let report: Awaited<ReturnType<typeof recordIterationAndEvaluate>> | undefined;
    for (let i = 0; i < 3; i++) {
      report = await recordIterationAndEvaluate(
        input({ matchRate: 80, diffPixelCount: 1200, regionCount: 4 }),
        { stateDir, now: baseNow + i * 1000 },
      );
    }

    expect(report?.iteration).toBe(3);
    expect(report?.decision).toBe("stop");
    expect(report?.reason).toContain("完全に同一");
    expect(report?.reason).toContain("diffPixelCount");
  });

  it("does not use identical-result stop when diffPixelCount differs", async () => {
    const diffPixelCounts = [1200, 1190, 1180];
    let report: Awaited<ReturnType<typeof recordIterationAndEvaluate>> | undefined;
    for (let i = 0; i < diffPixelCounts.length; i++) {
      report = await recordIterationAndEvaluate(
        input({ matchRate: 80, diffPixelCount: diffPixelCounts[i], regionCount: 4 }),
        { stateDir, now: baseNow + i * 1000 },
      );
    }

    expect(report?.iteration).toBe(3);
    expect(report?.decision).toBe("stop");
    expect(report?.reason).toContain("停滞");
    expect(report?.reason).not.toContain("完全に同一");
  });

  it("keeps continuing while matchRate is still improving", async () => {
    const rates = [60, 70, 80, 90];
    let report: Awaited<ReturnType<typeof recordIterationAndEvaluate>> | undefined;
    for (let i = 0; i < rates.length; i++) {
      report = await recordIterationAndEvaluate(input({ matchRate: rates[i] }), {
        stateDir,
        now: baseNow + i * 1000,
      });
    }

    expect(report?.iteration).toBe(4);
    expect(report?.decision).toBe("continue");
  });

  it("expires stale entries so an old loop does not leak into a new one", async () => {
    await recordIterationAndEvaluate(input({ matchRate: 50 }), { stateDir, now: baseNow });

    const report = await recordIterationAndEvaluate(input({ matchRate: 51 }), {
      stateDir,
      now: baseNow + LOOP_STATE_TTL_MS + 1,
    });

    expect(report.iteration).toBe(1);
    expect(report.decision).toBe("continue");
  });

  it("tracks loops per sourceKey independently", async () => {
    await recordIterationAndEvaluate(input({ sourceKey: "figma:a:1:1" }), {
      stateDir,
      now: baseNow,
    });
    const report = await recordIterationAndEvaluate(input({ sourceKey: "figma:b:2:2" }), {
      stateDir,
      now: baseNow + 1000,
    });

    expect(report.iteration).toBe(1);
  });

  // 上限/停滞で止めた履歴が残り続けると、人間が直したあとの再実行まで
  // TTL(2時間)のあいだ stop を返し続ける。停止を返した時点で役目は終わっている。
  it("clears history after a cap stop so the next campaign starts fresh", async () => {
    for (let i = 0; i < MAX_LOOP_ITERATIONS; i++) {
      await recordIterationAndEvaluate(input({ matchRate: 50 + i * 5 }), {
        stateDir,
        now: baseNow + i,
      });
    }

    const next = await recordIterationAndEvaluate(input({ matchRate: 60 }), {
      stateDir,
      now: baseNow + 100,
    });

    expect(next.iteration).toBe(1);
    expect(next.decision).toBe("continue");
  });

  // 停滞判定は Math.abs を使うため、悪化し続ける実行が閾値を超えて "continue" になる。
  // 悪化しているのに編集を続けろと指示するのは、停止判定として誤り。
  it("stops when the match rate keeps getting worse", async () => {
    const rates = [90, 85, 80];
    let report = await recordIterationAndEvaluate(input({ matchRate: rates[0] }), {
      stateDir,
      now: baseNow,
    });
    for (let i = 1; i < rates.length; i++) {
      report = await recordIterationAndEvaluate(input({ matchRate: rates[i] }), {
        stateDir,
        now: baseNow + i,
      });
    }

    expect(report.decision).toBe("stop");
    expect(report.reason).toContain("悪化");
  });

  // ページ全体を撮ると高さは中身の量で決まる。実装で1行足すだけで変わるので、
  // 高さを条件にすると実装を直すたびに履歴が捨てられ、停止判定が働かない。
  it("幅が同じなら、高さが変わっても悪化の履歴を捨てないこと", async () => {
    await recordIterationAndEvaluate(input({ matchRate: 80, captureHeight: 3000 }), {
      stateDir,
      now: baseNow,
    });
    await recordIterationAndEvaluate(input({ matchRate: 70, captureHeight: 3200 }), {
      stateDir,
      now: baseNow + 1000,
    });
    const third = await recordIterationAndEvaluate(input({ matchRate: 60, captureHeight: 3400 }), {
      stateDir,
      now: baseNow + 2000,
    });

    expect(third.iteration).toBe(3);
  });

  it("撮影寸法が変わったら悪化履歴をリセットする", async () => {
    await recordIterationAndEvaluate(input({ matchRate: 90 }), {
      stateDir,
      now: baseNow,
    });
    await recordIterationAndEvaluate(input({ matchRate: 85 }), {
      stateDir,
      now: baseNow + 1000,
    });

    const report = await recordIterationAndEvaluate(
      input({
        matchRate: 80,
        captureWidth: 2166,
        captureHeight: 1354,
      }),
      {
        stateDir,
        now: baseNow + 2000,
      },
    );

    expect(report.iteration).toBe(1);
    expect(report.decision).toBe("continue");
    expect(report.reason).not.toContain("悪化");
  });

  it("寸法がない古い履歴は新しい撮影条件と比較しない", async () => {
    await recordIterationAndEvaluate(
      input({
        matchRate: 90,
        captureWidth: undefined,
        captureHeight: undefined,
      }),
      {
        stateDir,
        now: baseNow,
      },
    );

    const report = await recordIterationAndEvaluate(input({ matchRate: 80 }), {
      stateDir,
      now: baseNow + 1000,
    });

    expect(report.iteration).toBe(1);
    expect(report.decision).toBe("continue");
  });

  it("resetLoopState clears the history for the key", async () => {
    await recordIterationAndEvaluate(input({ matchRate: 50 }), { stateDir, now: baseNow });
    await recordIterationAndEvaluate(input({ matchRate: 60 }), {
      stateDir,
      now: baseNow + 1000,
    });

    await resetLoopState("figma:file:1:2", { stateDir });

    const report = await recordIterationAndEvaluate(input({ matchRate: 70 }), {
      stateDir,
      now: baseNow + 2000,
    });
    expect(report.iteration).toBe(1);
  });

  describe("停滞判定に見える差の割合を合成する", () => {
    async function runSeries(
      series: readonly { matchRate: number; perceptibleDiffRatio?: number }[],
    ) {
      let report: Awaited<ReturnType<typeof recordIterationAndEvaluate>> | undefined;
      for (const [i, step] of series.entries()) {
        report = await recordIterationAndEvaluate(input(step), {
          stateDir,
          now: baseNow + i * 1000,
        });
      }
      if (report === undefined) throw new Error("series must not be empty");
      return report;
    }

    it("matchRate が止まっていても見える差が減っていれば続行する", async () => {
      const report = await runSeries([
        { matchRate: 80.0, perceptibleDiffRatio: 0.4 },
        { matchRate: 80.1, perceptibleDiffRatio: 0.25 },
        { matchRate: 80.2, perceptibleDiffRatio: 0.1 },
      ]);

      expect(report.decision).toBe("continue");
      expect(report.reason).toContain("人が見て分かる差");
    });

    it("matchRate も見える差も止まっていれば停止する", async () => {
      const report = await runSeries([
        { matchRate: 80.0, perceptibleDiffRatio: 0.4 },
        { matchRate: 80.1, perceptibleDiffRatio: 0.401 },
        { matchRate: 80.2, perceptibleDiffRatio: 0.402 },
      ]);

      expect(report.decision).toBe("stop");
      expect(report.reason).toContain("停滞");
      expect(report.reason).toContain("どちらも動いていません");
    });

    it("見える差の記録が無ければ従来どおり matchRate だけで停滞と判定する", async () => {
      const report = await runSeries([
        { matchRate: 80.0 },
        { matchRate: 80.1 },
        { matchRate: 80.2 },
      ]);

      expect(report.decision).toBe("stop");
      expect(report.reason).toContain("停滞");
    });

    it("3件のうち1件でも見える差が欠けていれば matchRate だけで判定する", async () => {
      const report = await runSeries([
        { matchRate: 80.0, perceptibleDiffRatio: 0.4 },
        { matchRate: 80.1 },
        { matchRate: 80.2, perceptibleDiffRatio: 0.1 },
      ]);

      expect(report.decision).toBe("stop");
      expect(report.reason).toContain("停滞");
    });

    it("見える差が2回続けて増えたら matchRate が改善していても停止する", async () => {
      const report = await runSeries([
        { matchRate: 60, perceptibleDiffRatio: 0.1 },
        { matchRate: 70, perceptibleDiffRatio: 0.3 },
        { matchRate: 80, perceptibleDiffRatio: 0.5 },
      ]);

      expect(report.decision).toBe("stop");
      expect(report.reason).toContain("人が見て分かる差が2回続けて増えています");
    });

    it("見える差が増えても1回だけなら停止しない", async () => {
      const report = await runSeries([
        { matchRate: 60, perceptibleDiffRatio: 0.4 },
        { matchRate: 70, perceptibleDiffRatio: 0.1 },
        { matchRate: 80, perceptibleDiffRatio: 0.2 },
      ]);

      expect(report.decision).toBe("continue");
    });

    it("閾値未満の下降は悪化として扱わない", async () => {
      const report = await runSeries([
        { matchRate: 80.2, perceptibleDiffRatio: 0.4 },
        { matchRate: 80.1, perceptibleDiffRatio: 0.401 },
        { matchRate: 80.0, perceptibleDiffRatio: 0.402 },
      ]);

      expect(report.decision).toBe("stop");
      expect(report.reason).toContain("停滞");
      expect(report.reason).not.toContain("悪化");
    });

    it("matchRate の悪化判定は見える差より先に効く", async () => {
      const report = await runSeries([
        { matchRate: 90, perceptibleDiffRatio: 0.1 },
        { matchRate: 80, perceptibleDiffRatio: 0.1 },
        { matchRate: 70, perceptibleDiffRatio: 0.1 },
      ]);

      expect(report.decision).toBe("stop");
      expect(report.reason).toContain("matchRate が2回続けて悪化");
    });
  });
});

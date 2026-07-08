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
});

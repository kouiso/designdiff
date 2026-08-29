import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ConvergenceIteration, LoopGuardReport } from "@figdiff/shared";

import {
  listConvergenceHistories,
  readConvergenceHistory,
  recordConvergenceIteration,
} from "./convergence-history.js";

let dir: string;

const iteration = (matchRate: number, timestamp: number): ConvergenceIteration => ({
  comparisonId: `cmp-${timestamp}`,
  matchRate,
  structuralVerdict: "fail",
  status: "FAIL",
  timestamp,
});

const stopReport: LoopGuardReport = {
  stop: true,
  step: 2,
  maxSteps: 10,
  remainingSteps: 8,
  reason: "no-regression",
  message: "PASS に到達しました",
};

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(tmpdir(), "figdiff-convergence-"));
  process.env.FIGDIFF_CONVERGENCE_DIR = dir;
});

afterEach(async () => {
  process.env.FIGDIFF_CONVERGENCE_DIR = undefined;
  delete process.env.FIGDIFF_CONVERGENCE_DIR;
  await fs.rm(dir, { recursive: true, force: true });
});

describe("recordConvergenceIteration", () => {
  it("同じ比較対象の反復を1つのキャンペーンに積む", async () => {
    await recordConvergenceIteration({ sourceKey: "local:/a.png", iteration: iteration(90, 1000) });
    await recordConvergenceIteration({ sourceKey: "local:/a.png", iteration: iteration(95, 2000) });

    const history = await readConvergenceHistory("local:/a.png");
    expect(history.campaigns).toHaveLength(1);
    expect(history.campaigns[0].iterations.map((entry) => entry.matchRate)).toEqual([90, 95]);
    expect(history.campaigns[0].startedAt).toBe(history.campaigns[0].iterations[0].timestamp);
  });

  it("比較対象が違えば別ファイルに分かれる", async () => {
    await recordConvergenceIteration({ sourceKey: "local:/a.png", iteration: iteration(90, 1000) });
    await recordConvergenceIteration({ sourceKey: "local:/b.png", iteration: iteration(80, 1000) });

    expect((await readConvergenceHistory("local:/a.png")).campaigns).toHaveLength(1);
    expect((await readConvergenceHistory("local:/b.png")).campaigns).toHaveLength(1);
  });

  it("停止判定でキャンペーンを閉じ、理由を残す", async () => {
    await recordConvergenceIteration({ sourceKey: "local:/a.png", iteration: iteration(90, 1000) });
    await recordConvergenceIteration({
      sourceKey: "local:/a.png",
      iteration: iteration(100, 2000),
      loopGuard: stopReport,
    });

    const [campaign] = (await readConvergenceHistory("local:/a.png")).campaigns;
    expect(campaign.endedAt).toBe(2000);
    expect(campaign.endReason).toBe("no-regression");
    expect(campaign.endMessage).toBe("PASS に到達しました");
  });

  // 閉じたキャンペーンへ後続を足すと、直したあとの再挑戦が前回の失敗の続きに見える。
  it("閉じたあとの反復は新しいキャンペーンになる", async () => {
    await recordConvergenceIteration({
      sourceKey: "local:/a.png",
      iteration: iteration(100, 1000),
      loopGuard: stopReport,
    });
    await recordConvergenceIteration({ sourceKey: "local:/a.png", iteration: iteration(70, 2000) });

    const { campaigns } = await readConvergenceHistory("local:/a.png");
    expect(campaigns).toHaveLength(2);
    expect(campaigns[1].endedAt).toBeUndefined();
    expect(campaigns[0].campaignId).not.toBe(campaigns[1].campaignId);
  });

  it("壊れた履歴は捨てて記録を続ける", async () => {
    await recordConvergenceIteration({ sourceKey: "local:/a.png", iteration: iteration(90, 1000) });
    const [name] = await fs.readdir(dir);
    await fs.writeFile(path.join(dir, name), "{ not json");

    await recordConvergenceIteration({ sourceKey: "local:/a.png", iteration: iteration(91, 2000) });
    const { campaigns } = await readConvergenceHistory("local:/a.png");
    expect(campaigns).toHaveLength(1);
    expect(campaigns[0].iterations).toHaveLength(1);
  });

  it("キャンペーンは5件までに切り詰める", async () => {
    for (let index = 0; index < 7; index += 1) {
      await recordConvergenceIteration({
        sourceKey: "local:/a.png",
        iteration: iteration(80 + index, 1000 + index),
        loopGuard: stopReport,
      });
    }
    const { campaigns } = await readConvergenceHistory("local:/a.png");
    expect(campaigns).toHaveLength(5);
    expect(campaigns[4].iterations[0].matchRate).toBe(86);
  });
});

describe("listConvergenceHistories", () => {
  it("最後に動いた順で返す", async () => {
    await recordConvergenceIteration({
      sourceKey: "local:/old.png",
      iteration: iteration(90, 1000),
    });
    await recordConvergenceIteration({
      sourceKey: "local:/new.png",
      iteration: iteration(90, 5000),
    });

    const histories = await listConvergenceHistories();
    expect(histories.map((history) => history.sourceKey)).toEqual([
      "local:/new.png",
      "local:/old.png",
    ]);
  });

  it("履歴が無いときは空配列を返す", async () => {
    await fs.rm(dir, { recursive: true, force: true });
    expect(await listConvergenceHistories()).toEqual([]);
  });
});

// 対象ごとに1ファイル増える。上限が無いと ~/.figdiff が使うほど太り続ける。
describe("履歴ファイルの上限", () => {
  it("比較対象が 50 を超えたら古いものから捨てる", async () => {
    for (let index = 0; index < 55; index += 1) {
      await recordConvergenceIteration({
        sourceKey: `local:/target-${index}.png`,
        iteration: iteration(90, 1000 + index),
      });
    }

    const names = (await fs.readdir(dir)).filter((name) => name.endsWith(".json"));
    expect(names).toHaveLength(50);
    // いま書いた対象は必ず残る。
    expect((await readConvergenceHistory("local:/target-54.png")).campaigns).toHaveLength(1);
    expect((await readConvergenceHistory("local:/target-0.png")).campaigns).toHaveLength(0);
  });
});

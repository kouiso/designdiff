import { beforeEach, describe, expect, it } from "vitest";

import type { ConvergenceHistory } from "@figdiff/shared";

import { latestCampaign, useConvergenceStore } from "./convergence-store";

const history = (sourceKey: string, iterations: number): ConvergenceHistory => ({
  sourceKey,
  campaigns: [
    {
      campaignId: `camp-${sourceKey}`,
      sourceKey,
      startedAt: 1000,
      updatedAt: 1000 + iterations,
      iterations: Array.from({ length: iterations }, (_, index) => ({
        comparisonId: `cmp-${sourceKey}-${index}`,
        matchRate: 90 + index,
        structuralVerdict: "fail" as const,
        status: "FAIL" as const,
        timestamp: 1000 + index,
      })),
    },
  ],
});

beforeEach(() => {
  useConvergenceStore.setState({
    histories: [],
    selectedSourceKey: null,
    loading: true,
    unavailable: false,
  });
});

describe("useConvergenceStore", () => {
  it("最初の履歴が来たら先頭を開く", () => {
    useConvergenceStore.getState().setHistories([history("local:/a.png", 2)]);
    expect(useConvergenceStore.getState().selectedSourceKey).toBe("local:/a.png");
    expect(useConvergenceStore.getState().loading).toBe(false);
  });

  // 裏で履歴が更新されるたびに選択が飛ぶと、見とる途中の反復が消える。
  it("人が選んだ対象は、あとから来た更新で奪われへん", () => {
    useConvergenceStore.getState().setHistories([history("local:/a.png", 1)]);
    useConvergenceStore.getState().selectSourceKey("local:/b.png");
    useConvergenceStore
      .getState()
      .setHistories([history("local:/c.png", 1), history("local:/b.png", 1)]);

    expect(useConvergenceStore.getState().selectedSourceKey).toBe("local:/b.png");
  });

  it("読めん環境では unavailable を立てて読み込みを終える", () => {
    useConvergenceStore.getState().setUnavailable(true);
    expect(useConvergenceStore.getState().unavailable).toBe(true);
    expect(useConvergenceStore.getState().loading).toBe(false);
  });
});

describe("latestCampaign", () => {
  it("反復が1件も無いキャンペーンは選ばん", () => {
    const empty: ConvergenceHistory = {
      sourceKey: "local:/a.png",
      campaigns: [
        { campaignId: "c1", sourceKey: "local:/a.png", startedAt: 1, updatedAt: 1, iterations: [] },
      ],
    };
    expect(latestCampaign(empty)).toBeUndefined();
  });

  it("履歴が無いときは undefined を返す", () => {
    expect(latestCampaign(undefined)).toBeUndefined();
  });
});

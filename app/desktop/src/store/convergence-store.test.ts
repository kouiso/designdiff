import { beforeEach, describe, expect, it } from "vitest";

import type { ConvergenceHistory } from "@figdiff/shared";

import { latestCampaign, useConvergenceStore } from "./convergence-store";

const history = (
  sourceKey: string,
  iterations: number,
  campaignId = `camp-${sourceKey}`,
): ConvergenceHistory => ({
  sourceKey,
  campaigns: [
    {
      campaignId,
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
    selectedCampaignId: null,
    loading: true,
    unavailable: false,
    error: null,
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

  // 保持上限で対象が消えたのに選択が残ると、履歴があるのに詳細が空になる。
  it("選択中の対象が履歴から消えたら先頭へ落とす", () => {
    useConvergenceStore.getState().setHistories([history("local:/a.png", 1)]);
    useConvergenceStore.getState().selectCampaign("camp-local:/a.png");

    useConvergenceStore.getState().setHistories([history("local:/b.png", 1)]);

    expect(useConvergenceStore.getState().selectedSourceKey).toBe("local:/b.png");
    // 別対象のキャンペーン id を持ち越すと、選んだつもりの無い回が開く。
    expect(useConvergenceStore.getState().selectedCampaignId).toBeNull();
  });

  // 対象が残っとっても、選んどった回だけが保持上限で消えることがある。
  // id を握ったままやと、画面は最新を出しとるのにチップは古い回を指したままになる。
  it("選択中のキャンペーンが消えたら最新へ戻す", () => {
    useConvergenceStore.getState().setHistories([history("local:/a.png", 1, "camp-old")]);
    useConvergenceStore.getState().selectCampaign("camp-old");

    useConvergenceStore.getState().setHistories([history("local:/a.png", 1, "camp-new")]);

    expect(useConvergenceStore.getState().selectedSourceKey).toBe("local:/a.png");
    expect(useConvergenceStore.getState().selectedCampaignId).toBeNull();
  });

  it("残っとるキャンペーンの選択は保つ", () => {
    useConvergenceStore.getState().setHistories([history("local:/a.png", 1, "camp-keep")]);
    useConvergenceStore.getState().selectCampaign("camp-keep");

    useConvergenceStore.getState().setHistories([history("local:/a.png", 2, "camp-keep")]);

    expect(useConvergenceStore.getState().selectedCampaignId).toBe("camp-keep");
  });

  it("読み取り失敗は空の履歴と区別して持つ", () => {
    useConvergenceStore.getState().setError("EACCES");
    expect(useConvergenceStore.getState().error).toBe("EACCES");
    expect(useConvergenceStore.getState().loading).toBe(false);
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

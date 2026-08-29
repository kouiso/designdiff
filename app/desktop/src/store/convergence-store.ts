import { useEffect } from "react";

import { create } from "zustand";

import type { ConvergenceCampaign, ConvergenceHistory } from "@figdiff/shared";

import { getConvergence } from "@/lib/platform";

interface ConvergenceState {
  histories: ConvergenceHistory[];
  selectedSourceKey: string | null;
  /** null なら「いちばん新しいキャンペーン」を見る。 */
  selectedCampaignId: string | null;
  loading: boolean;
  /** 収束履歴を読めん環境 (Web ビルド等) かどうか。空の履歴と区別する。 */
  unavailable: boolean;
  /** 読み取りに失敗したときの理由。空の履歴と区別する。 */
  error: string | null;
  setHistories: (histories: ConvergenceHistory[]) => void;
  selectSourceKey: (sourceKey: string | null) => void;
  selectCampaign: (campaignId: string | null) => void;
  setLoading: (loading: boolean) => void;
  setUnavailable: (unavailable: boolean) => void;
  setError: (error: string | null) => void;
}

export const useConvergenceStore = create<ConvergenceState>((set) => ({
  histories: [],
  selectedSourceKey: null,
  selectedCampaignId: null,
  loading: true,
  unavailable: false,
  error: null,
  setHistories: (histories) =>
    set((state) => {
      // 人が選んだ対象は裏の更新で奪わん。ただし保持上限で消えた対象を持ったままやと、
      // 履歴があるのに詳細が空のままになるので、その時だけ先頭へ落とす。
      const stillThere = histories.some((entry) => entry.sourceKey === state.selectedSourceKey);
      const selectedSourceKey = stillThere
        ? state.selectedSourceKey
        : (histories[0]?.sourceKey ?? null);
      return {
        histories,
        selectedSourceKey,
        selectedCampaignId:
          selectedSourceKey === state.selectedSourceKey ? state.selectedCampaignId : null,
        loading: false,
        error: null,
      };
    }),
  // 対象を変えたらキャンペーンの選択は捨てる。別対象の id を持ち越すと、
  // 選んだつもりの無い回が開く。
  selectSourceKey: (selectedSourceKey) => set({ selectedSourceKey, selectedCampaignId: null }),
  selectCampaign: (selectedCampaignId) => set({ selectedCampaignId }),
  setLoading: (loading) => set({ loading }),
  setUnavailable: (unavailable) => set({ unavailable, loading: false }),
  setError: (error) => set({ error, loading: false }),
}));

/** 表示できるキャンペーン。反復が1件も無いものは出さん。新しい順。 */
export const visibleCampaigns = (history: ConvergenceHistory | undefined): ConvergenceCampaign[] =>
  [...(history?.campaigns ?? [])].filter((campaign) => campaign.iterations.length > 0).reverse();

/** 直近のキャンペーン。 */
export const latestCampaign = (
  history: ConvergenceHistory | undefined,
): ConvergenceCampaign | undefined => visibleCampaigns(history)[0];

export const selectedHistory = (state: ConvergenceState): ConvergenceHistory | undefined =>
  state.histories.find((history) => history.sourceKey === state.selectedSourceKey);

/**
 * MCP サーバが履歴を書き足すたびに画面へ反映する。
 * active-session の同期と同じ形 (初回 read + push 購読) に揃えてある。
 */
export function useConvergenceSync(): void {
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    const sync = async (): Promise<void> => {
      const convergence = await getConvergence();
      if (cancelled) return;
      if (!convergence) {
        useConvergenceStore.getState().setUnavailable(true);
        return;
      }

      // 読み取りの失敗を空配列へ潰すと、履歴があるのに「記録がありません」と出る。
      const histories = await convergence.list();
      if (cancelled) return;
      useConvergenceStore.getState().setHistories(histories);

      unsubscribe = convergence.onUpdated((updated) => {
        useConvergenceStore.getState().setHistories(updated);
      });
    };
    sync().catch((reason: unknown) => {
      if (cancelled) return;
      useConvergenceStore
        .getState()
        .setError(reason instanceof Error ? reason.message : String(reason));
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);
}

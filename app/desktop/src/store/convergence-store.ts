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
  setHistories: (histories: ConvergenceHistory[]) => void;
  selectSourceKey: (sourceKey: string | null) => void;
  selectCampaign: (campaignId: string | null) => void;
  setLoading: (loading: boolean) => void;
  setUnavailable: (unavailable: boolean) => void;
}

export const useConvergenceStore = create<ConvergenceState>((set) => ({
  histories: [],
  selectedSourceKey: null,
  selectedCampaignId: null,
  loading: true,
  unavailable: false,
  setHistories: (histories) =>
    set((state) => ({
      histories,
      // 何も選んでへんときだけ先頭を開く。人が選んだ対象を、裏の更新で奪わん。
      selectedSourceKey: state.selectedSourceKey ?? histories[0]?.sourceKey ?? null,
      loading: false,
    })),
  // 対象を変えたらキャンペーンの選択は捨てる。別対象の id を持ち越すと、
  // 選んだつもりの無い回が開く。
  selectSourceKey: (selectedSourceKey) => set({ selectedSourceKey, selectedCampaignId: null }),
  selectCampaign: (selectedCampaignId) => set({ selectedCampaignId }),
  setLoading: (loading) => set({ loading }),
  setUnavailable: (unavailable) => set({ unavailable, loading: false }),
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

      const histories = await convergence.list().catch(() => []);
      if (cancelled) return;
      useConvergenceStore.getState().setHistories(histories);

      unsubscribe = convergence.onUpdated((updated) => {
        useConvergenceStore.getState().setHistories(updated);
      });
    };
    sync().catch(() => {
      useConvergenceStore.getState().setUnavailable(true);
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);
}

import { useEffect } from "react";

import { create } from "zustand";

import type { ConvergenceCampaign, ConvergenceHistory } from "@figdiff/shared";

import { getConvergence } from "@/lib/platform";

interface ConvergenceState {
  histories: ConvergenceHistory[];
  selectedSourceKey: string | null;
  loading: boolean;
  /** 収束履歴を読めん環境 (Web ビルド等) かどうか。空の履歴と区別する。 */
  unavailable: boolean;
  setHistories: (histories: ConvergenceHistory[]) => void;
  selectSourceKey: (sourceKey: string | null) => void;
  setLoading: (loading: boolean) => void;
  setUnavailable: (unavailable: boolean) => void;
}

export const useConvergenceStore = create<ConvergenceState>((set) => ({
  histories: [],
  selectedSourceKey: null,
  loading: true,
  unavailable: false,
  setHistories: (histories) =>
    set((state) => ({
      histories,
      // 何も選んでへんときだけ先頭を開く。人が選んだ対象を、裏の更新で奪わん。
      selectedSourceKey: state.selectedSourceKey ?? histories[0]?.sourceKey ?? null,
      loading: false,
    })),
  selectSourceKey: (selectedSourceKey) => set({ selectedSourceKey }),
  setLoading: (loading) => set({ loading }),
  setUnavailable: (unavailable) => set({ unavailable, loading: false }),
}));

/** 直近のキャンペーン。反復が1件も無いものは表示対象にならん。 */
export const latestCampaign = (
  history: ConvergenceHistory | undefined,
): ConvergenceCampaign | undefined =>
  history?.campaigns.filter((campaign) => campaign.iterations.length > 0).at(-1);

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

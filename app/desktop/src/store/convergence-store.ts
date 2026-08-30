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

/** 表示できるキャンペーン。反復が1件も無いものは出さん。新しい順。 */
export const visibleCampaigns = (history: ConvergenceHistory | undefined): ConvergenceCampaign[] =>
  [...(history?.campaigns ?? [])].filter((campaign) => campaign.iterations.length > 0).reverse();

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
      // 対象が残っとっても、選んどった回そのものが保持上限で消えることがある。
      // 消えた id を握ったままやと「最新へ落ちた」のに選択チップだけ古い回を
      // 指したままになるので、残っとる回に無ければ null (= 最新) へ戻す。
      const nextHistory = histories.find((entry) => entry.sourceKey === selectedSourceKey);
      const campaignStillThere = visibleCampaigns(nextHistory).some(
        (campaign) => campaign.campaignId === state.selectedCampaignId,
      );
      return {
        histories,
        selectedSourceKey,
        selectedCampaignId:
          selectedSourceKey === state.selectedSourceKey && campaignStillThere
            ? state.selectedCampaignId
            : null,
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

    const fail = (reason: unknown): void => {
      if (cancelled) return;
      useConvergenceStore
        .getState()
        .setError(reason instanceof Error ? reason.message : String(reason));
    };

    const sync = async (): Promise<void> => {
      const convergence = await getConvergence();
      if (cancelled) return;
      if (!convergence) {
        useConvergenceStore.getState().setUnavailable(true);
        return;
      }

      // 読み取りの失敗を空配列へ潰すと、履歴があるのに「記録がありません」と出る。
      // 通知が続けて来ると list() が重なる。返ってくる順は投げた順とは限らんので
      // (readdir + ファイル数ぶんの readFile で、通知の間隔 200ms を超え得る)、
      // 素直に書くと古い結果や古いエラーが新しい表示を上書きする。
      // 最後に投げた1本だけを採る。
      let latest = 0;
      const load = async (): Promise<void> => {
        const seq = ++latest;
        try {
          const histories = await convergence.list();
          if (cancelled || seq !== latest) return;
          useConvergenceStore.getState().setHistories(histories);
        } catch (reason: unknown) {
          if (cancelled || seq !== latest) return;
          fail(reason);
        }
      };

      await load();

      // 更新の通知は「変わった」だけ。中身は初回と同じ list() で取り直す。
      // main 側で読んだ結果を積んで貰う形にすると読み取り経路が2本になり、
      // 片方だけ失敗を伝えん状態が生まれる（実際にそうなっとった）。
      unsubscribe = convergence.onUpdated(() => {
        // load は自分で握るので実質ここへは来ん。想定外の失敗を落とさんため残す。
        load().catch(fail);
      });
    };
    sync().catch(fail);

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);
}

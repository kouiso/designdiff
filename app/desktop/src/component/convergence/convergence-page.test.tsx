import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConvergenceHistory } from "@figdiff/shared";

import { useConvergenceStore } from "@/store/convergence-store";

import { ConvergencePage } from "./convergence-page";

const listMock = vi.fn();
const onUpdatedMock = vi.fn().mockReturnValue(() => undefined);

vi.mock("@/lib/platform", () => ({
  getConvergence: async () => ({
    list: listMock,
    read: vi.fn(),
    onUpdated: onUpdatedMock,
  }),
}));

const campaignHistory = (): ConvergenceHistory => ({
  sourceKey: "local:/root/.figdiff/cache/lp-design-baseline.png",
  campaigns: [
    {
      campaignId: "camp-1",
      sourceKey: "local:/root/.figdiff/cache/lp-design-baseline.png",
      designSource: "lp-design-baseline.png",
      implementationUrl: "http://127.0.0.1:4322/",
      startedAt: 1000,
      updatedAt: 3000,
      endedAt: 3000,
      endReason: "no-regression",
      endMessage: "PASS に到達しました (反復 2 回)。",
      iterations: [
        {
          comparisonId: "cmp-1",
          matchRate: 99.7,
          regionCount: 24,
          perceptibleDiffRatio: 0.012,
          structuralVerdict: "fail",
          status: "FAIL",
          timestamp: 1000,
        },
        {
          comparisonId: "cmp-2",
          matchRate: 100,
          regionCount: 0,
          structuralVerdict: "pass",
          status: "PASS",
          timestamp: 3000,
        },
      ],
    },
  ],
});

beforeEach(() => {
  listMock.mockReset().mockResolvedValue([]);
  useConvergenceStore.setState({
    histories: [],
    selectedSourceKey: null,
    selectedCampaignId: null,
    loading: true,
    unavailable: false,
    error: null,
  });
});

afterEach(cleanup);

describe("ConvergencePage", () => {
  it("記録がまだ無いときは、何をすれば貯まるかを出す", async () => {
    render(<ConvergencePage />);
    expect(await screen.findByText("まだ記録がありません")).toBeInTheDocument();
    expect(screen.getByText(/compare_design を実行すると/)).toBeInTheDocument();
  });

  it("反復ごとの一致率と停止理由を並べる", async () => {
    listMock.mockResolvedValue([campaignHistory()]);
    render(<ConvergencePage />);

    await waitFor(() => {
      expect(screen.getAllByTestId("convergence-step-row")).toHaveLength(2);
    });
    expect(screen.getByText("99.7")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("+0.30pt")).toBeInTheDocument();
    expect(screen.getByTestId("convergence-trend")).toBeInTheDocument();

    const reason = screen.getByTestId("convergence-end-reason");
    expect(reason).toHaveTextContent("PASS に到達");
    expect(reason).toHaveTextContent("PASS に到達しました (反復 2 回)。");
  });

  it("対象を選び替えられる", async () => {
    const other: ConvergenceHistory = {
      ...campaignHistory(),
      sourceKey: "local:/other.png",
      campaigns: [
        {
          ...campaignHistory().campaigns[0],
          sourceKey: "local:/other.png",
          designSource: "other.png",
        },
      ],
    };
    listMock.mockResolvedValue([campaignHistory(), other]);
    render(<ConvergencePage />);

    await waitFor(() => {
      expect(screen.getByText("other.png")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("other.png"));
    expect(useConvergenceStore.getState().selectedSourceKey).toBe("local:/other.png");
  });

  // regression の枠は「悪化」と「3回とも同一（修正が効いてへん）」の両方が入る。
  // 片方だけの語にすると、居らん悪化を探しに行かせてしまう。
  it("停止理由の見出しは悪化と停滞の両方に当たる語にする", async () => {
    const base = campaignHistory();
    listMock.mockResolvedValue([
      {
        ...base,
        campaigns: [
          {
            ...base.campaigns[0],
            endReason: "regression" as const,
            endMessage: "直近3回の比較結果が完全に同一です。",
          },
        ],
      },
    ]);
    render(<ConvergencePage />);

    const reason = await screen.findByTestId("convergence-end-reason");
    expect(reason).toHaveTextContent("悪化または停滞");
    expect(reason).toHaveTextContent("直近3回の比較結果が完全に同一です。");
  });

  // 直前のキャンペーンを見返せんと、いま直した結果しか分からん。
  it("キャンペーンが複数あるときは切り替えられる", async () => {
    const base = campaignHistory();
    const twoCampaigns: ConvergenceHistory = {
      ...base,
      campaigns: [
        {
          ...base.campaigns[0],
          campaignId: "camp-old",
          iterations: [
            {
              comparisonId: "cmp-old",
              matchRate: 70.5,
              structuralVerdict: "fail",
              status: "FAIL",
              timestamp: 500,
            },
          ],
        },
        base.campaigns[0],
      ],
    };
    listMock.mockResolvedValue([twoCampaigns]);
    render(<ConvergencePage />);

    // 既定はいちばん新しい回。
    await waitFor(() => {
      expect(screen.getAllByTestId("convergence-step-row")).toHaveLength(2);
    });

    expect(screen.getByRole("button", { name: "最新 (2 反復)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "1 回前 (1 反復)" }));
    await waitFor(() => {
      expect(screen.getAllByTestId("convergence-step-row")).toHaveLength(1);
    });
    expect(screen.getByText("70.5")).toBeInTheDocument();
  });

  // 「実行中」は時刻で落ちるので、開いとる間だけ自分で時計を刻む。
  // endedAt が付かんまま放置された回 (プロセスが落ちた等) を条件にすると、
  // 誰も見てへん画面で 5 秒ごとの再描画が永久に回り続ける。
  it("実行中に見えんようになったら時刻の更新を止める", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const base = campaignHistory();
      listMock.mockResolvedValue([
        {
          ...base,
          campaigns: [
            {
              ...base.campaigns[0],
              endedAt: undefined,
              endReason: undefined,
              endMessage: undefined,
              updatedAt: Date.now(),
            },
          ],
        },
      ]);
      render(<ConvergencePage />);

      expect(await screen.findByText(/実行中/)).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(70_000);
      });

      expect(screen.queryByText(/実行中/)).not.toBeInTheDocument();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("キャンペーンが1つだけなら切替は出さん", async () => {
    listMock.mockResolvedValue([campaignHistory()]);
    render(<ConvergencePage />);
    await waitFor(() => {
      expect(screen.getAllByTestId("convergence-step-row")).toHaveLength(2);
    });
    expect(screen.queryByTestId("convergence-campaign-picker")).not.toBeInTheDocument();
  });

  // 読めんかったのか記録が無いのかを取り違えると、直す先を間違える。
  it("読み取りに失敗したら理由を出す", async () => {
    listMock.mockRejectedValue(new Error("EACCES: permission denied"));
    render(<ConvergencePage />);

    const shown = await screen.findByTestId("convergence-error");
    expect(shown).toHaveTextContent("収束の記録を読めませんでした");
    expect(shown).toHaveTextContent("EACCES: permission denied");
  });

  // 開いたまま読めんようになる場合がある（保持上限の切り詰め中・権限変更・I/O エラー）。
  // 更新の通知は「変わった」しか運ばんので、中身は初回と同じ list() で取り直す。
  // main 側で読んだ結果を積んで貰う形やと読み取り経路が2本になり、
  // 通知側だけ失敗を伝えんまま古い履歴を出し続ける。
  it("開いた後に読めんようになったら、古い履歴のまま黙らずに理由を出す", async () => {
    onUpdatedMock.mockClear();
    listMock.mockResolvedValueOnce([campaignHistory()]);
    render(<ConvergencePage />);

    await waitFor(() => {
      expect(screen.getAllByTestId("convergence-step-row")).toHaveLength(2);
    });

    // 次の読み取りは失敗する
    listMock.mockRejectedValueOnce(new Error("EACCES: permission denied"));
    const notify = onUpdatedMock.mock.calls.at(-1)?.[0];
    expect(notify).toBeTypeOf("function");
    await act(async () => {
      notify();
    });

    const shown = await screen.findByTestId("convergence-error");
    expect(shown).toHaveTextContent("EACCES: permission denied");
  });

  // 通知が続けて来ると list() が重なる。返る順は投げた順とは限らんので、
  // 素直に書くと遅れて返った古い結果が新しい表示を上書きする。
  it("読み取りが重なっても、最後に投げた結果だけを採る", async () => {
    onUpdatedMock.mockClear();
    const base = campaignHistory();
    const oneStep: ConvergenceHistory = {
      ...base,
      campaigns: [{ ...base.campaigns[0], iterations: [base.campaigns[0].iterations[0]] }],
    };
    listMock.mockResolvedValueOnce([oneStep]);
    render(<ConvergencePage />);
    await waitFor(() => {
      expect(screen.getAllByTestId("convergence-step-row")).toHaveLength(1);
    });

    // 1本目は遅れて「古い1反復」を返し、2本目は先に「新しい2反復」を返す。
    let releaseStale: (value: ConvergenceHistory[]) => void = () => undefined;
    listMock.mockImplementationOnce(
      async () =>
        await new Promise<ConvergenceHistory[]>((resolve) => {
          releaseStale = resolve;
        }),
    );
    listMock.mockResolvedValueOnce([base]);

    const notify = onUpdatedMock.mock.calls.at(-1)?.[0];
    await act(async () => {
      notify();
      notify();
    });
    await waitFor(() => {
      expect(screen.getAllByTestId("convergence-step-row")).toHaveLength(2);
    });

    // 追い越された1本目が後から返っても、新しい表示を巻き戻さん。
    await act(async () => {
      releaseStale([oneStep]);
    });
    expect(screen.getAllByTestId("convergence-step-row")).toHaveLength(2);
  });

  // Web ビルドでは ~/.figdiff を読めん。空の履歴と同じ見た目にすると、
  // 「まだ動かしてへん」のか「見られへん」のか区別がつかん。
  it("読めん環境ではその旨を出す", async () => {
    useConvergenceStore.setState({ unavailable: true, loading: false });
    render(<ConvergencePage />);
    expect(
      await screen.findByText("収束の記録はデスクトップアプリでのみ表示できます。"),
    ).toBeInTheDocument();
  });
});

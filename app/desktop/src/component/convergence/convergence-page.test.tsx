import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("キャンペーンが1つだけなら切替は出さん", async () => {
    listMock.mockResolvedValue([campaignHistory()]);
    render(<ConvergencePage />);
    await waitFor(() => {
      expect(screen.getAllByTestId("convergence-step-row")).toHaveLength(2);
    });
    expect(screen.queryByTestId("convergence-campaign-picker")).not.toBeInTheDocument();
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

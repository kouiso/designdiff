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

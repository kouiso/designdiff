import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getPlatform } from "@/lib/platform";
import { useCompareStore } from "@/store/compare-store";
import { useProjectStore } from "@/store/project-store";

import { ComparePage } from "./compare-page";

vi.mock("@/lib/platform", () => ({
  getPlatform: vi.fn().mockReturnValue({
    file: { readLocalImage: vi.fn(), captureUrlScreenshot: vi.fn() },
  }),
  getReportExport: vi.fn().mockResolvedValue(null),
}));

vi.mock("./compare-canvas", () => ({
  CompareCanvas: () => <div data-testid="compare-canvas" />,
}));

vi.mock("./view-mode-toggle", () => ({
  ViewModeToggle: () => <div data-testid="view-mode-toggle" />,
}));

afterEach(cleanup);

beforeEach(() => {
  useCompareStore.setState({
    designImage: null,
    screenshotImage: null,
    compareResult: null,
    isComparing: false,
    error: null,
    viewMode: "transparent_overlay",
    overlayOpacity: 0.5,
  });
  useProjectStore.setState({ frameImage: null });
});

describe("ComparePage", () => {
  it("比較前は未計測を表示してゼロ点や判定を表示しない", () => {
    render(<ComparePage />);
    expect(screen.getByRole("img", { name: "未実行" })).toBeInTheDocument();
    expect(screen.getByTestId("score-ring-value")).toHaveTextContent("—");
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.queryByTestId("compare-score-verdict-badge")).not.toBeInTheDocument();
  });

  it("タイトルが表示される", () => {
    render(<ComparePage />);
    expect(screen.getByText("デザインと実装を比較")).toBeInTheDocument();
  });

  it("designImage なし → デザイン未読み込み状態", () => {
    render(<ComparePage />);
    expect(screen.getByText("デザイン画像（Figma）")).toBeInTheDocument();
  });

  it("designImage あり → 読み込み済みバッジ表示", () => {
    useCompareStore.setState({ designImage: "base64data" });
    render(<ComparePage />);
    expect(screen.getByText("読み込み済み")).toBeInTheDocument();
  });

  it("screenshotImage 未入力 → 入力フィールド表示", () => {
    useCompareStore.setState({ designImage: "base64data" });
    render(<ComparePage />);
    expect(screen.getByText("実装スクリーンショット")).toBeInTheDocument();
  });

  it("designImage + screenshotImage あり → 差分を検出ボタン", () => {
    useCompareStore.setState({
      designImage: "base64design",
      screenshotImage: "base64screenshot",
    });
    render(<ComparePage />);
    expect(screen.getByText("差分を検出")).toBeInTheDocument();
  });

  it("isComparing=true → 検出中表示", () => {
    useCompareStore.setState({
      designImage: "base64design",
      screenshotImage: "base64screenshot",
      isComparing: true,
    });
    render(<ComparePage />);
    expect(screen.getByText("画像を比較中...")).toBeInTheDocument();
  });

  it("compareResult あり → matchRate バッジ表示", () => {
    useCompareStore.setState({
      designImage: "d",
      screenshotImage: "s",
      compareResult: {
        comparisonId: "cmp-1",
        matchRate: 95.5,
        diffPixelCount: 100,
        totalPixelCount: 1000,
        suggestion: "compare.suggestionMinor",
        diffImageBase64: "diffbase64",
        diffRegions: [],
        diffReport: {
          alignment: {
            translation: { x: 0, y: 0 },
            scale: { x: 1, y: 1 },
            rotation: 0,
            confidence: 1,
            residual: 0,
          },
          regionScores: [
            {
              regionId: "whole-frame",
              bbox: { x: 0, y: 0, w: 1440, h: 900 },
              structure: 0.96,
              color: 2.4,
              shape: 0,
              layout: 0,
            },
          ],
          issues: [],
          aggregateVerdict: "pass",
          rationale: "no critical issues",
        },
      },
    });
    render(<ComparePage />);
    expect(screen.getByTestId("compare-verdict-badge")).toHaveTextContent("PASS");
    expect(screen.getByText("RegionScore Summary")).toBeInTheDocument();
    expect(screen.getByText("No typed issues (P1 scope)")).toBeInTheDocument();
    expect(screen.getByText("matchRate: 95.5%")).toBeInTheDocument();
  });

  // 一致率だけで pass を出すと、共有の computeVerdict (構造と色で見る) と
  // 別の物差しが画面上にもう1つ生まれる。判定を作らず保留にする。
  it("diffReport が無い比較には合否を付けず INCONCLUSIVE のままにする", () => {
    useCompareStore.setState({
      designImage: "d",
      screenshotImage: "s",
      compareResult: {
        comparisonId: "cmp-2",
        matchRate: 99.9,
        diffPixelCount: 1,
        totalPixelCount: 1000,
        suggestion: "compare.suggestionMinor",
        diffRegions: [],
      },
    });
    render(<ComparePage />);
    expect(screen.getByTestId("compare-score-verdict-badge")).toHaveTextContent("INCONCLUSIVE");
  });

  // 判定が保留やのにリングだけ緑にすると、判定バッジより先に緑の数字が目へ入る。
  it("判定が保留の比較はリングも合格色にせん", () => {
    useCompareStore.setState({
      designImage: "d",
      screenshotImage: "s",
      compareResult: {
        comparisonId: "cmp-3",
        matchRate: 99.9,
        diffPixelCount: 1,
        totalPixelCount: 1000,
        suggestion: "compare.suggestionMinor",
        diffRegions: [],
      },
    });
    render(<ComparePage />);
    expect(screen.getByTestId("score-ring-value").style.color.replaceAll(" ", "")).toBe(
      "var(--warn)",
    );
  });

  it("error あり → エラーメッセージ表示", () => {
    useCompareStore.setState({ error: "比較エラー" });
    render(<ComparePage />);
    expect(screen.getByText("比較エラー")).toBeInTheDocument();
  });

  it("差分を検出ボタンクリック → runComparison 呼ばれる", () => {
    const mockRunComparison = vi.fn();
    useCompareStore.setState({
      designImage: "base64design",
      screenshotImage: "base64screenshot",
      runComparison: mockRunComparison,
    });

    render(<ComparePage />);
    fireEvent.click(screen.getByText("差分を検出"));
    expect(mockRunComparison).toHaveBeenCalled();
  });

  it("frameImage あり → designImage に自動セット", () => {
    useProjectStore.setState({ frameImage: "data:image/png;base64,frame" });
    render(<ComparePage />);

    expect(useCompareStore.getState().designImage).toBe("data:image/png;base64,frame");
  });

  it("ローカル画像を読み込むとスクリーンショット状態になる", async () => {
    const platform = await getPlatform();
    vi.mocked(platform.file.readLocalImage).mockResolvedValueOnce("local-image");
    useCompareStore.setState({ designImage: "base64design" });
    render(<ComparePage />);

    fireEvent.change(
      screen.getByPlaceholderText("URL またはファイルパス（例: http://localhost:3000）"),
      {
        target: { value: "/tmp/screenshot.png" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "実装スクリーンショット" }));

    expect(await screen.findByText("読み込み済み")).toBeInTheDocument();
    expect(useCompareStore.getState().screenshotImage).toBe("data:image/png;base64,local-image");
  });

  it("URL画像は選択フレーム寸法でキャプチャする", async () => {
    const platform = await getPlatform();
    vi.mocked(platform.file.captureUrlScreenshot).mockResolvedValueOnce("remote-image");
    useProjectStore.setState({
      selectedFrame: { id: "frame", name: "Desktop", x: 0, y: 0, width: 375.6, height: 812.4 },
    });
    useCompareStore.setState({ designImage: "base64design" });
    render(<ComparePage />);

    fireEvent.change(
      screen.getByPlaceholderText("URL またはファイルパス（例: http://localhost:3000）"),
      {
        target: { value: "https://example.com" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "実装スクリーンショット" }));

    await screen.findByText("読み込み済み");
    expect(platform.file.captureUrlScreenshot).toHaveBeenCalledWith(
      "https://example.com",
      376,
      812,
    );
  });

  it("画像読み込み失敗時はエラーを表示する", async () => {
    const platform = await getPlatform();
    vi.mocked(platform.file.readLocalImage).mockRejectedValueOnce(new Error("read failed"));
    useCompareStore.setState({ designImage: "base64design" });
    render(<ComparePage />);

    fireEvent.change(
      screen.getByPlaceholderText("URL またはファイルパス（例: http://localhost:3000）"),
      {
        target: { value: "/missing.png" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "実装スクリーンショット" }));

    expect(
      await screen.findByText("画像の読み込みに失敗しました: Error: read failed"),
    ).toBeInTheDocument();
  });

  it("読み込み済み画像を変更するとスクリーンショットをクリアする", async () => {
    const platform = await getPlatform();
    vi.mocked(platform.file.readLocalImage).mockResolvedValueOnce("image");
    useCompareStore.setState({ designImage: "base64design" });
    render(<ComparePage />);
    fireEvent.change(
      screen.getByPlaceholderText("URL またはファイルパス（例: http://localhost:3000）"),
      {
        target: { value: "/screenshot.png" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "実装スクリーンショット" }));
    await screen.findByText("読み込み済み");

    fireEvent.click(screen.getByText("変更"));

    expect(useCompareStore.getState().screenshotImage).toBeNull();
    expect(
      screen.getByPlaceholderText("URL またはファイルパス（例: http://localhost:3000）"),
    ).toBeInTheDocument();
  });

  it("表示モードと透明度を操作できる", () => {
    useCompareStore.setState({ designImage: "d", screenshotImage: "s" });
    render(<ComparePage />);

    fireEvent.click(screen.getByRole("button", { name: "ピクセル差分" }));
    expect(useCompareStore.getState().viewMode).toBe("pixel_diff");
    fireEvent.click(screen.getByRole("button", { name: "分割画面" }));
    expect(useCompareStore.getState().viewMode).toBe("split_screen");
    fireEvent.click(screen.getByRole("button", { name: "透過オーバーレイ" }));
    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "0.8" } });
    expect(useCompareStore.getState().overlayOpacity).toBe(0.8);
  });

  it("課題タブは比較結果がない場合の案内を表示する", () => {
    useCompareStore.setState({ designImage: "d", screenshotImage: "s" });
    render(<ComparePage />);

    fireEvent.click(screen.getByText("課題"));

    expect(
      screen.getByText("「差分を検出」ボタンをクリックして比較を実行します。"),
    ).toBeInTheDocument();
  });
});

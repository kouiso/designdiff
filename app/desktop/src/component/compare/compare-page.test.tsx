import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCompareStore } from "@/store/compare-store";
import { useProjectStore } from "@/store/project-store";

import { ComparePage } from "./compare-page";

vi.mock("@/lib/platform", () => ({
  getPlatform: vi.fn().mockReturnValue({
    file: { readLocalImage: vi.fn(), captureUrlScreenshot: vi.fn() },
  }),
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
        matchRate: 95.5,
        diffPixelCount: 100,
        suggestion: "compare.suggestionMinor",
        diffImageBase64: "diffbase64",
        diffRegions: [],
      },
    });
    render(<ComparePage />);
    expect(screen.getByText("95.5%")).toBeInTheDocument();
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
});

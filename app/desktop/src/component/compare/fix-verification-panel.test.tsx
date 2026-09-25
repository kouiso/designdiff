import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DesktopCompareResult } from "@/service/image-compare";
import { useCompareStore } from "@/store/compare-store";

import { FixVerificationPanel } from "./fix-verification-panel";

const compareResult: DesktopCompareResult = {
  comparisonId: "before",
  matchRate: 80,
  diffPixelCount: 20,
  totalPixelCount: 100,
  diffRegions: [],
  suggestion: "test",
  diffImageBase64: "diff",
  comparisonGeometry: {
    canvas_width: 100,
    canvas_height: 100,
    design_original_width: 100,
    design_original_height: 100,
    screenshot_original_width: 100,
    screenshot_original_height: 100,
  },
  ignoredRegionIds: [],
  incompatibleIgnoreRegionIds: [],
  legacyIgnoreRegionIds: [],
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
        regionId: "top-left",
        bbox: { x: 0, y: 0, w: 10, h: 10 },
        structure: 0.8,
        color: 1,
        shape: 0.1,
        layout: 0,
      },
    ],
    issues: [],
    aggregateVerdict: "fail",
    rationale: "test",
  },
};

const snapshot = {
  runId: 1,
  result: compareResult,
  screenshotImage: "before-image",
  conditions: {
    designImage: "design",
    threshold: 0.1,
    cropRegion: null,
    ignoreRegionEntries: [],
    fileKey: null,
    nodeId: null,
    fixTarget: null,
  },
  targetRegion: null,
};

const originalLoadFixTarget = useCompareStore.getState().loadFixTarget;

afterEach(cleanup);

beforeEach(() => {
  useCompareStore.setState({
    currentComparison: null,
    fixBaseline: null,
    fixVerification: null,
    fixTarget: null,
    isLoadingFixTarget: false,
    selectedFixTargetId: null,
    fixError: null,
    isComparing: false,
    loadFixTarget: originalLoadFixTarget,
  });
});

describe("FixVerificationPanel", () => {
  it("一時baseline、grid候補、任意Figmaノード入力を同時に表示する", () => {
    useCompareStore.setState({ currentComparison: snapshot });
    render(<FixVerificationPanel />);

    expect(screen.getByText(/この画面を閉じるまでの一時的な修正前データです/)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "採点領域: top-left" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "確認するFigmaノードID" })).toBeInTheDocument();
  });

  it("入力したdeep node IDをversion-bound読込actionへ渡す", () => {
    const loadFixTarget = vi.fn().mockResolvedValue(undefined);
    useCompareStore.setState({ currentComparison: snapshot, loadFixTarget });
    render(<FixVerificationPanel />);

    fireEvent.change(screen.getByRole("textbox", { name: "確認するFigmaノードID" }), {
      target: { value: "12:34" },
    });
    fireEvent.click(screen.getByRole("button", { name: "版を固定してノードを読み込む" }));

    expect(loadFixTarget).toHaveBeenCalledWith("12:34");
  });

  it("版とnodeを表示し、全maskの未計測を採点値として見せない", () => {
    useCompareStore.setState({
      currentComparison: {
        ...snapshot,
        targetRegion: {
          status: "unmeasured",
          nodeId: "12:34",
          nodeName: "Button label",
          reason: "fully-ignored",
        },
      },
      fixTarget: {
        sourceVersion: "version-1",
        frameNodeId: "1:1",
        targetNodeId: "12:34",
        targetNodeName: "Button label",
        rootBox: { x: 0, y: 0, width: 100, height: 100 },
        targetBox: { x: 10, y: 10, width: 20, height: 10 },
        imageBase64: "png",
        requestedScale: 2,
        fileKey: "file",
        designImage: "data:image/png;base64,png",
      },
    });
    render(<FixVerificationPanel />);

    expect(screen.getByTestId("fix-target-source")).toHaveTextContent("Figma版: version-1");
    expect(screen.getByRole("status")).toHaveTextContent("採点していません");
    expect(screen.getByRole("option", { name: "採点領域: top-left" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /12:34/ })).not.toBeInTheDocument();
  });

  it("baseline固定後は新しい比較まで検証を無効にする", () => {
    useCompareStore.setState({ currentComparison: snapshot });
    render(<FixVerificationPanel />);
    fireEvent.click(screen.getByRole("button", { name: "修正前として固定" }));

    expect(screen.getByText("対象領域: top-left")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "修正を確認" })).toBeDisabled();
    expect(
      screen.getByText("新しいスクリーンショットで差分を検出してください。"),
    ).toBeInTheDocument();
  });

  it("局所verdictと現在比較全体の判定と副作用を分けて表示する", () => {
    useCompareStore.setState({
      fixBaseline: snapshot,
      currentComparison: {
        ...snapshot,
        runId: 2,
        result: { ...compareResult, comparisonId: "after" },
      },
      selectedFixTargetId: "top-left",
      fixVerification: {
        status: "matched",
        targetId: "top-left",
        localVerdict: "improved",
        currentAggregateVerdict: "fail",
        structureDelta: 0.2,
        colorDelta: -1,
        shapeDelta: -0.1,
        sideEffects: [{ nodeId: "bottom-right", delta: -0.2 }],
      },
    });
    render(<FixVerificationPanel />);

    expect(screen.getByText(/対象領域の変化:/)).toHaveTextContent("IMPROVED");
    expect(screen.getByText(/現在比較全体:/)).toHaveTextContent("FAIL");
    expect(screen.getByText("bottom-right: -0.200")).toBeInTheDocument();
  });

  it.each([
    {
      name: "条件不一致",
      result: { status: "conditions-mismatch" as const, differences: ["cropRegion" as const] },
      expected: "cropRegion",
    },
    {
      name: "対象なし",
      result: { status: "missing" as const, targetId: "12:34", availableRegionIds: [] },
      expected: "なし",
    },
    {
      name: "曖昧",
      result: {
        status: "ambiguous" as const,
        targetId: "12:34",
        phase: "target" as const,
        candidateRegionIds: ["12:34", "12-34"],
      },
      expected: "12:34, 12-34",
    },
    {
      name: "現在側未計測",
      result: {
        status: "target-unmeasured" as const,
        targetId: "12:34",
        which: "current" as const,
        reason: "outside-canvas" as const,
      },
      expected: "current: outside-canvas",
    },
    {
      name: "reportなし",
      result: { status: "report-unavailable" as const, which: "current" as const },
      expected: "current",
    },
  ])("$nameを成功結果と誤認させず理由を表示する", ({ result, expected }) => {
    useCompareStore.setState({ fixVerification: result });
    render(<FixVerificationPanel />);

    expect(screen.getByRole("alert")).toHaveTextContent(expected);
    expect(screen.queryByTestId("fix-verification-result")).not.toBeInTheDocument();
  });
});

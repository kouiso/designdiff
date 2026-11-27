import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getReportExport } from "@/lib/platform";
import { buildInspectorFixture } from "@/test-fixture/compare-inspector-fixture";

import { CompareInspector } from "./compare-inspector";

vi.mock("@/lib/platform", () => ({
  getPlatform: vi.fn().mockReturnValue({ file: {} }),
  getReportExport: vi.fn(),
}));

const save = vi.fn();

afterEach(cleanup);

beforeEach(() => {
  save.mockReset().mockResolvedValue("/tmp/report.md");
  vi.mocked(getReportExport).mockResolvedValue({ save });
});

function renderInspector(overrides: Partial<Parameters<typeof CompareInspector>[0]> = {}) {
  const onRecompare = vi.fn();
  render(
    <CompareInspector
      compareResult={buildInspectorFixture()}
      isComparing={false}
      canCompare={true}
      onRecompare={onRecompare}
      currentFileKey={null}
      projectId={null}
      selectedFrame={null}
      {...overrides}
    />,
  );
  return { onRecompare };
}

describe("CompareInspector score block", () => {
  it("スコア・判定バッジ・3種の件数を出す", () => {
    renderInspector();

    expect(screen.getByRole("heading", { name: "インスペクタ" })).toBeInTheDocument();
    expect(screen.getByTestId("inspector-score-value")).toHaveTextContent("78");
    expect(screen.getByText("/ 100 一致スコア")).toBeInTheDocument();
    expect(screen.getByTestId("compare-score-verdict-badge")).toHaveTextContent("FAIL");
    expect(screen.getByTestId("inspector-count-diff")).toHaveTextContent("1 差分");
    expect(screen.getByTestId("inspector-count-review")).toHaveTextContent("2 要確認");
    expect(screen.getByTestId("inspector-count-match")).toHaveTextContent("2 一致");
  });

  it("3分割バーの幅は件数に比例する", () => {
    renderInspector();

    // 差分1 : 要確認2 : 一致2 = 20% : 40% : 40%
    expect(screen.getByTestId("inspector-bar-diff").style.width).toBe("20%");
    expect(screen.getByTestId("inspector-bar-review").style.width).toBe("40%");
    expect(screen.getByTestId("inspector-bar-match").style.width).toBe("40%");
  });

  it("件数が0のセグメントはバーに出さない", () => {
    const result = buildInspectorFixture();
    if (!result.diffReport) throw new Error("fixture has no diffReport");
    renderInspector({
      compareResult: {
        ...result,
        diffReport: {
          ...result.diffReport,
          issues: result.diffReport.issues.filter((issue) => issue.severity !== "critical"),
        },
      },
    });

    expect(screen.queryByTestId("inspector-bar-diff")).not.toBeInTheDocument();
    expect(screen.getByTestId("inspector-count-diff")).toHaveTextContent("0 差分");
  });

  it("比較前は未計測を出し、課題の案内を表示する", () => {
    renderInspector({ compareResult: null, canCompare: false });

    expect(screen.getByTestId("inspector-score-value")).toHaveTextContent("—");
    expect(screen.getByText("未実行")).toBeInTheDocument();
    expect(screen.getByTestId("issue-list-empty")).toHaveTextContent(
      "「差分を検出」ボタンをクリックして比較を実行します。",
    );
    expect(screen.queryByTestId("compare-score-verdict-badge")).not.toBeInTheDocument();
  });
});

describe("CompareInspector issue list", () => {
  it("カードに種別ラベル・値・名前・期待→実測を出す", () => {
    renderInspector();

    const cards = screen.getAllByTestId("issue-card");
    expect(cards).toHaveLength(3);

    const [color, position, typography] = cards;
    expect(color).toHaveAttribute("data-severity", "critical");
    expect(within(color).getByText("カラー")).toBeInTheDocument();
    expect(within(color).getByTestId("issue-card-value")).toHaveTextContent("6.8");
    expect(within(color).getByText("プライマリボタンの背景色")).toBeInTheDocument();
    expect(within(color).getByTestId("issue-card-values")).toHaveTextContent("#3B5BDB→#4C6EF5");

    expect(within(position).getByText("位置")).toBeInTheDocument();
    expect(within(position).getByText("カード下マージン")).toBeInTheDocument();
    expect(within(position).getByTestId("issue-card-values")).toHaveTextContent("0, 0→0, 8");

    expect(within(typography).getByText("タイポ")).toBeInTheDocument();
    // node 名が引けない課題は regionId を名前にする
    expect(within(typography).getByText("heading-font")).toBeInTheDocument();
    expect(within(typography).getByTestId("issue-card-values")).toHaveTextContent("700→600");
  });

  it("critical のカードだけ赤い背景と枠にする", () => {
    renderInspector();

    const [critical, major] = screen.getAllByTestId("issue-card");
    expect(critical.style.background).toBe("var(--diff-soft)");
    expect(critical.style.border).toContain("var(--diff)");
    expect(major.style.background).not.toBe("var(--diff-soft)");
  });

  it("差分フィルタは critical だけを残す", () => {
    renderInspector();
    const filter = screen.getByTestId("inspector-filter");

    fireEvent.click(within(filter).getByRole("button", { name: "差分" }));

    const cards = screen.getAllByTestId("issue-card");
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveAttribute("data-severity", "critical");
    expect(within(filter).getByRole("button", { name: "差分" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("要確認フィルタは major と minor だけを残し、すべてで元に戻る", () => {
    renderInspector();
    const filter = screen.getByTestId("inspector-filter");

    fireEvent.click(within(filter).getByRole("button", { name: "要確認" }));
    expect(screen.getAllByTestId("issue-card").map((c) => c.getAttribute("data-severity"))).toEqual(
      ["major", "minor"],
    );

    fireEvent.click(within(filter).getByRole("button", { name: "すべて" }));
    expect(screen.getAllByTestId("issue-card")).toHaveLength(3);
  });

  it("絞り込みで0件になったら専用の案内を出す", () => {
    const result = buildInspectorFixture();
    if (!result.diffReport) throw new Error("fixture has no diffReport");
    renderInspector({
      compareResult: {
        ...result,
        diffReport: {
          ...result.diffReport,
          issues: result.diffReport.issues.filter((issue) => issue.severity === "critical"),
        },
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "要確認" }));

    expect(screen.queryByTestId("issue-card")).not.toBeInTheDocument();
    expect(screen.getByTestId("issue-list-empty")).toHaveTextContent(
      "この絞り込みに該当する課題はありません。",
    );
  });

  it("課題が1件も無い比較は従来の空表示を出す", () => {
    const result = buildInspectorFixture();
    if (!result.diffReport) throw new Error("fixture has no diffReport");
    renderInspector({
      compareResult: { ...result, diffReport: { ...result.diffReport, issues: [] } },
    });

    expect(screen.getByTestId("issue-list-empty")).toHaveTextContent("No typed issues (P1 scope)");
  });
});

describe("CompareInspector tools", () => {
  it("課題以外の補助ツールのタブをすべて残す", () => {
    renderInspector();
    const tabs = screen.getByTestId("result-tabs");

    for (const name of ["除外", "修正確認", "動き", "レポートv2", "ノード"]) {
      expect(within(tabs).getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByText("PIXELS")).toBeInTheDocument();
  });
});

describe("CompareInspector footer", () => {
  it("再比較は canCompare のとき runComparison を呼ぶ", () => {
    const { onRecompare } = renderInspector();

    fireEvent.click(screen.getByRole("button", { name: "再比較" }));

    expect(onRecompare).toHaveBeenCalledTimes(1);
  });

  it("再比較は canCompare が false なら無効で、押しても呼ばれない", () => {
    const { onRecompare } = renderInspector({ canCompare: false });

    const button = screen.getByRole("button", { name: "再比較" });
    expect(button).toBeDisabled();
    fireEvent.click(button);

    expect(onRecompare).not.toHaveBeenCalled();
  });

  it("書出は CompareReportExport と同じ保存処理を呼ぶ", async () => {
    renderInspector();

    const footer = screen.getByTestId("inspector-footer");
    const exportButton = await within(footer).findByRole("button", { name: "書出" });
    fireEvent.click(exportButton);

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][1]).toBe("markdown");
    expect(await within(footer).findByRole("status")).toHaveTextContent("保存しました");
  });

  it("比較結果が無い間の書出は無効", () => {
    renderInspector({ compareResult: null, canCompare: false });

    expect(screen.getByRole("button", { name: "書出" })).toBeDisabled();
  });
});

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
    expect(screen.getByRole("img", { name: "一致スコア 78 / 100" })).toBeInTheDocument();
    expect(screen.getByText("/ 100 一致スコア")).toBeInTheDocument();
    expect(screen.getByTestId("compare-score-verdict-badge")).toHaveTextContent("FAIL");
    expect(screen.getByTestId("inspector-count-diff")).toHaveTextContent("1 差分");
    expect(screen.getByTestId("inspector-count-review")).toHaveTextContent("2 要確認");
    expect(screen.getByTestId("inspector-count-match")).toHaveTextContent("2 一致");
  });

  it("3分割バーの幅は件数に比例する", () => {
    renderInspector();

    // 差分1 : 要確認2 : 一致2。幅の絶対値ではなく、件数との比で見る。
    const widthOf = (id: string) => Number.parseFloat(screen.getByTestId(id).style.width);
    expect(screen.getByTestId("inspector-bar-diff")).toHaveAttribute("data-count", "1");
    expect(screen.getByTestId("inspector-bar-review")).toHaveAttribute("data-count", "2");
    expect(screen.getByTestId("inspector-bar-match")).toHaveAttribute("data-count", "2");
    expect(widthOf("inspector-bar-review")).toBeCloseTo(widthOf("inspector-bar-diff") * 2);
    expect(widthOf("inspector-bar-match")).toBeCloseTo(widthOf("inspector-bar-review"));
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
    expect(screen.getByRole("img", { name: "未実行" })).toBeInTheDocument();
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

  it("カードに bbox と signal / threshold の補助行を残す", () => {
    renderInspector();

    const meta = within(screen.getAllByTestId("issue-card")[0]).getByTestId("issue-card-meta");
    expect(meta).toHaveTextContent(/x:\d+ y:\d+ w:\d+ h:\d+/);
    expect(meta).toHaveTextContent(/\S+: [\d.]+ \/ [\d.]+/);
  });

  it("critical のカードだけ data-severity が critical になる", () => {
    renderInspector();

    expect(
      screen.getAllByTestId("issue-card").map((card) => card.getAttribute("data-severity")),
    ).toEqual(["critical", "major", "minor"]);
  });

  it("同じ region に同じ値の課題が並んでも、全部描画される", () => {
    const result = buildInspectorFixture();
    if (!result.diffReport) throw new Error("fixture has no diffReport");
    const [first] = result.diffReport.issues;
    renderInspector({
      compareResult: {
        ...result,
        diffReport: { ...result.diffReport, issues: [first, first] },
      },
    });

    expect(screen.getAllByTestId("issue-card")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "差分" }));
    expect(screen.getAllByTestId("issue-card")).toHaveLength(2);
  });

  it("比較結果が切り替わったら絞り込みを「すべて」へ戻す", () => {
    const first = buildInspectorFixture();
    const { rerender } = render(
      <CompareInspector
        compareResult={first}
        isComparing={false}
        canCompare={true}
        onRecompare={vi.fn()}
        currentFileKey={null}
        projectId={null}
        selectedFrame={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "差分" }));
    expect(screen.getAllByTestId("issue-card")).toHaveLength(1);

    rerender(
      <CompareInspector
        compareResult={{ ...first, comparisonId: "next-comparison" }}
        isComparing={false}
        canCompare={true}
        onRecompare={vi.fn()}
        currentFileKey={null}
        projectId={null}
        selectedFrame={null}
      />,
    );

    expect(screen.getAllByTestId("issue-card")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "すべて" })).toHaveAttribute("aria-pressed", "true");
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

  it("diffReport が無い比較は未計測を中立表示し、issuesEmpty を出さない", () => {
    renderInspector({ compareResult: { ...buildInspectorFixture(), diffReport: undefined } });

    const empty = screen.getByTestId("issue-list-empty");
    expect(empty).toHaveTextContent("未実行");
    expect(empty).not.toHaveTextContent("No typed issues");
    expect(screen.queryByTestId("match-card")).not.toBeInTheDocument();
  });
});

describe("CompareInspector match cards", () => {
  it("すべてでは課題カードの後ろに一致カードを出し、件数は一致件数と等しい", () => {
    renderInspector();

    const cards = screen.getAllByTestId("match-card");
    expect(cards).toHaveLength(2);
    expect(screen.getByTestId("inspector-count-match")).toHaveTextContent("2 一致");
    const [balance, transactions] = cards;
    expect(balance).toHaveTextContent("一致");
    expect(balance).toHaveTextContent("balance-card");
    expect(balance).toHaveTextContent("OK");
    expect(transactions).toHaveTextContent("transaction-list");
    expect(within(balance).queryByText("→")).not.toBeInTheDocument();
    const lastIssue = screen.getAllByTestId("issue-card").at(-1);
    expect(lastIssue?.compareDocumentPosition(balance)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("figmaNodeId が引ければ node 名を表示する", () => {
    const result = buildInspectorFixture();
    if (!result.diffReport) throw new Error("fixture has no diffReport");
    renderInspector({
      compareResult: {
        ...result,
        diffReport: {
          ...result.diffReport,
          regionScores: result.diffReport.regionScores.map((score) =>
            score.regionId === "balance-card" ? { ...score, figmaNodeId: "1:10" } : score,
          ),
        },
      },
    });

    expect(screen.getAllByTestId("match-card")[0]).toHaveTextContent("プライマリボタンの背景色");
  });

  it("差分と要確認では一致カードを出さない", () => {
    renderInspector();
    const filter = screen.getByTestId("inspector-filter");

    fireEvent.click(within(filter).getByRole("button", { name: "差分" }));
    expect(screen.queryByTestId("match-card")).not.toBeInTheDocument();

    fireEvent.click(within(filter).getByRole("button", { name: "要確認" }));
    expect(screen.queryByTestId("match-card")).not.toBeInTheDocument();
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
    // 保存先の読み込みが終わるまでは無効のボタンが出る。
    await waitFor(() => expect(within(footer).getByRole("button", { name: "書出" })).toBeEnabled());
    fireEvent.click(within(footer).getByRole("button", { name: "書出" }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][1]).toBe("markdown");
    expect(await within(footer).findByRole("status")).toHaveTextContent("保存しました");
  });

  it("比較結果が無い間の書出は無効", () => {
    renderInspector({ compareResult: null, canCompare: false });

    expect(screen.getByRole("button", { name: "書出" })).toBeDisabled();
  });
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConvergenceIteration } from "@figdiff/shared";

import { ConvergenceStepRow } from "./convergence-step-row";

afterEach(cleanup);

const iteration = (overrides: Partial<ConvergenceIteration> = {}): ConvergenceIteration => ({
  comparisonId: "cmp-1",
  matchRate: 98.73,
  structuralVerdict: "fail",
  status: "FAIL",
  timestamp: 1_700_000_000_000,
  ...overrides,
});

describe("ConvergenceStepRow", () => {
  it("反復番号と一致率を出す", () => {
    render(<ConvergenceStepRow step={2} iteration={iteration()} />);
    expect(screen.getByText("#2")).toBeInTheDocument();
    expect(screen.getByText("98.73")).toBeInTheDocument();
  });

  it("前回からの伸びを符号つきで出す", () => {
    render(
      <ConvergenceStepRow
        step={2}
        iteration={iteration({ matchRate: 99 })}
        previous={iteration({ comparisonId: "cmp-0", matchRate: 98 })}
      />,
    );
    expect(screen.getByText("+1.00pt")).toBeInTheDocument();
  });

  // 停滞は「変わってへん」ことが分からんと気づけん。0 を空欄にせん。
  it("変化が無いときは ±0.00pt と出す", () => {
    render(
      <ConvergenceStepRow
        step={3}
        iteration={iteration({ matchRate: 98.73 })}
        previous={iteration({ comparisonId: "cmp-0", matchRate: 98.73 })}
      />,
    );
    expect(screen.getByText("±0.00pt")).toBeInTheDocument();
  });

  it("初回は差分を出さん", () => {
    render(<ConvergenceStepRow step={1} iteration={iteration()} />);
    expect(screen.queryByText(/pt$/)).not.toBeInTheDocument();
  });

  it("PASS の反復は PASS の表示になる", () => {
    render(
      <ConvergenceStepRow
        step={1}
        iteration={iteration({ matchRate: 100, status: "PASS", structuralVerdict: "pass" })}
      />,
    );
    expect(screen.getByText("PASS")).toBeInTheDocument();
  });

  // 同じ結論が2つ並ぶと読みにくいだけで、情報は増えん。
  it("総合と構造の判定が一致する回は、判定をひとつだけ出す", () => {
    render(<ConvergenceStepRow step={1} iteration={iteration()} />);
    expect(screen.getAllByText("FAIL")).toHaveLength(1);
  });

  // 食い違う回は、人が見るべき回そのものなので隠さん。
  it("総合と構造の判定が食い違う回は両方出す", () => {
    render(
      <ConvergenceStepRow
        step={1}
        iteration={iteration({ status: "FAIL", structuralVerdict: "inconclusive" })}
      />,
    );
    expect(screen.getByText("FAIL")).toBeInTheDocument();
    expect(screen.getByText("INCONCLUSIVE")).toBeInTheDocument();
  });

  it("選ぶと通知する", () => {
    const onSelect = vi.fn();
    render(<ConvergenceStepRow step={1} iteration={iteration()} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("convergence-step-row"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

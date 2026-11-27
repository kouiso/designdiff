import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { buildInspectorFixture } from "@/test-fixture/compare-inspector-fixture";

import { CompareStatusBar } from "./compare-status-bar";

afterEach(cleanup);

describe("CompareStatusBar", () => {
  it("寸法・しきい値・一致率を出し、合格でなければ琥珀色の点にする", () => {
    render(<CompareStatusBar compareResult={buildInspectorFixture()} />);

    expect(screen.getByTestId("status-dimensions")).toHaveTextContent("320 × 660");
    expect(screen.getByTestId("status-threshold")).toHaveTextContent("しきい値 10%");
    expect(screen.getByTestId("status-match")).toHaveTextContent("78% 一致");
    expect(screen.getByTestId("status-match-dot").style.background).toBe("var(--warn)");
  });

  it("判定が pass なら緑の点にする", () => {
    const result = buildInspectorFixture();
    if (!result.diffReport) throw new Error("fixture has no diffReport");
    render(
      <CompareStatusBar
        compareResult={{
          ...result,
          matchRate: 99.5,
          diffReport: { ...result.diffReport, aggregateVerdict: "pass" },
        }}
      />,
    );

    expect(screen.getByTestId("status-match")).toHaveTextContent("99.5% 一致");
    expect(screen.getByTestId("status-match-dot").style.background).toBe("var(--match)");
  });
});

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CompareVerdictBadge } from "./compare-verdict-badge";

afterEach(cleanup);

describe("CompareVerdictBadge", () => {
  it("pass を PASS として描画する", () => {
    render(<CompareVerdictBadge verdict="pass" />);
    expect(screen.getByTestId("compare-verdict-badge")).toHaveTextContent("PASS");
  });

  it("fail を FAIL として描画する", () => {
    render(<CompareVerdictBadge verdict="fail" />);
    expect(screen.getByTestId("compare-verdict-badge")).toHaveTextContent("FAIL");
  });

  it("inconclusive を INCONCLUSIVE として描画する", () => {
    render(<CompareVerdictBadge verdict="inconclusive" />);
    expect(screen.getByTestId("compare-verdict-badge")).toHaveTextContent("INCONCLUSIVE");
  });
});

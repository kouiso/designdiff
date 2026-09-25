import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ScoreBar } from "./score-bar";

afterEach(cleanup);

describe("ScoreBar", () => {
  it("未計測には中立色のダッシュと説明を表示する", () => {
    render(<ScoreBar label="MATCH" score={null} />);
    const value = screen.getByLabelText("MATCH: 未実行");
    expect(value).toHaveTextContent("—");
    expect(value.style.color.replaceAll(" ", "")).toBe("var(--muted-fg)");
  });

  it("計測済みのゼロ点は差分色で表示する", () => {
    render(<ScoreBar label="MATCH" score={0} />);
    expect(screen.getByText("0").style.color.replaceAll(" ", "")).toBe("var(--diff)");
  });
});

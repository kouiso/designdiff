import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ScoreRing } from "./score-ring";

afterEach(cleanup);

// 数字の色はリングの色と同じ変数から出るので、数字の色を見れば色の根拠が分かる。
const ringColor = (): string =>
  screen.getByTestId("score-ring-value").style.color.replaceAll(" ", "");

describe("ScoreRing", () => {
  it("判定が無いときは点数の高さで色を決める", () => {
    render(<ScoreRing score={96.96} />);
    expect(ringColor()).toBe("var(--match)");
  });

  // 一致率が高いことと合格は別物。点数だけで緑にすると、
  // 落ちとる回に緑の大きい数字が出て、赤い FAIL より先に目へ入る。
  it("判定が渡されたら点数が高くても判定の色にする", () => {
    render(<ScoreRing score={96.96} tone="fail" />);
    expect(ringColor()).toBe("var(--diff)");
  });

  it("判定が warn なら警告の色にする", () => {
    render(<ScoreRing score={99.9} tone="warn" />);
    expect(ringColor()).toBe("var(--warn)");
  });

  it("判定が pass なら点数が低くても合格の色にする", () => {
    render(<ScoreRing score={42} tone="pass" />);
    expect(ringColor()).toBe("var(--match)");
  });
});

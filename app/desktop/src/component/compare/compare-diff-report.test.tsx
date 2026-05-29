import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CompareDesignResult, DiffIssue, DiffReport, RegionScore } from "@figdiff/shared";

import { CompareDiffReport } from "./compare-diff-report";

vi.mock("./compare-verdict-badge", () => ({
  CompareVerdictBadge: ({ verdict }: { verdict: string }) => (
    <div data-testid="compare-verdict-badge">{verdict}</div>
  ),
}));

afterEach(cleanup);

const makeBbox = (x = 0, y = 0, w = 100, h = 100) => ({ x, y, w, h });

const makeRegionScore = (overrides: Partial<RegionScore> = {}): RegionScore => ({
  regionId: "header",
  bbox: makeBbox(),
  structure: 0.9,
  color: 0.85,
  shape: 0.8,
  layout: 0.75,
  ...overrides,
});

const makeIssue = (overrides: Partial<DiffIssue> = {}): DiffIssue => ({
  regionId: "header",
  bbox: makeBbox(10, 20, 50, 30),
  kind: "color",
  severity: "major",
  evidence: {
    signal: "colorDelta",
    value: 0.45,
    threshold: 0.3,
    expected: "#fff",
    actual: "#eee",
  },
  ...overrides,
});

const makeDiffReport = (overrides: Partial<DiffReport> = {}): DiffReport => ({
  alignment: {
    translation: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    confidence: 1,
    residual: 0,
  },
  regionScores: [makeRegionScore()],
  issues: [],
  aggregateVerdict: "pass",
  rationale: "All regions match.",
  ...overrides,
});

const makeResult = (
  overrides: Partial<CompareDesignResult & { diffImageBase64?: string }> = {},
): CompareDesignResult & { diffImageBase64?: string } => ({
  comparisonId: "cmp-1",
  matchRate: 98.5,
  diffPixelCount: 100,
  totalPixelCount: 10000,
  diffRegions: [],
  suggestion: "Looks good",
  ...overrides,
});

describe("CompareDiffReport", () => {
  it("diffReport が undefined のとき何も描画しない", () => {
    const { container } = render(<CompareDiffReport compareResult={makeResult()} />);
    expect(container.firstChild).toBeNull();
  });

  it("diffReport があるとき report コンテナが表示される", () => {
    const compareResult = makeResult({ diffReport: makeDiffReport() });
    render(<CompareDiffReport compareResult={compareResult} />);
    expect(screen.getByTestId("compare-diff-report")).toBeInTheDocument();
  });

  it("aggregateVerdict を CompareVerdictBadge に渡す", () => {
    const compareResult = makeResult({
      diffReport: makeDiffReport({ aggregateVerdict: "fail" }),
    });
    render(<CompareDiffReport compareResult={compareResult} />);
    expect(screen.getByTestId("compare-verdict-badge")).toHaveTextContent("fail");
  });

  it("rationale が表示される", () => {
    const compareResult = makeResult({
      diffReport: makeDiffReport({ rationale: "Color mismatch in header." }),
    });
    render(<CompareDiffReport compareResult={compareResult} />);
    expect(screen.getByText("Color mismatch in header.")).toBeInTheDocument();
  });

  it("regionScore が描画される (regionId + scores)", () => {
    const compareResult = makeResult({
      diffReport: makeDiffReport({
        regionScores: [makeRegionScore({ regionId: "footer", structure: 0.123, color: 0.456 })],
      }),
    });
    render(<CompareDiffReport compareResult={compareResult} />);
    expect(screen.getByText("footer")).toBeInTheDocument();
    expect(screen.getByText(/structure: 0\.123/)).toBeInTheDocument();
    expect(screen.getByText(/color: 0\.456/)).toBeInTheDocument();
  });

  it("issues が空のとき空メッセージが表示される", () => {
    const compareResult = makeResult({
      diffReport: makeDiffReport({ issues: [] }),
    });
    render(<CompareDiffReport compareResult={compareResult} />);
    expect(screen.getByText("No typed issues (P1 scope)")).toBeInTheDocument();
  });

  it("issues があるとき各 issue が描画される", () => {
    const issue = makeIssue({ kind: "size", severity: "critical" });
    const compareResult = makeResult({
      diffReport: makeDiffReport({ issues: [issue] }),
    });
    render(<CompareDiffReport compareResult={compareResult} />);
    expect(screen.getByText("size")).toBeInTheDocument();
    expect(screen.getByText(/severity: critical/)).toBeInTheDocument();
  });

  it("matchRate と diffPixels が表示される", () => {
    const compareResult = makeResult({
      matchRate: 95.7,
      diffPixelCount: 42,
      diffRegions: [],
      diffReport: makeDiffReport(),
    });
    render(<CompareDiffReport compareResult={compareResult} />);
    expect(screen.getByText(/matchRate: 95\.7%/)).toBeInTheDocument();
    expect(screen.getByText(/diffPixels: 42/)).toBeInTheDocument();
  });

  it("diffImageBase64 がないとき img タグが描画されない", () => {
    const compareResult = makeResult({ diffReport: makeDiffReport() });
    render(<CompareDiffReport compareResult={compareResult} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("diffImageBase64 が base64 文字列のとき data: URI に変換して img を描画する", () => {
    const compareResult = makeResult({
      diffReport: makeDiffReport(),
      diffImageBase64: "abc123",
    });
    render(<CompareDiffReport compareResult={compareResult} />);
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "data:image/png;base64,abc123");
  });

  it("diffImageBase64 が既に data: URI のときそのまま使用される", () => {
    const uri = "data:image/png;base64,xyz789";
    const compareResult = makeResult({
      diffReport: makeDiffReport(),
      diffImageBase64: uri,
    });
    render(<CompareDiffReport compareResult={compareResult} />);
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", uri);
  });

  it("bbox が正しくフォーマットされて表示される", () => {
    const compareResult = makeResult({
      diffReport: makeDiffReport({
        regionScores: [makeRegionScore({ bbox: { x: 5, y: 10, w: 200, h: 150 } })],
      }),
    });
    render(<CompareDiffReport compareResult={compareResult} />);
    expect(screen.getByText("x:5, y:10, w:200, h:150")).toBeInTheDocument();
  });
});

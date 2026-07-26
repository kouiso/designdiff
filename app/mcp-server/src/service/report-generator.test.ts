import { describe, it, expect } from "vitest";

import type { CompareDesignResult } from "@figdiff/shared";

import { generateMarkdownReport, generateJsonReport } from "./report-generator.js";

const makeResult = (overrides: Partial<CompareDesignResult> = {}): CompareDesignResult => ({
  comparisonId: "cmp-001",
  matchRate: 98.5,
  diffPixelCount: 150,
  totalPixelCount: 10000,
  diffRegions: [],
  diffImageBase64: "base64encodeddata",
  suggestion: "Looks good!",
  ...overrides,
});

describe("generateMarkdownReport", () => {
  it("includes comparisonId in the output", () => {
    // Arrange
    const result = makeResult({ comparisonId: "cmp-xyz-999" });

    // Act
    const markdown = generateMarkdownReport(result);

    // Assert
    expect(markdown).toContain("cmp-xyz-999");
  });

  it("includes matchRate in the output", () => {
    const result = makeResult({ matchRate: 75.25 });

    const markdown = generateMarkdownReport(result);

    expect(markdown).toContain("75.25");
  });

  it("shows no-difference message when diffRegions is empty", () => {
    const result = makeResult({ diffRegions: [] });

    const markdown = generateMarkdownReport(result);

    expect(markdown).toContain("No differences found");
  });

  it("lists diff regions when present", () => {
    const result = makeResult({
      diffRegions: [
        {
          id: 0,
          bounds: { x: 10, y: 20, width: 50, height: 30 },
          diffPixelCount: 42,
          nearbyNodeIds: ["node-A"],
          nearbyNodeNames: ["ButtonComponent"],
        },
      ],
    });

    const markdown = generateMarkdownReport(result);

    expect(markdown).toContain("ButtonComponent");
    expect(markdown).toContain("node-A");
    expect(markdown).toContain("42");
  });

  it("shows region position and size for each diff region", () => {
    const result = makeResult({
      diffRegions: [
        {
          id: 0,
          bounds: { x: 5, y: 15, width: 80, height: 40 },
          diffPixelCount: 10,
          nearbyNodeIds: [],
          nearbyNodeNames: [],
        },
      ],
    });

    const markdown = generateMarkdownReport(result);

    expect(markdown).toContain("5");
    expect(markdown).toContain("15");
    expect(markdown).toContain("80x40");
  });

  it("returns a string", () => {
    const markdown = generateMarkdownReport(makeResult());

    expect(typeof markdown).toBe("string");
  });

  it("includes compliance benchmark table and next action", () => {
    const result = makeResult({
      completionCriteria: {
        matchRate: { required: 100, current: 98.5, status: "FAIL" },
        diffPixelCount: { required: 0, current: 150, status: "FAIL" },
        remainingIssues: { required: 0, current: 2, status: "FAIL" },
      },
      remainingIssues: 2,
      nextAction: "Fix hero heading spacing and color token mismatch.",
    });

    const markdown = generateMarkdownReport(result);

    expect(markdown).toContain("Compliance Benchmark Snapshot");
    expect(markdown).toContain("Suggested Next Action");
    expect(markdown).toContain("Fix hero heading spacing and color token mismatch.");
    expect(markdown).toContain("| Match Rate | 100 | 98.5 | FAIL |");
  });

  it("includes typed diff evidence summary when diffReport exists", () => {
    const result = makeResult({
      diffReport: {
        alignment: {
          translation: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          confidence: 1,
          residual: 0,
        },
        regionScores: [],
        issues: [
          {
            regionId: "r-1",
            bbox: { x: 0, y: 0, w: 100, h: 50 },
            kind: "color",
            severity: "critical",
            evidence: {
              signal: "deltaE",
              value: 8.1,
              threshold: 3,
              expected: "#ffffff",
              actual: "#f8f8f8",
              figmaFileKey: "FILE_ABC",
              figmaNodeId: "1:2",
              figmaPageName: "Top",
            },
          },
        ],
        aggregateVerdict: "fail",
        rationale: "Critical color mismatch remains.",
      },
      diffImagePath: "/tmp/figdiff/cmp-001.png",
    });

    const markdown = generateMarkdownReport(result);

    expect(markdown).toContain("Evidence for Figma Compliance");
    expect(markdown).toContain("Aggregate Verdict: **fail**");
    expect(markdown).toContain("Critical Issues: **1**");
    expect(markdown).toContain("Typed Issues (Expected vs Actual)");
    expect(markdown).toContain("Expected: `#ffffff`");
    expect(markdown).toContain("Actual: `#f8f8f8`");
    expect(markdown).toContain("fileKey=`FILE_ABC`, nodeId=`1:2`, page=`Top`");
    expect(markdown).toContain("Evidence image: /tmp/figdiff/cmp-001.png");
  });
});

// Markdown だけを見た読み手が、人間レビューへ回った比較を PASS と読んでしまわないこと。
describe("generateMarkdownReport — 整合ゲートの表示", () => {
  const uncertainResult = (): CompareDesignResult =>
    makeResult({
      status: "UNCERTAIN",
      completionCriteria: {
        structuralReview: { required: 1, current: 1, status: "PASS", blocking: true },
        consistencyReview: {
          required: 0.5,
          current: 0.96,
          status: "UNCERTAIN",
          blocking: true,
          note: "routed to human review",
        },
        matchRate: { required: 100, current: 98.5, status: "FAIL", blocking: false },
        diffPixelCount: { required: 0, current: 150, status: "PASS", blocking: false },
        remainingIssues: { required: 0, current: 0, status: "PASS", blocking: false },
      },
      diffReport: {
        alignment: {
          translation: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          confidence: 1,
          residual: 0,
        },
        regionScores: [],
        issues: [],
        aggregateVerdict: "pass",
        rationale: "structural pass",
        perceptibleDiffRatio: 0.96,
      },
    });

  it("shows the final status so the table cannot read as PASS", () => {
    const markdown = generateMarkdownReport(uncertainResult());

    expect(markdown).toContain("| Final Status | PASS | UNCERTAIN | UNCERTAIN |");
  });

  it("shows the consistency review row", () => {
    const markdown = generateMarkdownReport(uncertainResult());

    expect(markdown).toContain("| Consistency Review |");
    expect(markdown).toContain("0.96");
  });

  it("does not let the structural row claim PASS on its own", () => {
    const markdown = generateMarkdownReport(
      makeResult({
        status: "UNCERTAIN",
        completionCriteria: {
          structuralReview: { required: 1, current: 0, status: "UNCERTAIN", blocking: true },
          matchRate: { required: 100, current: 98.5, status: "FAIL", blocking: false },
          diffPixelCount: { required: 0, current: 150, status: "PASS", blocking: false },
          remainingIssues: { required: 0, current: 0, status: "PASS", blocking: false },
        },
        diffReport: {
          alignment: {
            translation: { x: 0, y: 0 },
            scale: { x: 1, y: 1 },
            rotation: 0,
            confidence: 1,
            residual: 0,
          },
          regionScores: [],
          issues: [],
          aggregateVerdict: "inconclusive",
          rationale: "structural inconclusive",
        },
      }),
    );

    expect(markdown).toContain("| Diff Verdict | pass | inconclusive | UNCERTAIN |");
  });
});

describe("generateJsonReport", () => {
  it("returns valid JSON", () => {
    const result = makeResult();

    const json = generateJsonReport(result);

    expect(() => JSON.parse(json)).not.toThrow();
  });

  it("excludes diffImageBase64 from the output", () => {
    const result = makeResult({ diffImageBase64: "very-long-base64-string" });

    const json = generateJsonReport(result);

    expect(json).not.toContain("very-long-base64-string");
    expect(json).not.toContain("diffImageBase64");
  });

  it("includes comparisonId, matchRate, and diffPixelCount in the output", () => {
    const result = makeResult({
      comparisonId: "json-test-001",
      matchRate: 88,
      diffPixelCount: 500,
    });

    const json = generateJsonReport(result);
    const parsed: Record<string, unknown> = JSON.parse(json);

    expect(parsed.comparisonId).toBe("json-test-001");
    expect(parsed.matchRate).toBe(88);
    expect(parsed.diffPixelCount).toBe(500);
  });
});

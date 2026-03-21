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

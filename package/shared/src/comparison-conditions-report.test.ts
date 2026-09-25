import { describe, expect, it } from "vitest";

import { describeComparisonConditions } from "./comparison-conditions.js";
import { generateJsonReport, generateMarkdownReport } from "./report-generator.js";
import { CompareDesignResultSchema } from "./schema.js";

const legacy = {
  comparisonId: "synthetic-conditions-report",
  matchRate: 100,
  diffPixelCount: 0,
  totalPixelCount: 390 * 1839,
  diffRegions: [],
  suggestion: "",
};

describe("条件記録のレポート互換性", () => {
  it("旧データは新しい条件を捏造しない", () => {
    const parsed = CompareDesignResultSchema.parse(legacy);
    expect(parsed.comparisonConditions).toBeUndefined();
    expect(generateMarkdownReport(parsed)).not.toContain("Comparison Conditions");
  });

  it("申告と撮影記録をJSONに保持しMarkdownへ単位付きで表示する", () => {
    const comparisonConditions = describeComparisonConditions(
      {
        design: { width: 390, height: 1839 },
        screenshot: { width: 390, height: 1839 },
      },
      {
        design: { viewport: { width: 390, height: 693 }, pixelRatio: 1, origin: { x: 0, y: 0 } },
        screenshot: {
          viewport: { width: 390, height: 1839 },
          pixelRatio: 1,
          origin: { x: 0, y: 0 },
        },
      },
      {
        screenshot: {
          observed: { source: "scroll-capture", viewportPixels: { width: 390, height: 693 } },
        },
      },
    );
    const result = CompareDesignResultSchema.parse({
      ...legacy,
      status: "UNCERTAIN",
      comparisonConditions,
    });
    const json = CompareDesignResultSchema.parse(JSON.parse(generateJsonReport(result)));
    expect(json.comparisonConditions).toEqual(comparisonConditions);
    const markdown = generateMarkdownReport(result);
    expect(markdown).toContain("| Final Status | PASS | UNCERTAIN | UNCERTAIN |");
    expect(markdown).toContain("390×1839 (image-metadata)");
    expect(markdown).toContain("390×693");
    expect(markdown).toContain("Origin (logical px; declared)");
    expect(markdown).toContain("scroll-capture");
    expect(markdown).toContain("Applied normalization and alignment");
  });
});

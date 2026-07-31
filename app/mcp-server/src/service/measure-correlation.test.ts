import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  buildBaselineReport,
  calculatePearsonCorrelation,
  computeCorrelationMetrics,
  getExpectedIssueKinds,
  getHumanSeverity,
  measureCorrelation,
  percentage,
  readJson,
  renderBaselineMarkdown,
} from "../../../../verification/script/measure-correlation.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const baseRow = {
  fixtureId: "pair-a",
  variantName: "correct",
  expectedVerdict: "pass",
  computedVerdict: "pass",
  expectedIssueKinds: [] as string[],
  computedIssueKinds: [] as string[],
  weightedStructure: 1,
  weightedColor: 0,
  humanSeverity: 1,
  matchesVerdict: true,
  issueKindRecall: null,
  issueKindPrecision: null,
  matchedIssueKinds: [] as string[],
  missedIssueKinds: [] as string[],
  unexpectedIssueKinds: [] as string[],
  worstSectionId: "whole-frame",
  worstSectionScore: 1,
};

describe("measure correlation math utilities", () => {
  it("percentage は分母0なら null、通常は四捨五入して返す", () => {
    expect(percentage(1, 0)).toBeNull();
    expect(percentage(1, 4)).toBe(25);
    expect(percentage(2, 3, 2)).toBe(66.67);
  });

  it("getHumanSeverity は定義済みのバリアント名を優先してスコアリングする", () => {
    expect(
      getHumanSeverity({
        name: "single-button-wrong-color",
        expectedVerdict: "fail",
        expectedKinds: ["color"],
        image: "impl-single.png",
      }),
    ).toBe(0.5);
    expect(
      getHumanSeverity({
        name: "unexpected",
        expectedVerdict: "pass",
        expectedKinds: [],
        image: "impl-pass.png",
      }),
    ).toBe(1);
    expect(
      getHumanSeverity({
        name: "unexpected",
        expectedVerdict: "fail",
        expectedKinds: [],
        image: "impl-fail.png",
      }),
    ).toBe(0);
  });

  it("getExpectedIssueKinds は expectedIssueKinds を優先し、重複を除去してソートする", () => {
    expect(
      getExpectedIssueKinds({
        name: "color-off",
        expectedVerdict: "fail",
        expectedKinds: ["position", "color", "position"],
        image: "impl-color-off.png",
      }),
    ).toEqual(["color", "position"]);
    expect(
      getExpectedIssueKinds({
        name: "color-pass",
        expectedVerdict: "pass",
        expectedKinds: ["position", "color", "position"],
        expectedIssueKinds: ["size", "size", "position"],
        image: "impl-color-pass.png",
      }),
    ).toEqual(["position", "size"]);
  });

  it("readJson は JSON と schema の両方を検証する", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(tmpdir(), "measure-correlation-readjson-"));
    const jsonPath = path.join(tmpRoot, "payload.json");
    await fs.writeFile(jsonPath, JSON.stringify({ value: 1 }, null, 2));

    const result = await readJson(jsonPath, z.object({ value: z.number() }));
    expect(result.value).toBe(1);

    await fs.writeFile(jsonPath, "{");
    await expect(readJson(jsonPath, z.object({ value: z.number() }))).rejects.toThrow();

    await fs.writeFile(jsonPath, JSON.stringify({ value: "bad" }));
    await expect(readJson(jsonPath, z.object({ value: z.number() }))).rejects.toThrow();

    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("renderBaselineMarkdown が基礎データを埋める", () => {
    const rows = [
      {
        ...baseRow,
        expectedIssueKinds: ["color"],
        computedIssueKinds: ["size"],
        issueKindRecall: 0,
        issueKindPrecision: 0,
        matchedIssueKinds: ["color"],
        missedIssueKinds: [],
        unexpectedIssueKinds: ["size"],
        worstSectionId: null,
        worstSectionScore: null,
      },
    ];

    const metrics = computeCorrelationMetrics(rows);
    const markdown = renderBaselineMarkdown(rows, metrics, "2026-01-01T00:00:00.000Z");

    expect(markdown).toContain("# L7 Baseline Correlation Report");
    expect(markdown).toContain("pair-a");
    expect(markdown).toContain("2026-01-01T00:00:00.000Z");
    expect(markdown).toContain("- Active:");
  });

  it("buildBaselineReport が summary と行データを含むレポートを組み立てる", () => {
    const rows = [
      {
        ...baseRow,
        expectedIssueKinds: ["color"],
        computedIssueKinds: ["color"],
        issueKindRecall: 1,
        issueKindPrecision: 1,
        matchedIssueKinds: ["color"],
        missedIssueKinds: [],
        unexpectedIssueKinds: [],
        worstSectionId: "root",
        worstSectionScore: 1,
      },
    ];

    const report = buildBaselineReport(
      rows,
      computeCorrelationMetrics(rows),
      "2026-01-01T00:00:00.000Z",
    );

    expect(report.summary.pairsTested).toBe(1);
    expect(report.summary.rows).toBeUndefined();
    expect(report.rows).toHaveLength(1);
    expect(report.summary.baselineSignalsInEffect.active).toContain(
      "P1 issue typing and verdict logic",
    );
    expect(report.summary.nextMeasurementTrigger).toContain(
      "Re-run after P3 is wired into weightedStructure/weightedColor",
    );
  });

  it("3 variants がすべて正解なら accuracy が 100% になること", () => {
    const metrics = computeCorrelationMetrics([
      baseRow,
      {
        ...baseRow,
        fixtureId: "pair-a",
        variantName: "borderline",
        expectedVerdict: "inconclusive",
        computedVerdict: "inconclusive",
        expectedIssueKinds: ["position"],
        computedIssueKinds: ["position"],
        weightedStructure: 0.95,
        weightedColor: 1,
        humanSeverity: 0.5,
        matchesVerdict: true,
        issueKindRecall: 1,
        issueKindPrecision: 1,
        matchedIssueKinds: ["position"],
        missedIssueKinds: [],
        unexpectedIssueKinds: [],
        worstSectionId: "section-1",
        worstSectionScore: 0.95,
      },
      {
        ...baseRow,
        fixtureId: "pair-b",
        variantName: "broken",
        expectedVerdict: "fail",
        computedVerdict: "fail",
        expectedIssueKinds: ["color", "size"],
        computedIssueKinds: ["color", "size"],
        weightedStructure: 0.7,
        weightedColor: 8,
        humanSeverity: 0,
        matchesVerdict: true,
        issueKindRecall: 1,
        issueKindPrecision: 1,
        matchedIssueKinds: ["color", "size"],
        missedIssueKinds: [],
        unexpectedIssueKinds: [],
        worstSectionId: "section-2",
        worstSectionScore: 0.7,
      },
    ]);

    expect(metrics.verdictAccuracy.percentage).toBe(100);
    expect(metrics.verdictAccuracy.matched).toBe(3);
    expect(metrics.issueKindRecall.percentage).toBe(100);
    expect(metrics.issueKindPrecision.percentage).toBe(100);
  });

  it("1 variant を誤判定すると accuracy が 66.7% になること", () => {
    const metrics = computeCorrelationMetrics([
      baseRow,
      {
        ...baseRow,
        fixtureId: "pair-a",
        variantName: "borderline",
        expectedVerdict: "inconclusive",
        computedVerdict: "fail",
        expectedIssueKinds: ["position"],
        computedIssueKinds: ["position", "size"],
        weightedStructure: 0.9,
        weightedColor: 1.5,
        humanSeverity: 0.5,
        matchesVerdict: false,
        issueKindRecall: 1,
        issueKindPrecision: 0.5,
        matchedIssueKinds: ["position"],
        missedIssueKinds: [],
        unexpectedIssueKinds: ["size"],
        worstSectionId: "section-1",
        worstSectionScore: 0.9,
      },
      {
        ...baseRow,
        fixtureId: "pair-b",
        variantName: "broken",
        expectedVerdict: "fail",
        computedVerdict: "fail",
        expectedIssueKinds: ["color"],
        computedIssueKinds: ["color"],
        weightedStructure: 0.65,
        weightedColor: 10,
        humanSeverity: 0,
        matchesVerdict: true,
        issueKindRecall: 1,
        issueKindPrecision: 1,
        matchedIssueKinds: ["color"],
        missedIssueKinds: [],
        unexpectedIssueKinds: [],
        worstSectionId: "section-2",
        worstSectionScore: 0.65,
      },
    ]);

    expect(metrics.verdictAccuracy.percentage).toBe(66.7);
    expect(metrics.verdictAccuracy.matched).toBe(2);
    expect(metrics.falseClassifications).toHaveLength(1);
  });

  it("Pearson の計算が既知入力と一致すること", () => {
    expect(calculatePearsonCorrelation([1, 0.5, 0], [1, 0.5, 0])).toBe(1);
    expect(calculatePearsonCorrelation([0, 1, 2], [1, 0.5, 0])).toBe(-1);
  });

  it("colorAligned が raw の符号を反転した値であること", () => {
    const metrics = computeCorrelationMetrics([
      baseRow,
      {
        ...baseRow,
        fixtureId: "pair-a",
        variantName: "broken",
        expectedVerdict: "fail",
        computedVerdict: "fail",
        expectedIssueKinds: ["color"],
        computedIssueKinds: ["color"],
        weightedStructure: 0.5,
        weightedColor: 10,
        humanSeverity: 0,
        matchesVerdict: true,
        issueKindRecall: 1,
        issueKindPrecision: 1,
        matchedIssueKinds: ["color"],
        missedIssueKinds: [],
        unexpectedIssueKinds: [],
        worstSectionId: "whole-frame",
        worstSectionScore: 0.5,
      },
    ]);

    expect(metrics.pearson.color).toBeLessThan(0);
    expect(metrics.pearson.colorAligned).toBe(-metrics.pearson.color);
    expect(metrics.pearson.colorAligned).toBeGreaterThan(0);
  });
});

describe("measureCorrelation integration surface", () => {
  it("空の fixtureRoot でも 0件実行でJSON/Markdownを出力できる", async () => {
    const fixtureRoot = await fs.mkdtemp(path.join(tmpdir(), "measure-correlation-empty-"));
    const outputDir = await fs.mkdtemp(path.join(tmpdir(), "measure-correlation-empty-output-"));

    const result = await measureCorrelation({
      fixtureRoot,
      outputDir,
      compareImagesFn: vi.fn(),
      buildSnapshotTimestampFn: () => "2026-01-01T00:00:00.000Z",
    });

    expect(result.rows).toHaveLength(0);
    expect(result.metrics.pairsTested).toBe(0);
    expect(result.metrics.variantsTested).toBe(0);
    expect(result.metrics.verdictAccuracy.total).toBe(0);
    expect(result.metrics.verdictAccuracy.percentage).toBe(0);
    expect(await fs.readFile(result.reportJsonPath, "utf8")).toContain('"variantsTested": 0');
    expect(await fs.readFile(result.reportMarkdownPath, "utf8")).toContain("## Data Table");

    await Promise.all([
      fs.rm(fixtureRoot, { recursive: true, force: true }),
      fs.rm(outputDir, { recursive: true, force: true }),
    ]);
  });

  it("pair- で始まらないディレクトリは無視して fixture を収集する", async () => {
    const fixtureRoot = await fs.mkdtemp(path.join(tmpdir(), "measure-correlation-ignore-"));
    const outputDir = await fs.mkdtemp(path.join(tmpdir(), "measure-correlation-ignore-output-"));
    const pairDir = path.join(fixtureRoot, "pair-06-a1-flat-region");
    const skipDir = path.join(fixtureRoot, "tmp-not-a-pair");
    await fs.mkdir(pairDir, { recursive: true });
    await fs.mkdir(skipDir, { recursive: true });
    await fs.writeFile(path.join(pairDir, "figma-export.png"), "figma-flat-region");
    await fs.writeFile(path.join(pairDir, "impl-color-pass.png"), "impl-color-pass");
    await fs.writeFile(
      path.join(pairDir, "expected.json"),
      JSON.stringify(
        {
          pairId: "pair-06-a1-flat-region",
          figmaFrame: "figma-export.png",
          variants: [
            {
              name: "single-flat-pass",
              image: "impl-color-pass.png",
              expectedVerdict: "pass",
              expectedKinds: [],
            },
          ],
        },
        null,
        2,
      ),
    );
    await fs.writeFile(path.join(skipDir, "expected.json"), JSON.stringify({ invalid: true }));

    const compareImagesFn = vi.fn().mockResolvedValue({
      diffReport: {
        aggregateVerdict: "pass",
        issues: [],
        regionScores: [],
        weightedAggregate: { weightedStructure: 1, weightedColor: 0 },
      },
    });

    const result = await measureCorrelation({
      fixtureRoot,
      outputDir,
      compareImagesFn,
      buildSnapshotTimestampFn: () => "2026-01-01T00:00:00.000Z",
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].fixtureId).toBe("pair-06-a1-flat-region");
    expect(result.rows[0].matchesVerdict).toBe(true);
    expect(result.rows[0].humanSeverity).toBe(1);
    expect(compareImagesFn).toHaveBeenCalledTimes(1);

    await Promise.all([
      fs.rm(fixtureRoot, { recursive: true, force: true }),
      fs.rm(outputDir, { recursive: true, force: true }),
    ]);
  });

  it("A-1 代表3条件（同色PASS、1段ズレFAIL、文字入り完全一致PASS）を mock で満たす", async () => {
    const fixtureRoot = await fs.mkdtemp(path.join(tmpdir(), "measure-correlation-a1-"));
    const outputDir = await fs.mkdtemp(path.join(tmpdir(), "measure-correlation-a1-output-"));

    await fs.mkdir(path.join(fixtureRoot, "pair-06-a1-flat-region"), { recursive: true });
    await fs.writeFile(
      path.join(fixtureRoot, "pair-06-a1-flat-region", "figma-export.png"),
      "figma",
    );
    await fs.writeFile(
      path.join(fixtureRoot, "pair-06-a1-flat-region", "impl-color-fail.png"),
      "impl-color-fail.png",
    );
    await fs.writeFile(
      path.join(fixtureRoot, "pair-06-a1-flat-region", "impl-color-pass.png"),
      "impl-color-pass.png",
    );
    await fs.writeFile(
      path.join(fixtureRoot, "pair-06-a1-flat-region", "impl-text-match.png"),
      "impl-text-match.png",
    );
    await fs.writeFile(
      path.join(fixtureRoot, "pair-06-a1-flat-region", "expected.json"),
      JSON.stringify(
        {
          pairId: "pair-06-a1-flat-region",
          figmaFrame: "figma-export.png",
          variants: [
            {
              name: "color-fail",
              image: "impl-color-fail.png",
              expectedVerdict: "fail",
              expectedKinds: ["color"],
            },
            {
              name: "color-pass",
              image: "impl-color-pass.png",
              expectedVerdict: "pass",
              expectedKinds: [],
            },
            {
              name: "text-match",
              image: "impl-text-match.png",
              expectedVerdict: "pass",
              expectedKinds: [],
            },
          ],
        },
        null,
        2,
      ),
    );

    const verdictByImage = new Map([
      ["impl-color-fail.png", "fail"],
      ["impl-color-pass.png", "pass"],
      ["impl-text-match.png", "pass"],
    ]);

    const compareImagesFn = vi.fn().mockImplementation(async (input) => {
      const imageName = Buffer.from(input.screenshotBase64, "base64").toString("utf8");
      const verdict = verdictByImage.get(imageName) ?? "inconclusive";
      return {
        diffReport: {
          aggregateVerdict: verdict,
          issues: verdict === "fail" ? [{ kind: "color" }] : [],
          regionScores: [],
          weightedAggregate: { weightedStructure: 1, weightedColor: 0 },
        },
      };
    });

    const result = await measureCorrelation({
      fixtureRoot,
      outputDir,
      compareImagesFn,
      buildSnapshotTimestampFn: () => "2026-01-01T00:00:00.000Z",
    });

    const rowsByName = new Map(result.rows.map((row) => [row.variantName, row]));
    expect(rowsByName.get("color-fail")?.matchesVerdict).toBe(true);
    expect(rowsByName.get("color-fail")?.computedVerdict).toBe("fail");
    expect(rowsByName.get("color-pass")?.matchesVerdict).toBe(true);
    expect(rowsByName.get("text-match")?.matchesVerdict).toBe(true);
    expect(result.metrics.verdictAccuracy.percentage).toBe(100);

    await Promise.all([
      fs.rm(fixtureRoot, { recursive: true, force: true }),
      fs.rm(outputDir, { recursive: true, force: true }),
    ]);
  });
});

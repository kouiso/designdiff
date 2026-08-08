import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";
import { z } from "zod";

import {
  resolveFixtureVerifiedSystemUiTopInset,
  SystemUiFixtureMetadataSchema,
} from "../../package/shared/dist/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURES_ROOT = path.resolve(__dirname, "../fixture");
const OUTPUT_DIR = path.resolve(__dirname, "../correlation");
const JSON_REPORT_FILENAME = "baseline-report.json";
const MARKDOWN_REPORT_FILENAME = "baseline-report.md";
const THRESHOLD = 0.1;
let compareImagesPromise = null;

const DiffIssueKindSchema = z.enum(["color", "position", "size", "missing", "extra", "typography"]);
const IgnoreRegionSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  label: z.string().optional(),
});

const FigmaNodeSchema = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    children: z.array(FigmaNodeSchema).default([]),
    absoluteBoundingBox: z
      .object({
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number(),
      })
      .nullable()
      .optional(),
  }),
);

const FixtureVariantSchema = z
  .object({
    name: z.string().min(1),
    image: z.string().min(1),
    expectedVerdict: z.enum(["pass", "fail", "inconclusive"]),
    expectedKinds: z.array(z.string()).default([]),
    expectedIssueKinds: z.array(DiffIssueKindSchema).optional(),
    ignoreRegions: z.array(IgnoreRegionSchema).optional(),
    notes: z.string().optional(),
  })
  .and(SystemUiFixtureMetadataSchema);

const FixtureExpectationSchema = z.object({
  pairId: z.string().min(1),
  figmaFrame: z.string().min(1),
  figmaRootNode: FigmaNodeSchema.optional(),
  variants: z.array(FixtureVariantSchema).min(1),
});

// Single source of truth for which scoring signals feed weightedStructure/weightedColor.
// Both the JSON and Markdown reports read this constant so they cannot silently disagree
// about which signals are active (see verification/receipt/p5-oracle-gate-2026-07-28.md
// for the exact hazard this guards against: two copies of the same fact drifting apart).
const BASELINE_SIGNALS = Object.freeze({
  active: [
    "P1 issue typing and verdict logic",
    "P2 multi-region SSIM weighting",
    "P4 texture-adjusted weighting",
  ],
  computedButNotWired: ["P3 Hausdorff (shape field on RegionScore)"],
});
const NEXT_MEASUREMENT_TRIGGER = "Re-run after P3 is wired into weightedStructure/weightedColor";

const HUMAN_SEVERITY_BY_VARIANT = Object.freeze({
  correct: 1,
  "single-section-regression": 0.5,
  "line-height-off": 0.5,
  "single-button-wrong-color": 0.5,
  "color-off": 0,
  "layout-off": 0,
  "multi-section-drift": 0,
  "font-size-off": 0,
  "all-buttons-wrong-color": 0,
});

/**
 * @typedef {z.infer<typeof FixtureVariantSchema>} FixtureVariant
 * @typedef {z.infer<typeof FixtureExpectationSchema>} FixtureExpectation
 */

/**
 * @typedef {{
 *   fixtureId: string;
 *   variantName: string;
 *   expectedVerdict: "pass" | "fail" | "inconclusive";
 *   computedVerdict: "pass" | "fail" | "inconclusive";
 *   expectedIssueKinds: string[];
 *   computedIssueKinds: string[];
 *   weightedStructure: number;
 *   weightedColor: number;
 *   humanSeverity: number;
 *   matchesVerdict: boolean;
 *   issueKindRecall: number | null;
 *   issueKindPrecision: number | null;
 *   matchedIssueKinds: string[];
 *   missedIssueKinds: string[];
 *   unexpectedIssueKinds: string[];
 *   worstSectionId: string | null;
 *   worstSectionScore: number | null;
 * }} CorrelationRow
 */

/**
 * @typedef {{
 *   pairsTested: number;
 *   variantsTested: number;
 *   verdictAccuracy: {
 *     matched: number;
 *     total: number;
 *     percentage: number;
 *   };
 *   issueKindRecall: {
 *     matched: number;
 *     expected: number;
 *     percentage: number | null;
 *   };
 *   issueKindPrecision: {
 *     matched: number;
 *     emitted: number;
 *     percentage: number | null;
 *   };
 *   pearson: {
 *     structure: number | null;
 *     color: number | null;
 *     colorAligned: number | null;
 *   };
 *   falseClassifications: CorrelationRow[];
 * }} CorrelationMetrics
 */

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function percentage(numerator, denominator, digits = 1) {
  if (denominator === 0) {
    return null;
  }
  return round((numerator / denominator) * 100, digits);
}

/**
 * @param {number[]} xs
 * @param {number[]} ys
 * @returns {number | null}
 */
export function calculatePearsonCorrelation(xs, ys) {
  if (xs.length !== ys.length) {
    throw new Error("Pearson inputs must have the same length");
  }
  if (xs.length === 0) {
    return null;
  }

  const count = xs.length;
  const meanX = xs.reduce((sum, value) => sum + value, 0) / count;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / count;

  let numerator = 0;
  let denominatorLeft = 0;
  let denominatorRight = 0;

  for (let index = 0; index < count; index += 1) {
    const deltaX = xs[index] - meanX;
    const deltaY = ys[index] - meanY;
    numerator += deltaX * deltaY;
    denominatorLeft += deltaX ** 2;
    denominatorRight += deltaY ** 2;
  }

  if (denominatorLeft === 0 || denominatorRight === 0) {
    return null;
  }

  return round(numerator / Math.sqrt(denominatorLeft * denominatorRight), 6);
}

/**
 * @param {CorrelationRow[]} rows
 * @returns {CorrelationMetrics}
 */
export function computeCorrelationMetrics(rows) {
  const matchedVerdicts = rows.filter((row) => row.matchesVerdict).length;
  const matchedIssueKinds = rows.reduce((sum, row) => sum + row.matchedIssueKinds.length, 0);
  const expectedIssueKinds = rows.reduce((sum, row) => sum + row.expectedIssueKinds.length, 0);
  const emittedIssueKinds = rows.reduce((sum, row) => sum + row.computedIssueKinds.length, 0);
  const structureScores = rows.map((row) => row.weightedStructure);
  const colorScores = rows.map((row) => row.weightedColor);
  const humanSeverities = rows.map((row) => row.humanSeverity);

  return {
    pairsTested: new Set(rows.map((row) => row.fixtureId)).size,
    variantsTested: rows.length,
    verdictAccuracy: {
      matched: matchedVerdicts,
      total: rows.length,
      percentage: percentage(matchedVerdicts, rows.length, 1) ?? 0,
    },
    issueKindRecall: {
      matched: matchedIssueKinds,
      expected: expectedIssueKinds,
      percentage: percentage(matchedIssueKinds, expectedIssueKinds, 1),
    },
    issueKindPrecision: {
      matched: matchedIssueKinds,
      emitted: emittedIssueKinds,
      percentage: percentage(matchedIssueKinds, emittedIssueKinds, 1),
    },
    pearson: {
      structure: calculatePearsonCorrelation(structureScores, humanSeverities),
      color: calculatePearsonCorrelation(colorScores, humanSeverities),
      // weightedColorは値が大きいほど悪い、humanSeverityは値が大きいほど良いという
      // 逆向きの物差しなので、生のPearson rは信号が正しく効いていれば負になる。
      // colorAlignedは符号を揃えた診断用の値で、設計書(figdiff-v2-final-design.md)の
      // 「verdict=passがhuman QAの判定と0.95以上相関する」という本来の受け入れ基準とは
      // 別物。その基準はこのレポートのverdictAccuracyで別途追う。
      colorAligned: (() => {
        const raw = calculatePearsonCorrelation(colorScores, humanSeverities);
        return raw === null ? null : round(-raw, 6);
      })(),
    },
    falseClassifications: rows.filter((row) => !row.matchesVerdict),
  };
}

/**
 * @param {FixtureVariant} variant
 * @returns {number}
 */
export function getHumanSeverity(variant) {
  const explicit = HUMAN_SEVERITY_BY_VARIANT[variant.name];
  if (explicit !== undefined) {
    return explicit;
  }
  return variant.expectedVerdict === "pass" ? 1 : 0;
}

export function getExpectedIssueKinds(variant) {
  const source = variant.expectedIssueKinds ?? variant.expectedKinds;
  return [...new Set(source)].sort((left, right) => left.localeCompare(right));
}

export async function readJson(filePath, schema) {
  const raw = await fs.readFile(filePath, "utf8");
  return schema.parse(JSON.parse(raw));
}

async function loadBase64(filePath) {
  const buffer = await fs.readFile(filePath);
  return buffer.toString("base64");
}

async function loadCompareImages() {
  if (!compareImagesPromise) {
    compareImagesPromise = import("../../app/mcp-server/dist/service/image-compare-service.js");
  }
  const { compareImages } = await compareImagesPromise;
  return compareImages;
}

function formatPercent(value) {
  return value === null ? "n/a" : `${value.toFixed(1)}%`;
}

function formatNumber(value, digits = 4) {
  return value === null ? "n/a" : value.toFixed(digits);
}

function joinKinds(kinds) {
  return kinds.length === 0 ? "-" : kinds.join(", ");
}

function escapeMarkdownCell(value) {
  return String(value).replaceAll("|", "\\|");
}

function getWorstSection(regionScores) {
  if (!regionScores || regionScores.length === 0) {
    return { worstSectionId: null, worstSectionScore: null };
  }

  const sorted = [...regionScores].sort((left, right) => {
    if (left.structure !== right.structure) {
      return left.structure - right.structure;
    }
    if (left.color !== right.color) {
      return right.color - left.color;
    }
    return (left.figmaNodeId ?? left.regionId).localeCompare(right.figmaNodeId ?? right.regionId);
  });

  const worst = sorted[0];
  return {
    worstSectionId: worst.figmaNodeId ?? worst.regionId,
    worstSectionScore: round(worst.structure, 6),
  };
}

function buildSnapshotTimestamp() {
  return new Date().toISOString();
}

/**
 * @param {string} fixtureDirName
 * @returns {Promise<CorrelationRow[]>}
 */
/**
 * @param {string} fixtureDirName
 * @param {MeasureCorrelationOptions} [options]
 */
async function measureFixture(fixtureDirName, options = {}) {
  const compareImages = options.compareImagesFn ?? (await loadCompareImages());
  const fixtureRoot = options.fixtureRoot ?? FIXTURES_ROOT;
  const fixtureDir = path.join(fixtureRoot, fixtureDirName);
  const expectedPath = path.join(fixtureDir, "expected.json");
  const expectation = await readJson(expectedPath, FixtureExpectationSchema);
  const designBase64 = await loadBase64(path.join(fixtureDir, expectation.figmaFrame));

  const rows = [];
  const variants = [...expectation.variants].sort((left, right) =>
    left.name.localeCompare(right.name),
  );

  for (const variant of variants) {
    const screenshotBase64 = await loadBase64(path.join(fixtureDir, variant.image));
    const metadata = variant.captureDevice
      ? options.readImageMetadataFn
        ? await options.readImageMetadataFn(screenshotBase64)
        : await sharp(Buffer.from(screenshotBase64, "base64")).metadata()
      : undefined;
    if (metadata && (!metadata.width || !metadata.height)) {
      throw new Error(`${expectation.pairId}/${variant.name}: screenshot dimensions are missing`);
    }
    const verifiedSystemUiTopInset = resolveFixtureVerifiedSystemUiTopInset(
      variant,
      metadata?.width && metadata.height
        ? { width: metadata.width, height: metadata.height }
        : { width: 0, height: 0 },
    );
    const result = await compareImages(
      {
        designBase64,
        screenshotBase64,
        threshold: THRESHOLD,
        ignoreRegions: variant.ignoreRegions,
        verifiedSystemUiTopInset,
      },
      expectation.figmaRootNode,
    );

    const computedVerdict = result.diffReport?.aggregateVerdict ?? "inconclusive";
    const computedIssueKinds = [
      ...new Set((result.diffReport?.issues ?? []).map((issue) => issue.kind)),
    ].sort((left, right) => left.localeCompare(right));
    const expectedIssueKinds = getExpectedIssueKinds(variant);
    const matchedIssueKinds = expectedIssueKinds.filter((kind) =>
      computedIssueKinds.includes(kind),
    );
    const missedIssueKinds = expectedIssueKinds.filter(
      (kind) => !computedIssueKinds.includes(kind),
    );
    const unexpectedIssueKinds = computedIssueKinds.filter(
      (kind) => !expectedIssueKinds.includes(kind),
    );
    const { worstSectionId, worstSectionScore } = getWorstSection(
      result.diffReport?.regionScores ?? [],
    );

    rows.push({
      fixtureId: expectation.pairId,
      variantName: variant.name,
      expectedVerdict: variant.expectedVerdict,
      computedVerdict,
      expectedIssueKinds,
      computedIssueKinds,
      weightedStructure: round(result.diffReport?.weightedAggregate?.weightedStructure ?? 0, 6),
      weightedColor: round(result.diffReport?.weightedAggregate?.weightedColor ?? 0, 6),
      humanSeverity: getHumanSeverity(variant),
      matchesVerdict: computedVerdict === variant.expectedVerdict,
      issueKindRecall:
        expectedIssueKinds.length === 0
          ? null
          : round(matchedIssueKinds.length / expectedIssueKinds.length, 6),
      issueKindPrecision:
        computedIssueKinds.length === 0
          ? null
          : round(matchedIssueKinds.length / computedIssueKinds.length, 6),
      matchedIssueKinds,
      missedIssueKinds,
      unexpectedIssueKinds,
      worstSectionId,
      worstSectionScore,
    });
  }

  return rows;
}

/**
 * @param {CorrelationRow[]} rows
 * @param {CorrelationMetrics} metrics
 * @param {string | null} snapshotTimestamp
 * @returns {string}
 */
export function renderBaselineMarkdown(rows, metrics, snapshotTimestamp) {
  const tableHeader = [
    "| Fixture | Variant | Human Severity | Expected Verdict | Computed Verdict | Match | Expected Kinds | Computed Kinds | Recall | Precision | Weighted Structure | Weighted Color | Worst Section | Worst Section Score |",
    "| --- | --- | ---: | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | ---: |",
  ];
  const tableRows = rows.map((row) =>
    [
      row.fixtureId,
      row.variantName,
      row.humanSeverity.toFixed(1),
      row.expectedVerdict,
      row.computedVerdict,
      row.matchesVerdict ? "yes" : "no",
      joinKinds(row.expectedIssueKinds),
      joinKinds(row.computedIssueKinds),
      row.issueKindRecall === null ? "n/a" : row.issueKindRecall.toFixed(3),
      row.issueKindPrecision === null ? "n/a" : row.issueKindPrecision.toFixed(3),
      row.weightedStructure.toFixed(6),
      row.weightedColor.toFixed(6),
      row.worstSectionId ?? "-",
      row.worstSectionScore === null ? "n/a" : row.worstSectionScore.toFixed(6),
    ]
      .map(escapeMarkdownCell)
      .join(" | "),
  );

  const falseClassificationLines =
    metrics.falseClassifications.length === 0
      ? ["- None"]
      : metrics.falseClassifications.map(
          (row) =>
            `- ${row.fixtureId}/${row.variantName}: expected ${row.expectedVerdict}, computed ${row.computedVerdict}, expected kinds [${joinKinds(row.expectedIssueKinds)}], computed kinds [${joinKinds(row.computedIssueKinds)}], worst=${row.worstSectionId ?? "n/a"} (${formatNumber(row.worstSectionScore, 6)})`,
        );

  return [
    "# L7 Baseline Correlation Report",
    "",
    "## Summary",
    "",
    `- Verdict accuracy: ${formatPercent(metrics.verdictAccuracy.percentage)} (${metrics.verdictAccuracy.matched}/${metrics.verdictAccuracy.total})`,
    `- Pairs tested: ${metrics.pairsTested}`,
    `- Variants tested: ${metrics.variantsTested}`,
    `- Issue kind recall: ${formatPercent(metrics.issueKindRecall.percentage)} (${metrics.issueKindRecall.matched}/${metrics.issueKindRecall.expected})`,
    `- Issue kind precision: ${formatPercent(metrics.issueKindPrecision.percentage)} (${metrics.issueKindPrecision.matched}/${metrics.issueKindPrecision.emitted})`,
    `- Snapshot timestamp: ${snapshotTimestamp ?? "unknown"}`,
    "",
    "## Data Table",
    "",
    ...tableHeader,
    ...tableRows.map((row) => `| ${row} |`),
    "",
    "## Correlation Analysis",
    "",
    `- Structure Pearson r: ${formatNumber(metrics.pearson.structure, 6)}`,
    `- Color Pearson r (raw): ${formatNumber(metrics.pearson.color, 6)}`,
    `- Color Pearson r (severity-aligned, = -raw): ${formatNumber(metrics.pearson.colorAligned, 6)}`,
    `- Human severity mapping: correct=1.0, borderline=0.5, broken=0.0`,
    "- Note: weightedColor is a defect magnitude (bigger = worse) while human severity is",
    "  bigger = better, so the raw color Pearson r is expected to be negative when the",
    "  signal works correctly. colorAligned is a diagnostic value with the sign flipped for",
    "  readability. The design doc's actual 0.95 acceptance bar",
    "  (docs/design/figdiff-v2-final-design.md) is defined as `verdict=pass` correlating",
    "  >=0.95 with human QA judgment, tracked separately above as Verdict accuracy",
    "  (not the same as this Pearson r on the continuous structure/color scores).",
    "",
    "## False Classifications",
    "",
    ...falseClassificationLines,
    "",
    "## Baseline Signals In Effect",
    "",
    `- Active: ${BASELINE_SIGNALS.active.join(", ")}`,
    `- Computed but not wired into weightedStructure/weightedColor yet: ${BASELINE_SIGNALS.computedButNotWired.join(", ")}`,
    "",
    "## Next Measurement Trigger",
    "",
    `- ${NEXT_MEASUREMENT_TRIGGER} (\`pnpm node verification/script/measure-correlation.mjs\`).`,
    "",
  ].join("\n");
}

/**
 * @param {CorrelationRow[]} rows
 * @param {CorrelationMetrics} metrics
 * @param {string | null} snapshotTimestamp
 */
export function buildBaselineReport(rows, metrics, snapshotTimestamp) {
  return {
    summary: {
      verdictAccuracy: metrics.verdictAccuracy,
      pairsTested: metrics.pairsTested,
      variantsTested: metrics.variantsTested,
      issueKindRecall: metrics.issueKindRecall,
      issueKindPrecision: metrics.issueKindPrecision,
      pearson: metrics.pearson,
      snapshotTimestamp,
      baselineSignalsInEffect: BASELINE_SIGNALS,
      nextMeasurementTrigger: NEXT_MEASUREMENT_TRIGGER,
    },
    rows,
    falseClassifications: metrics.falseClassifications,
  };
}

async function publishReportFilesAtomically(files) {
  const transactionId = `${process.pid}-${Date.now()}`;
  const entries = files.map(({ targetPath, content }) => ({
    targetPath,
    content,
    stagingPath: `${targetPath}.tmp-${transactionId}`,
    backupPath: `${targetPath}.backup-${transactionId}`,
    targetExisted: false,
    installed: false,
  }));

  await Promise.all(
    entries.map(async (entry) => {
      await fs.mkdir(path.dirname(entry.targetPath), { recursive: true });
      await fs.writeFile(entry.stagingPath, entry.content);
    }),
  );

  let succeeded = false;
  try {
    for (const entry of entries) {
      try {
        await fs.rename(entry.targetPath, entry.backupPath);
        entry.targetExisted = true;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    for (const entry of entries) {
      await fs.rename(entry.stagingPath, entry.targetPath);
      entry.installed = true;
    }
    succeeded = true;
  } finally {
    if (!succeeded) {
      for (const entry of [...entries].reverse()) {
        if (entry.installed) {
          await fs.rm(entry.targetPath, { force: true });
        }
        if (entry.targetExisted) {
          await fs.rename(entry.backupPath, entry.targetPath);
        }
      }
    }
    await Promise.all(
      entries.flatMap((entry) => [
        fs.rm(entry.stagingPath, { force: true }),
        fs.rm(entry.backupPath, { force: true }),
      ]),
    );
  }
}

/**
 * @typedef {{
 *   fixtureRoot?: string;
 *   outputDir?: string;
 *   jsonOutputPath?: string;
 *   markdownOutputPath?: string;
 *   compareImagesFn?: (input: object, rootNode?: object) => Promise<object>;
 *   buildSnapshotTimestampFn?: () => string | null;
 *   readImageMetadataFn?: (imageBase64: string) => Promise<{width?: number; height?: number}>;
 * }} MeasureCorrelationOptions
 *
 * @param {MeasureCorrelationOptions} [options]
 */
export async function measureCorrelation(options = {}) {
  const fixtureRoot = options.fixtureRoot ?? FIXTURES_ROOT;
  const outputDir = options.outputDir ?? OUTPUT_DIR;
  const jsonOutputPath = options.jsonOutputPath ?? path.join(outputDir, JSON_REPORT_FILENAME);
  const markdownOutputPath =
    options.markdownOutputPath ?? path.join(outputDir, MARKDOWN_REPORT_FILENAME);
  const buildSnapshotTimestampFn = options.buildSnapshotTimestampFn ?? buildSnapshotTimestamp;

  const entries = await fs.readdir(fixtureRoot, { withFileTypes: true });
  const fixtureDirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("pair-"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const nestedRows = [];
  for (const fixtureDir of fixtureDirs) {
    nestedRows.push(await measureFixture(fixtureDir, options));
  }

  const rows = nestedRows.flat();
  const metrics = computeCorrelationMetrics(rows);
  const snapshotTimestamp = buildSnapshotTimestampFn();
  const reportJson = buildBaselineReport(rows, metrics, snapshotTimestamp);
  const reportMarkdown = renderBaselineMarkdown(rows, metrics, snapshotTimestamp);

  await publishReportFilesAtomically([
    {
      targetPath: jsonOutputPath,
      content: `${JSON.stringify(reportJson, null, 2)}\n`,
    },
    {
      targetPath: markdownOutputPath,
      content: reportMarkdown,
    },
  ]);

  return {
    rows,
    metrics,
    snapshotTimestamp,
    reportJsonPath: jsonOutputPath,
    reportMarkdownPath: markdownOutputPath,
  };
}

async function main() {
  const result = await measureCorrelation();
  const { metrics } = result;

  console.info(`Verdict accuracy: ${formatPercent(metrics.verdictAccuracy.percentage)}`);
  console.info(`Structure Pearson: ${formatNumber(metrics.pearson.structure, 6)}`);
  console.info(`Color Pearson: ${formatNumber(metrics.pearson.color, 6)}`);

  if (metrics.falseClassifications.length === 0) {
    console.info("False classifications: none");
  } else {
    console.info("False classifications:");
    for (const row of metrics.falseClassifications) {
      console.info(
        `- ${row.fixtureId}/${row.variantName}: ${row.expectedVerdict} -> ${row.computedVerdict}`,
      );
    }
  }

  console.info(
    `L7 BASELINE: accuracy=${formatPercent(metrics.verdictAccuracy.percentage)}, structure_r=${formatNumber(metrics.pearson.structure, 6)}, color_r_aligned=${formatNumber(metrics.pearson.colorAligned, 6)}, pending_P3`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  await main();
}

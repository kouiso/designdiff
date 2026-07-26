// =============================================================================
// FigDiff Shared Types
// All types defined per document.md Section 3.4
// Types are derived from Zod schemas for runtime validation
// =============================================================================

import {
  type BorderRadiusSchema,
  type ChildNodeSummarySchema,
  type CritiqueNoteSchema,
  type ClusterTelemetrySchema,
  type CompareDesignResultSchema,
  type LoopGuardReportSchema,
  type CompletionCriteriaSchema,
  type CompletionCriterionSchema,
  type ComparisonDiagnosisSchema,
  type ComparisonHeadlineSchema,
  type DiagnosisCauseSchema,
  type DiagnosisCauseCodeSchema,
  type DiagnosisVerdictSchema,
  type NormalizationReportSchema,
  type PreflightReportSchema,
  type PreflightSeveritySchema,
  type PreflightWarningSchema,
  type PreflightWarningCodeSchema,
  type CropRegionSchema,
  type IgnoreRegionSchema,
  type DesignSourceSchema,
  type DesignTokenSchema,
  type DiffRegionSchema,
  type FigmaAuthStateSchema,
  type FigmaOAuthTokenResponseSchema,
  type FigmaTokenSchema,
  type FrameSchema,
  type GridSummaryCellSchema,
  type GridSummarySchema,
  type ImageDimensionsSchema,
  type IgnoreRegionConfigEntrySchema,
  type IgnoreRegionConfigFileSchema,
  type NodeAppearanceSchema,
  type NodeEffectSchema,
  type NodeFillSchema,
  type NodeInspectionSchema,
  type NodeLayoutSchema,
  type NodeStrokeSchema,
  type NodeTypographySchema,
  type ParsedDesignInputSchema,
  type ProjectPageSchema,
  type ProjectSchema,
} from "./schema.js";

import type { z } from "zod";

// --- Design Provider Interface ---

export interface DesignProvider {
  name: string;
  listFrames(fileUrl: string): Promise<Frame[]>;
  getFrameImage(fileUrl: string, frameId: string, scale: number): Promise<Uint8Array>;
  getDesignTokens(fileUrl: string, frameId: string, depth: number): Promise<DesignToken[]>;
  inspectNode(fileUrl: string, nodeId: string): Promise<NodeInspection>;
}

// --- Frame ---

export type Frame = z.infer<typeof FrameSchema>;

// --- Design Token ---

export type DesignToken = z.infer<typeof DesignTokenSchema>;

// --- Node Inspection (Figma Dev Mode-like detail) ---

export type NodeInspection = z.infer<typeof NodeInspectionSchema>;
export type NodeLayout = z.infer<typeof NodeLayoutSchema>;
export type NodeAppearance = z.infer<typeof NodeAppearanceSchema>;
export type NodeFill = z.infer<typeof NodeFillSchema>;
export type NodeStroke = z.infer<typeof NodeStrokeSchema>;
export type BorderRadius = z.infer<typeof BorderRadiusSchema>;
export type NodeEffect = z.infer<typeof NodeEffectSchema>;
export type NodeTypography = z.infer<typeof NodeTypographySchema>;
export type ChildNodeSummary = z.infer<typeof ChildNodeSummarySchema>;

// --- Design Input Parsing ---

export type ParsedDesignInput = z.infer<typeof ParsedDesignInputSchema>;

// --- Compare Design Result (Phase 2+, type defined ahead) ---

export type CompareDesignResult = z.infer<typeof CompareDesignResultSchema>;
export type LoopGuardReport = z.infer<typeof LoopGuardReportSchema>;
export type DiffRegion = z.infer<typeof DiffRegionSchema>;
export type ClusterTelemetry = z.infer<typeof ClusterTelemetrySchema>;
export type GridSummary = z.infer<typeof GridSummarySchema>;
export type GridSummaryCell = z.infer<typeof GridSummaryCellSchema>;

// --- Comparison Confidence Layer ---

export type PreflightWarningCode = z.infer<typeof PreflightWarningCodeSchema>;
export type PreflightSeverity = z.infer<typeof PreflightSeveritySchema>;
export type PreflightWarning = z.infer<typeof PreflightWarningSchema>;
export type PreflightReport = z.infer<typeof PreflightReportSchema>;
export type NormalizationReport = z.infer<typeof NormalizationReportSchema>;
export type ComparisonHeadline = z.infer<typeof ComparisonHeadlineSchema>;
export type DiagnosisVerdict = z.infer<typeof DiagnosisVerdictSchema>;
export type DiagnosisCauseCode = z.infer<typeof DiagnosisCauseCodeSchema>;
export type DiagnosisCause = z.infer<typeof DiagnosisCauseSchema>;
export type ComparisonDiagnosis = z.infer<typeof ComparisonDiagnosisSchema>;

// --- Crop Region (Phase 2+) ---

export type CropRegion = z.infer<typeof CropRegionSchema>;

// --- Ignore Region (PR #57) ---

export type IgnoreRegion = z.infer<typeof IgnoreRegionSchema>;
export type IgnoreRegionConfigEntry = z.infer<typeof IgnoreRegionConfigEntrySchema>;
export type IgnoreRegionConfigFile = z.infer<typeof IgnoreRegionConfigFileSchema>;

// --- Project (v4: implementation URL + pages + design sources) ---

export type Project = z.infer<typeof ProjectSchema>;
export type ProjectPage = z.infer<typeof ProjectPageSchema>;
export type DesignSource = z.infer<typeof DesignSourceSchema>;

// --- Completion Criteria (v4: AI-driven PASS/FAIL) ---

export type CompletionCriterion = z.infer<typeof CompletionCriterionSchema>;
export type CompletionCriteria = z.infer<typeof CompletionCriteriaSchema>;

// --- Figma Token ---

export type FigmaToken = z.infer<typeof FigmaTokenSchema>;

// --- Figma OAuth ---

export type FigmaOAuthTokenResponse = z.infer<typeof FigmaOAuthTokenResponseSchema>;
export type FigmaAuthState = z.infer<typeof FigmaAuthStateSchema>;

// --- Image Dimensions ---

export type ImageDimensions = z.infer<typeof ImageDimensionsSchema>;

// --- FigDiff v2 Diff Report (P1) ---

export type DiffIssueKind = "color" | "position" | "size" | "missing" | "extra" | "typography";

export type DiffSeverity = "critical" | "major" | "minor";

export interface DiffEvidence {
  signal: string;
  value: number;
  threshold: number;
  expected: unknown;
  actual: unknown;
  figmaFileKey?: string;
  figmaNodeId?: string;
  figmaPageName?: string;
}

export interface DiffBoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DiffIssue {
  regionId: string;
  bbox: DiffBoundingBox;
  kind: DiffIssueKind;
  severity: DiffSeverity;
  evidence: DiffEvidence;
  figmaNodeId?: string;
  suggestedCssFix?: string;
}

export interface RegionScore {
  regionId: string;
  bbox: DiffBoundingBox;
  // P2 では figmaRootNode.children 由来の region に Figma node id を付与する。
  figmaNodeId?: string;
  structure: number;
  color: number;
  shape: number;
  layout: number;
  textureScore?: number;
  // 両側がベタ面のときだけ入る。ΔE2000 が閾値を下回るトークン1段のズレを捕まえる。
  flatColorMismatch?: {
    designHex: string;
    screenshotHex: string;
    maxChannelDelta: number;
  };
}

export interface Alignment {
  translation: { x: number; y: number };
  scale: { x: number; y: number };
  rotation: number;
  confidence: number;
  residual: number;
}

export type DiffVerdict = "pass" | "fail" | "inconclusive";

export interface DiffReport {
  alignment: Alignment;
  regionScores: RegionScore[];
  issues: DiffIssue[];
  weightedAggregate?: WeightedAggregate;
  aggregateVerdict: DiffVerdict;
  rationale: string;
  // 知覚できる差 (ΔE2000 > 2) を持つ画素の割合 (0..1)。
  // pixelmatch の threshold にも profile にも依存しない独立した証拠。
  perceptibleDiffRatio?: number;
}

export type CritiqueNote = z.infer<typeof CritiqueNoteSchema>;

export interface WeightedAggregate {
  weightedStructure: number;
  weightedColor: number;
  totalWeight: number;
}

const TEXTURE_WEIGHT_ALPHA = 0.7;
const PHOTO_LIKE_TEXTURE_THRESHOLD = 0.6;
const PHOTO_LIKE_WEIGHT_MULTIPLIER = 0.3;

const getTextureAdjustedWeight = (
  rawTotalArea: number,
  regionCount: number,
  score: RegionScore,
): number => {
  const rawArea = score.bbox.w * score.bbox.h;
  const baseWeight = rawTotalArea > 0 ? rawArea / rawTotalArea : 1 / regionCount;
  const textureScore = Math.min(1, Math.max(0, score.textureScore ?? 0));
  const scaledWeight = baseWeight * (1 - TEXTURE_WEIGHT_ALPHA * textureScore);

  if (textureScore > PHOTO_LIKE_TEXTURE_THRESHOLD) {
    return Math.min(scaledWeight, baseWeight * PHOTO_LIKE_WEIGHT_MULTIPLIER);
  }

  return scaledWeight;
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const normalizeWeightedAggregate = (regionScores: RegionScore[]): WeightedAggregate => {
  if (regionScores.length === 0) {
    return {
      weightedStructure: 1,
      weightedColor: 0,
      totalWeight: 0,
    };
  }

  const rawTotalArea = regionScores.reduce((sum, score) => sum + score.bbox.w * score.bbox.h, 0);
  const adjustedWeights = regionScores.map((score) => {
    return getTextureAdjustedWeight(rawTotalArea, regionScores.length, score);
  });
  const adjustedTotalWeight = adjustedWeights.reduce((sum, weight) => sum + weight, 0);

  const aggregate = regionScores.reduce(
    (aggregate, score, index) => {
      const weight =
        adjustedTotalWeight > 0
          ? adjustedWeights[index] / adjustedTotalWeight
          : 1 / regionScores.length;

      aggregate.weightedStructure += weight * score.structure;
      aggregate.weightedColor += weight * score.color;
      aggregate.totalWeight = adjustedTotalWeight;
      return aggregate;
    },
    {
      weightedStructure: 0,
      weightedColor: 0,
      totalWeight: 0,
    },
  );

  return {
    ...aggregate,
    weightedStructure: clamp01(aggregate.weightedStructure),
  };
};

const usesTextureAdjustedWeights = (regionScores: RegionScore[]): boolean => {
  return regionScores.some((score) => (score.textureScore ?? 0) > 0);
};

const buildTextureRationaleSuffix = (regionScores: RegionScore[]): string => {
  if (!usesTextureAdjustedWeights(regionScores)) {
    return "";
  }

  return " with texture-adjusted weights active (alpha 0.700, photo-like cap 0.300)";
};

const buildWorstRegionEvidenceSuffix = (regionScores: RegionScore[]): string => {
  if (regionScores.length === 0) {
    return "";
  }

  const worstRegion = regionScores.reduce((worst, current) => {
    if (current.structure !== worst.structure) {
      return current.structure < worst.structure ? current : worst;
    }

    return current.color > worst.color ? current : worst;
  }, regionScores[0]);

  return `; weakest region ${worstRegion.regionId} (structure ${worstRegion.structure.toFixed(
    3,
  )}, color ΔE ${worstRegion.color.toFixed(3)}; lower=better, critical threshold 2)`;
};

export const computeVerdict = (
  report: Omit<DiffReport, "aggregateVerdict" | "rationale">,
): { verdict: DiffVerdict; rationale: string; weightedAggregate: WeightedAggregate } => {
  const hasCriticalIssue = report.issues.some((issue) => issue.severity === "critical");
  // P2 では region 面積で重み付けし、単一セクションの暴走で全体 verdict が即死しないようにする。
  const weightedAggregate = normalizeWeightedAggregate(report.regionScores);
  const textureRationaleSuffix = buildTextureRationaleSuffix(report.regionScores);
  const worstRegionEvidenceSuffix = buildWorstRegionEvidenceSuffix(report.regionScores);

  if (hasCriticalIssue) {
    return {
      verdict: "fail",
      rationale: `critical severity issue detected${worstRegionEvidenceSuffix}${textureRationaleSuffix}`,
      weightedAggregate,
    };
  }

  if (weightedAggregate.weightedStructure < 0.8) {
    return {
      verdict: "fail",
      rationale: `weighted structure score ${weightedAggregate.weightedStructure.toFixed(
        3,
      )} is below fail threshold 0.800 (weighted color ${weightedAggregate.weightedColor.toFixed(
        3,
      )}, totalWeight ${weightedAggregate.totalWeight.toFixed(3)})${worstRegionEvidenceSuffix}${textureRationaleSuffix}`,
      weightedAggregate,
    };
  }

  if (weightedAggregate.weightedStructure >= 0.95 && weightedAggregate.weightedColor < 3) {
    return {
      verdict: "pass",
      // color は ΔE 相当の「差分量」を想定し、高いほど色差が大きい単位として扱う。
      rationale: `no critical issues, weighted structure score ${weightedAggregate.weightedStructure.toFixed(
        3,
      )} meets pass threshold, and weighted color difference ${weightedAggregate.weightedColor.toFixed(
        3,
      )} is below 3.000 (totalWeight ${weightedAggregate.totalWeight.toFixed(3)})${worstRegionEvidenceSuffix}${textureRationaleSuffix}`,
      weightedAggregate,
    };
  }

  return {
    verdict: "inconclusive",
    rationale: `no fail condition met, but weighted structure score ${weightedAggregate.weightedStructure.toFixed(
      3,
    )} and weighted color difference ${weightedAggregate.weightedColor.toFixed(
      3,
    )} do not satisfy pass thresholds (totalWeight ${weightedAggregate.totalWeight.toFixed(
      3,
    )})${worstRegionEvidenceSuffix}${textureRationaleSuffix}`,
    weightedAggregate,
  };
};

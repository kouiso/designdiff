// Figma Client
export {
  FigmaApiError,
  FigmaClient,
  NoCacheStrategy,
  collectNestedFrames,
  extractFrames,
  extractNestedFrames,
  extractPageFrames,
  isTokenError,
  type FigmaCacheStrategy,
  type FigmaAuthMode,
  type FigmaColor,
  type FigmaEffect,
  type FigmaFileResponse,
  type FigmaImagesResponse,
  type FigmaNode,
  type FigmaNodesResponse,
  type FigmaTypeStyle,
  type BoundingBox,
  type FigmaPaint,
} from "./figma-client.js";

// CSS Suggestion Generator
export { generateCssSuggestion, figmaColorToHex } from "./css-suggestion.js";

// Node Matcher (diff region → Figma node)
export {
  matchDiffRegionsToNodes,
  pointInBoundingBox,
  boundingBoxArea,
} from "./node-matcher.js";

// Diff Clustering (pixelmatch output → regions)
export {
  clusterDiffPixels,
  clusterDiffPixelsGrid,
  clusterDiffPixelsGridDetailed,
  generateMatchSuggestion,
  type GridClusterResult,
  type GridClusterOptions,
} from "./diff-cluster.js";

// Signal
export { computeSsim, computeSsimForRegion, type SsimRegion } from "./signal/ssim.js";
export { detectHighTextureRegion } from "./signal/texture.js";
export { computeHausdorff } from "./signal/hausdorff.js";
export { computeMeanDeltaE2000, deltaE2000, srgbToLab } from "./signal/delta-e-2000.js";
export { selfCritique } from "./self-critique.js";

// Comparison Confidence Layer (pre-flight / diagnosis / headline)
export { runPreflight, type PreflightInput } from "./confidence/preflight.js";
export { diagnoseComparison, type DiagnosisInput } from "./confidence/diagnosis.js";
export { buildComparisonHeadline } from "./confidence/headline.js";
export {
  buildSystemBarIgnoreRegions,
  type MobileSystemBarPlatform,
} from "./confidence/system-bar-ignore-regions.js";
export {
  rankFrameCandidates,
  formatFrameCandidates,
  type RankedFrame,
} from "./confidence/frame-guidance.js";

// View Mode Types
export {
  VIEW_MODES,
  VIEW_MODE_METADATA,
  type ViewMode,
  type ViewModeMetadata,
} from "./view-mode.js";

// Zod Schemas

// Figma URL parser
export {
  buildFigmaFrameUrl,
  extractFileKey,
  extractNodeId,
  normalizeNodeId,
  parseDesignInput,
} from "./figma-url-parser.js";
export {
  AlignmentSchema,
  BorderRadiusSchema,
  ChildNodeSummarySchema,
  CritiqueConcernSchema,
  CritiqueNoteSchema,
  ClusterTelemetrySchema,
  CompareDesignResultSchema,
  ComparisonDiagnosisSchema,
  ComparisonHeadlineSchema,
  DiagnosisCauseSchema,
  DiagnosisCauseCodeSchema,
  DiagnosisVerdictSchema,
  NormalizationReportSchema,
  PreflightReportSchema,
  PreflightSeveritySchema,
  PreflightWarningSchema,
  PreflightWarningCodeSchema,
  CropRegionSchema,
  IgnoreRegionSchema,
  IgnoreRegionConfigEntrySchema,
  IgnoreRegionConfigFileSchema,
  DesignTokenSchema,
  DiffBoundingBoxSchema,
  DiffEvidenceSchema,
  DiffIssueKindSchema,
  DiffIssueSchema,
  DiffReportSchema,
  DiffSeveritySchema,
  DiffVerdictSchema,
  DiffRegionSchema,
  FigmaAuthStateSchema,
  FigmaOAuthTokenResponseSchema,
  FigmaTokenSchema,
  FrameSchema,
  GridSummaryCellSchema,
  GridSummarySchema,
  ImageDimensionsSchema,
  NodeAppearanceSchema,
  NodeEffectSchema,
  NodeFillSchema,
  NodeInspectionSchema,
  NodeLayoutSchema,
  NodeStrokeSchema,
  NodeTypographySchema,
  RegionScoreSchema,
  WeightedAggregateSchema,
  CompletionCriteriaSchema,
  CompletionCriterionSchema,
  DesignSourceSchema,
  ParsedDesignInputSchema,
  ProjectPageSchema,
  ProjectSchema,
} from "./schema.js";
// Types derived from schemas
export type {
  Alignment,
  BorderRadius,
  ChildNodeSummary,
  CritiqueNote,
  ClusterTelemetry,
  CompareDesignResult,
  ComparisonDiagnosis,
  ComparisonHeadline,
  DiagnosisCause,
  DiagnosisCauseCode,
  DiagnosisVerdict,
  NormalizationReport,
  PreflightReport,
  PreflightSeverity,
  PreflightWarning,
  PreflightWarningCode,
  DiffBoundingBox,
  DiffEvidence,
  DiffIssue,
  DiffIssueKind,
  DiffReport,
  DiffSeverity,
  DiffVerdict,
  CropRegion,
  IgnoreRegion,
  IgnoreRegionConfigEntry,
  IgnoreRegionConfigFile,
  DesignProvider,
  DesignToken,
  DiffRegion,
  FigmaAuthState,
  FigmaOAuthTokenResponse,
  FigmaToken,
  Frame,
  GridSummary,
  GridSummaryCell,
  ImageDimensions,
  NodeAppearance,
  NodeEffect,
  NodeFill,
  NodeInspection,
  NodeLayout,
  NodeStroke,
  NodeTypography,
  RegionScore,
  WeightedAggregate,
  CompletionCriteria,
  CompletionCriterion,
  DesignSource,
  ParsedDesignInput,
  Project,
  ProjectPage,
} from "./type.js";
export { computeVerdict } from "./type.js";

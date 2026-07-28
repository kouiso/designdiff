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
  FIGMA_NODE_NOT_FOUND_MARKER,
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

// Figma Node → 検査結果への変換
export { transformNode } from "./transform-node.js";

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
export {
  ALIGNMENT_IMPROVEMENT_THRESHOLD,
  COARSE_RANGE,
  COARSE_SAMPLE_STEP,
  COARSE_STEP,
  DIFF_THRESHOLD_SQ,
  FINE_RANGE,
  countSsdOffset,
  detectTranslation,
  resolveAlignment,
  shiftPixels,
  type ResolvedAlignment,
} from "./signal/translation.js";
export {
  DEFAULT_DRIFT_FAIL_MS,
  DEFAULT_DRIFT_WINDOW_MS,
  MAX_FRAMES,
  aggregateTemporalVerdict,
  alignFrame,
  detectOrderViolation,
  parseFrameTimestamps,
  selectCandidates,
  type FrameAlignment,
  type FrameMismatch,
  type TemporalVerdict,
} from "./signal/temporal-align.js";
export {
  compareFlatRegionColor,
  detectFlatRegionColor,
  type FlatRegionColor,
  type FlatRegionColorComparison,
} from "./signal/flat-region-color.js";
export {
  computeMeanDeltaE2000,
  computePerceptibleDiffRatio,
  deltaE2000,
  PERCEPTIBLE_DELTA_E,
  PERCEPTIBLE_DIFF_CONTRADICTION_RATIO,
  srgbToLab,
} from "./signal/delta-e-2000.js";
export {
  detectDynamicRegions,
  detectDynamicRegionsAcrossSamples,
  DYNAMIC_CELL_SIZE,
  DYNAMIC_CHANNEL_TOLERANCE,
  type DetectDynamicRegionsOptions,
  type DynamicRegion,
} from "./signal/dynamic-region.js";
export {
  detectToastBands,
  type DetectToastBandsOptions,
  type ToastBandCandidate,
} from "./signal/toast-band.js";
export { selfCritique } from "./self-critique.js";

// Comparison Confidence Layer (pre-flight / diagnosis / headline)
export { runPreflight, type PreflightInput } from "./confidence/preflight.js";
export {
  diagnoseComparison,
  isFullPageAgainstShorterCapture,
  type DiagnosisInput,
} from "./confidence/diagnosis.js";
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
  ClusterCollapseSchema,
  ClusterTelemetrySchema,
  CompareDesignResultSchema,
  LoopGuardReportSchema,
  ComparisonDiagnosisSchema,
  ComparisonHeadlineSchema,
  DiagnosisCauseSchema,
  DiagnosisCauseCodeSchema,
  DiagnosisVerdictSchema,
  NormalizationReportSchema,
  ScrollCaptureReportSchema,
  PreflightReportSchema,
  PreflightSeveritySchema,
  PreflightWarningSchema,
  PreflightWarningCodeSchema,
  CropRegionSchema,
  IgnoreRegionSchema,
  CompareAnimationResultSchema,
  FrameComparisonSchema,
  FrameAlignmentSchema,
  TemporalVerdictSchema,
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
  DomElementStyleSchema,
  TokenDiffReportSchema,
  TokenMismatchSchema,
  VerdictRouteSchema,
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
  ClusterCollapse,
  ClusterTelemetry,
  CompareDesignResult,
  LoopGuardReport,
  ComparisonDiagnosis,
  ComparisonHeadline,
  DiagnosisCause,
  DiagnosisCauseCode,
  DiagnosisVerdict,
  NormalizationReport,
  ScrollCaptureReport,
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
  DomElementStyle,
  TokenDiffReport,
  TokenMismatch,
  VerdictRoute,
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
export { computeVerdict, selectScoringRegions, UNIMPLEMENTED_LAYOUT_SCORE } from "./type.js";

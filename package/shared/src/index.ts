// Figma Client
export {
  collectNestedFrames,
  extractFrames,
  extractNestedFrames,
  extractPageFrames,
  FIGMA_NODE_NOT_FOUND_MARKER,
  FigmaApiError,
  FigmaClient,
  isTokenError,
  NoCacheStrategy,
  type BoundingBox,
  type FigmaAuthMode,
  type FigmaCacheStrategy,
  type FigmaColor,
  type FigmaEffect,
  type FigmaFileResponse,
  type FigmaImagesResponse,
  type FigmaNode,
  type FigmaNodesResponse,
  type FigmaPaint,
  type FigmaTypeStyle,
} from "./figma-client.js";

export {
  resolveFixtureVerifiedSystemUiTopInset,
  SystemUiFixtureMetadataSchema,
  type SystemUiFixtureMetadata,
} from "./verification-fixture.js";

// CSS Suggestion Generator
export { figmaColorToHex, generateCssSuggestion } from "./css-suggestion.js";

// Figma Node → 検査結果への変換
export { transformNode } from "./transform-node.js";

// Node Matcher (diff region → Figma node)
export {
  boundingBoxArea,
  matchDiffRegionsToNodes,
  pointInBoundingBox,
} from "./node-matcher.js";

// Diff Clustering (pixelmatch output → regions)
export {
  clusterDiffPixels,
  clusterDiffPixelsGrid,
  clusterDiffPixelsGridDetailed,
  generateMatchSuggestion,
  type GridClusterOptions,
  type GridClusterResult,
} from "./diff-cluster.js";

// Signal
export { selfCritique } from "./self-critique.js";
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
  compareFlatRegionColor,
  detectFlatRegionColor,
  type FlatRegionColor,
  type FlatRegionColorComparison,
} from "./signal/flat-region-color.js";
export {
  classifyGlyphEdgeRasterization,
  type GlyphEdgeRasterEvidence,
} from "./signal/glyph-edge-raster.js";
export { computeHausdorff } from "./signal/hausdorff.js";
export { computeSsim, computeSsimForRegion, type SsimRegion } from "./signal/ssim.js";
export {
  aggregateTemporalVerdict,
  alignFrame,
  DEFAULT_DRIFT_FAIL_MS,
  DEFAULT_DRIFT_WINDOW_MS,
  detectOrderViolation,
  MAX_FRAMES,
  parseFrameTimestamps,
  selectCandidates,
  type FrameAlignment,
  type FrameMismatch,
  type TemporalVerdict,
} from "./signal/temporal-align.js";
export { detectHighTextureRegion } from "./signal/texture.js";
export {
  detectToastBands,
  type DetectToastBandsOptions,
  type ToastBandCandidate,
} from "./signal/toast-band.js";
export {
  ALIGNMENT_IMPROVEMENT_THRESHOLD,
  buildVerifiedInsetCandidates,
  COARSE_RANGE,
  COARSE_SAMPLE_STEP,
  COARSE_STEP,
  countSsdOffset,
  detectTranslation,
  DIFF_THRESHOLD_SQ,
  FINE_RANGE,
  resolveAlignment,
  shiftPixels,
  type ResolvedAlignment,
  type TranslationCandidate,
} from "./signal/translation.js";

// Comparison Confidence Layer (pre-flight / diagnosis / headline)
export {
  diagnoseComparison,
  isFullPageAgainstShorterCapture,
  type DiagnosisInput,
} from "./confidence/diagnosis.js";
export {
  formatFrameCandidates,
  rankFrameCandidates,
  type RankedFrame,
} from "./confidence/frame-guidance.js";
export { buildComparisonHeadline } from "./confidence/headline.js";
export { runPreflight, type PreflightInput } from "./confidence/preflight.js";
export {
  buildSystemBarIgnoreRegions,
  getVerifiedSystemBarTopInset,
  type MobileSystemBarPlatform,
} from "./confidence/system-bar-ignore-regions.js";

// View Mode Types
export {
  VIEW_MODE_METADATA,
  VIEW_MODES,
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
  ClusterCollapseSchema,
  ClusterTelemetrySchema,
  CompareAnimationResultSchema,
  CompareDesignResultSchema,
  ComparisonDiagnosisSchema,
  ComparisonHeadlineSchema,
  CompletionCriteriaSchema,
  CompletionCriterionSchema,
  CritiqueConcernSchema,
  CritiqueNoteSchema,
  CropRegionSchema,
  DesignSourceSchema,
  DesignTokenSchema,
  DiagnosisCauseCodeSchema,
  DiagnosisCauseSchema,
  DiagnosisVerdictSchema,
  DiffBoundingBoxSchema,
  DiffEvidenceSchema,
  DiffIssueKindSchema,
  DiffIssueSchema,
  DiffRegionSchema,
  DiffReportSchema,
  DiffSeveritySchema,
  DiffVerdictSchema,
  DomElementStyleSchema,
  FigmaAuthStateSchema,
  FigmaOAuthTokenResponseSchema,
  FigmaTokenSchema,
  FrameAlignmentSchema,
  FrameComparisonSchema,
  FrameSchema,
  GridSummaryCellSchema,
  GridSummarySchema,
  IgnoreRegionConfigEntrySchema,
  IgnoreRegionConfigFileSchema,
  IgnoreRegionSchema,
  ImageDimensionsSchema,
  ConvergenceCampaignSchema,
  ConvergenceHistorySchema,
  ConvergenceIterationSchema,
  LoopGuardReasonSchema,
  LoopGuardReportSchema,
  NodeAppearanceSchema,
  NodeEffectSchema,
  NodeFillSchema,
  NodeInspectionSchema,
  NodeLayoutSchema,
  NodeStrokeSchema,
  NodeTypographySchema,
  NormalizationReportSchema,
  ParsedDesignInputSchema,
  PreflightReportSchema,
  PreflightSeveritySchema,
  PreflightWarningCodeSchema,
  PreflightWarningSchema,
  ProjectPageSchema,
  ProjectSchema,
  RegionScoreSchema,
  ScrollCaptureReportSchema,
  TemporalVerdictSchema,
  TokenDiffReportSchema,
  TokenMismatchSchema,
  VerdictRouteSchema,
  WeightedAggregateSchema,
} from "./schema.js";
// Types derived from schemas
export { computeVerdict, selectScoringRegions, UNIMPLEMENTED_LAYOUT_SCORE } from "./type.js";
export type {
  Alignment,
  BorderRadius,
  ChildNodeSummary,
  ClusterCollapse,
  ClusterTelemetry,
  CompareDesignResult,
  ComparisonDiagnosis,
  ComparisonHeadline,
  CompletionCriteria,
  CompletionCriterion,
  CritiqueNote,
  CropRegion,
  DesignProvider,
  DesignSource,
  DesignToken,
  DiagnosisCause,
  DiagnosisCauseCode,
  DiagnosisVerdict,
  DiffBoundingBox,
  DiffEvidence,
  DiffIssue,
  DiffIssueKind,
  DiffRegion,
  DiffReport,
  DiffSeverity,
  DiffVerdict,
  DomElementStyle,
  FigmaAuthState,
  FigmaOAuthTokenResponse,
  FigmaToken,
  Frame,
  GridSummary,
  GridSummaryCell,
  IgnoreRegion,
  IgnoreRegionConfigEntry,
  IgnoreRegionConfigFile,
  ImageDimensions,
  ConvergenceCampaign,
  ConvergenceHistory,
  ConvergenceIteration,
  LoopGuardReason,
  LoopGuardReport,
  NodeAppearance,
  NodeEffect,
  NodeFill,
  NodeInspection,
  NodeLayout,
  NodeStroke,
  NodeTypography,
  NormalizationReport,
  ParsedDesignInput,
  PreflightReport,
  PreflightSeverity,
  PreflightWarning,
  PreflightWarningCode,
  Project,
  ProjectPage,
  RegionScore,
  ScrollCaptureReport,
  TokenDiffReport,
  TokenMismatch,
  VerdictRoute,
  WeightedAggregate,
} from "./type.js";

// Telemetry event allowlist (types + Zod schemas only — no SDK, no network code)
export {
  AppErrorCapturedPropertiesSchema,
  AppStartedPropertiesSchema,
  CompareDesignCompletedPropertiesSchema,
  ConsentChangedPropertiesSchema,
  McpToolInvokedPropertiesSchema,
  TELEMETRY_EVENT_NAMES,
  TelemetryEventNameSchema,
  TelemetryEventSchema,
  type AppErrorCapturedProperties,
  type AppStartedProperties,
  type CompareDesignCompletedProperties,
  type ConsentChangedProperties,
  type McpToolInvokedProperties,
  type TelemetryEvent,
  type TelemetryEventName,
} from "./telemetry-event.js";

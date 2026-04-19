// Figma Client
export {
  FigmaClient,
  NoCacheStrategy,
  extractFrames,
  extractPageFrames,
  isTokenError,
  type FigmaCacheStrategy,
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
  generateMatchSuggestion,
} from "./diff-cluster.js";

// Signal
export { computeSsim, computeSsimForRegion, type SsimRegion } from "./signal/ssim.js";

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
  parseDesignInput,
} from "./figma-url-parser.js";
export {
  AlignmentSchema,
  BorderRadiusSchema,
  ChildNodeSummarySchema,
  CompareDesignResultSchema,
  CropRegionSchema,
  DesignTokenSchema,
  DiffBoundingBoxSchema,
  DiffEvidenceSchema,
  DiffIssueKindSchema,
  DiffIssueSchema,
  DiffReportSchema,
  DiffSeveritySchema,
  DiffVerdictSchema,
  DiffRegionSchema,
  FigmaTokenSchema,
  FrameSchema,
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
  CompareDesignResult,
  DiffBoundingBox,
  DiffEvidence,
  DiffIssue,
  DiffIssueKind,
  DiffReport,
  DiffSeverity,
  DiffVerdict,
  CropRegion,
  DesignProvider,
  DesignToken,
  DiffRegion,
  FigmaToken,
  Frame,
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

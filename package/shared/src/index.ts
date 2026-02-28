// Figma Client
export {
  FigmaClient,
  NoCacheStrategy,
  extractFrames,
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

// View Mode Types
export {
  VIEW_MODES,
  VIEW_MODE_METADATA,
  type ViewMode,
  type ViewModeMetadata,
} from "./view-mode.js";

// Zod Schemas

// Figma URL parser
export { extractFileKey, extractNodeId, parseDesignInput } from "./figma-url-parser.js";
export {
  BorderRadiusSchema,
  ChildNodeSummarySchema,
  CompareDesignResultSchema,
  CropRegionSchema,
  DesignTokenSchema,
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
  ParsedDesignInputSchema,
  ProjectSchema,
} from "./schema.js";
// Types derived from schemas
export type {
  BorderRadius,
  ChildNodeSummary,
  CompareDesignResult,
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
  ParsedDesignInput,
  Project,
} from "./type.js";

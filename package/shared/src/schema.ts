// =============================================================================
// FigDiff Zod Schemas
// Runtime validation schemas for all shared types
// =============================================================================

import { z } from "zod";

// --- Frame Schema ---

export const FrameSchema = z.object({
  id: z.string(),
  name: z.string(),
  width: z.number().positive(),
  height: z.number().positive(),
});

// --- Design Token Schema ---

export const DesignTokenSchema = z.object({
  nodeId: z.string(),
  nodeName: z.string(),
  nodeType: z.string(),
  property: z.string(),
  value: z.union([z.string(), z.number()]),
  unit: z.string().optional(),
});

// --- Node Inspection Schemas ---

export const NodeLayoutSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  layoutMode: z.enum(["HORIZONTAL", "VERTICAL", "NONE"]).optional(),
  paddingTop: z.number().optional(),
  paddingRight: z.number().optional(),
  paddingBottom: z.number().optional(),
  paddingLeft: z.number().optional(),
  itemSpacing: z.number().optional(),
  primaryAxisAlign: z.string().optional(),
  counterAxisAlign: z.string().optional(),
});

export const NodeFillSchema = z.object({
  type: z.enum(["SOLID", "GRADIENT_LINEAR", "IMAGE"]),
  color: z.string().optional(),
  opacity: z.number().min(0).max(1).optional(),
});

export const NodeStrokeSchema = z.object({
  color: z.string(),
  weight: z.number().nonnegative(),
  align: z.enum(["INSIDE", "OUTSIDE", "CENTER"]),
});

export const BorderRadiusSchema = z.object({
  topLeft: z.number().nonnegative(),
  topRight: z.number().nonnegative(),
  bottomRight: z.number().nonnegative(),
  bottomLeft: z.number().nonnegative(),
});

export const NodeEffectSchema = z.object({
  type: z.enum(["DROP_SHADOW", "INNER_SHADOW", "BLUR"]),
  color: z.string().optional(),
  offset: z.object({ x: z.number(), y: z.number() }).optional(),
  radius: z.number().nonnegative(),
  spread: z.number().optional(),
});

export const NodeAppearanceSchema = z.object({
  fills: z.array(NodeFillSchema),
  strokes: z.array(NodeStrokeSchema),
  borderRadius: BorderRadiusSchema,
  opacity: z.number().min(0).max(1),
  blendMode: z.string(),
  effects: z.array(NodeEffectSchema),
});

export const NodeTypographySchema = z.object({
  fontFamily: z.string(),
  fontWeight: z.number(),
  fontSize: z.number().positive(),
  lineHeight: z.union([z.number().positive(), z.literal("AUTO")]),
  letterSpacing: z.number(),
  textAlign: z.enum(["LEFT", "CENTER", "RIGHT", "JUSTIFIED"]),
  textDecoration: z.enum(["NONE", "UNDERLINE", "STRIKETHROUGH"]),
  textContent: z.string(),
});

export const ChildNodeSummarySchema = z.object({
  nodeId: z.string(),
  nodeName: z.string(),
  nodeType: z.string(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});

export const NodeInspectionSchema = z.object({
  nodeId: z.string(),
  nodeName: z.string(),
  nodeType: z.string(),
  layout: NodeLayoutSchema,
  appearance: NodeAppearanceSchema,
  typography: NodeTypographySchema.optional(),
  cssSuggestion: z.string(),
  childrenSummary: z.array(ChildNodeSummarySchema),
});

// --- Parsed Design Input Schema ---

export const ParsedDesignInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("figma_url"),
    fileKey: z.string().min(1),
    nodeId: z.string().optional(),
  }),
  z.object({
    type: z.literal("local_path"),
    filePath: z.string().min(1),
  }),
]);

// --- Compare Design Result Schema ---

export const DiffRegionSchema = z.object({
  id: z.number().int().nonnegative(),
  bounds: z.object({
    x: z.number().nonnegative(),
    y: z.number().nonnegative(),
    width: z.number().positive(),
    height: z.number().positive(),
  }),
  diffPixelCount: z.number().int().nonnegative(),
  nearbyNodeIds: z.array(z.string()),
  nearbyNodeNames: z.array(z.string()),
});

export const CompareDesignResultSchema = z.object({
  comparisonId: z.string(),
  matchRate: z.number().min(0).max(100),
  diffPixelCount: z.number().int().nonnegative(),
  totalPixelCount: z.number().int().positive(),
  diffRegions: z.array(DiffRegionSchema),
  suggestion: z.string(),
  diffImageBase64: z.string().optional(),
});

// --- Crop Region Schema ---

export const CropRegionSchema = z.object({
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  width: z.number().positive(),
  height: z.number().positive(),
});

// --- Project Schema ---

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  figmaUrl: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// --- Figma Token Schema ---

export const FigmaTokenSchema = z
  .string()
  .min(20)
  .regex(/^figd_/, "Figma token must start with 'figd_'");

// --- Image Dimensions Schema ---

export const ImageDimensionsSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

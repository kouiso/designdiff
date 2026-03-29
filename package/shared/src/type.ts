// =============================================================================
// FigDiff Shared Types
// All types defined per document.md Section 3.4
// Types are derived from Zod schemas for runtime validation
// =============================================================================

import {
  type BorderRadiusSchema,
  type ChildNodeSummarySchema,
  type CompareDesignResultSchema,
  type CompletionCriteriaSchema,
  type CompletionCriterionSchema,
  type CropRegionSchema,
  type DesignSourceSchema,
  type DesignTokenSchema,
  type DiffRegionSchema,
  type FigmaTokenSchema,
  type FrameSchema,
  type ImageDimensionsSchema,
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
export type DiffRegion = z.infer<typeof DiffRegionSchema>;

// --- Crop Region (Phase 2+) ---

export type CropRegion = z.infer<typeof CropRegionSchema>;

// --- Project (v4: implementation URL + pages + design sources) ---

export type Project = z.infer<typeof ProjectSchema>;
export type ProjectPage = z.infer<typeof ProjectPageSchema>;
export type DesignSource = z.infer<typeof DesignSourceSchema>;

// --- Completion Criteria (v4: AI-driven PASS/FAIL) ---

export type CompletionCriterion = z.infer<typeof CompletionCriterionSchema>;
export type CompletionCriteria = z.infer<typeof CompletionCriteriaSchema>;

// --- Figma Token ---

export type FigmaToken = z.infer<typeof FigmaTokenSchema>;

// --- Image Dimensions ---

export type ImageDimensions = z.infer<typeof ImageDimensionsSchema>;

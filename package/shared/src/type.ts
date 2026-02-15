// =============================================================================
// FigDiff Shared Types
// All types defined per document.md Section 3.4
// =============================================================================

// --- Design Provider Interface ---

export interface DesignProvider {
  name: string;
  listFrames(fileUrl: string): Promise<Frame[]>;
  getFrameImage(fileUrl: string, frameId: string, scale: number): Promise<Uint8Array>;
  getDesignTokens(fileUrl: string, frameId: string, depth: number): Promise<DesignToken[]>;
  inspectNode(fileUrl: string, nodeId: string): Promise<NodeInspection>;
}

// --- Frame ---

export interface Frame {
  id: string;
  name: string;
  width: number;
  height: number;
}

// --- Design Token ---

export interface DesignToken {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  property: string;
  value: string | number;
  unit?: string;
}

// --- Node Inspection (Figma Dev Mode-like detail) ---

export interface NodeInspection {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  layout: NodeLayout;
  appearance: NodeAppearance;
  typography?: NodeTypography;
  cssSuggestion: string;
  childrenSummary: ChildNodeSummary[];
}

export interface NodeLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  layoutMode?: "HORIZONTAL" | "VERTICAL" | "NONE";
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  itemSpacing?: number;
  primaryAxisAlign?: string;
  counterAxisAlign?: string;
}

export interface NodeAppearance {
  fills: NodeFill[];
  strokes: NodeStroke[];
  borderRadius: BorderRadius;
  opacity: number;
  blendMode: string;
  effects: NodeEffect[];
}

export interface NodeFill {
  type: "SOLID" | "GRADIENT_LINEAR" | "IMAGE";
  color?: string;
  opacity?: number;
}

export interface NodeStroke {
  color: string;
  weight: number;
  align: "INSIDE" | "OUTSIDE" | "CENTER";
}

export interface BorderRadius {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
}

export interface NodeEffect {
  type: "DROP_SHADOW" | "INNER_SHADOW" | "BLUR";
  color?: string;
  offset?: { x: number; y: number };
  radius: number;
  spread?: number;
}

export interface NodeTypography {
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  lineHeight: number | "AUTO";
  letterSpacing: number;
  textAlign: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  textDecoration: "NONE" | "UNDERLINE" | "STRIKETHROUGH";
  textContent: string;
}

export interface ChildNodeSummary {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  width: number;
  height: number;
}

// --- Design Input Parsing ---

export type ParsedDesignInput =
  | { type: "figma_url"; fileKey: string; nodeId?: string }
  | { type: "local_path"; filePath: string };

// --- Compare Design Result (Phase 2+, type defined ahead) ---

export interface CompareDesignResult {
  comparisonId: string;
  matchRate: number;
  diffPixelCount: number;
  totalPixelCount: number;
  diffRegions: DiffRegion[];
  suggestion: string;
  diffImageBase64?: string;
}

export interface DiffRegion {
  id: number;
  bounds: { x: number; y: number; width: number; height: number };
  diffPixelCount: number;
  nearbyNodeIds: string[];
  nearbyNodeNames: string[];
}

// --- Crop Region (Phase 2+) ---

export interface CropRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

// --- Project ---

export interface Project {
  id: string;
  name: string;
  figmaUrl?: string;
  createdAt: string;
  updatedAt: string;
}

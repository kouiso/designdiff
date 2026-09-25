/**
 * Figma Node Transformer
 * Converts raw FigmaNode API data to NodeInspection format
 * Bridges FigmaNode → NodeInspection with CSS suggestions
 */

import {
  figmaColorToHex,
  generateCssSuggestion,
  type FigmaNode,
  type NodeInspection,
  type NodeAppearance,
  type NodeLayout,
  type NodeTypography,
  type NodeFill,
  type NodeStroke,
  type NodeEffect,
  type ChildNodeSummary,
} from "@figdiff/shared";

export { extractDesignTokens } from "@figdiff/shared";

/**
 * Transform a FigmaNode into NodeInspection with CSS suggestions
 */
export function transformNodeToInspection(node: FigmaNode): NodeInspection {
  const layout = extractLayout(node);
  const appearance = extractAppearance(node);
  const typography = extractTypography(node);
  const childrenSummary = extractChildrenSummary(node);

  const cssSuggestion = generateCssSuggestion(layout, appearance, typography);

  return {
    nodeId: node.id,
    nodeName: node.name,
    nodeType: node.type,
    visible: node.visible !== false,
    layout,
    appearance,
    typography,
    cssSuggestion,
    childrenSummary,
  };
}

function extractLayout(node: FigmaNode): NodeLayout {
  const bbox = node.absoluteBoundingBox;
  return {
    x: bbox?.x ?? 0,
    y: bbox?.y ?? 0,
    width: bbox?.width ?? 0,
    height: bbox?.height ?? 0,
    layoutMode: normalizeLayoutMode(node.layoutMode),
    paddingTop: node.paddingTop,
    paddingRight: node.paddingRight,
    paddingBottom: node.paddingBottom,
    paddingLeft: node.paddingLeft,
    itemSpacing: node.itemSpacing,
    primaryAxisAlign: node.primaryAxisAlignItems,
    counterAxisAlign: node.counterAxisAlignItems,
  };
}

function normalizeLayoutMode(
  mode: string | undefined,
): "HORIZONTAL" | "VERTICAL" | "NONE" | undefined {
  if (!mode) return undefined;
  if (mode === "HORIZONTAL" || mode === "VERTICAL") return mode;
  return "NONE";
}

function extractAppearance(node: FigmaNode): NodeAppearance {
  const fills: NodeFill[] = (node.fills || [])
    .filter((f) => f.visible !== false)
    .map((f) => ({
      type: normalizeFillType(f.type),
      color: f.color ? colorWithPaintOpacity(f.color, f.opacity) : undefined,
      opacity: f.type.startsWith("GRADIENT_") ? undefined : f.opacity,
      gradientStops: f.gradientStops?.map((stop) => ({
        position: stop.position,
        color: figmaColorToHex(
          stop.color.r,
          stop.color.g,
          stop.color.b,
          stop.color.a * (f.opacity ?? 1),
        ),
      })),
    }));

  const strokes: NodeStroke[] = (node.strokes || [])
    .filter((s) => s.visible !== false && s.color)
    .map((s) => ({
      color: s.color ? colorWithPaintOpacity(s.color, s.opacity) : "#000000",
      weight: node.strokeWeight ?? 1,
      align: "CENTER" as const,
    }));

  const cornerRadii = node.rectangleCornerRadii;
  const borderRadius = {
    topLeft: cornerRadii?.[0] ?? node.cornerRadius ?? 0,
    topRight: cornerRadii?.[1] ?? node.cornerRadius ?? 0,
    bottomRight: cornerRadii?.[2] ?? node.cornerRadius ?? 0,
    bottomLeft: cornerRadii?.[3] ?? node.cornerRadius ?? 0,
  };

  const effects: NodeEffect[] = (node.effects || [])
    .filter((e) => e.visible !== false)
    .map((e) => ({
      type: normalizeEffectType(e.type),
      color: e.color ? figmaColorToHex(e.color.r, e.color.g, e.color.b, e.color.a) : undefined,
      offset: e.offset ? { x: e.offset.x, y: e.offset.y } : undefined,
      radius: e.radius ?? 0,
      spread: e.spread,
    }));

  return {
    fills,
    strokes,
    borderRadius,
    opacity: node.opacity ?? 1,
    blendMode: "NORMAL",
    effects,
  };
}

const KNOWN_FILL_TYPES: readonly NodeFill["type"][] = [
  "SOLID",
  "GRADIENT_LINEAR",
  "GRADIENT_RADIAL",
  "GRADIENT_ANGULAR",
  "GRADIENT_DIAMOND",
  "IMAGE",
];

function isKnownFillType(type: string): type is NodeFill["type"] {
  return KNOWN_FILL_TYPES.some((t) => t === type);
}

function normalizeFillType(type: string): NodeFill["type"] {
  // Figma API未知のグラデーション型はGRADIENT_LINEARにフォールバック
  return isKnownFillType(type) ? type : "GRADIENT_LINEAR";
}

const colorWithPaintOpacity = (
  color: { r: number; g: number; b: number; a: number },
  opacity?: number,
): string => {
  return figmaColorToHex(color.r, color.g, color.b, color.a * (opacity ?? 1));
};

const KNOWN_EFFECT_TYPES: readonly NodeEffect["type"][] = [
  "DROP_SHADOW",
  "INNER_SHADOW",
  "LAYER_BLUR",
  "BACKGROUND_BLUR",
];

function isKnownEffectType(type: string): type is NodeEffect["type"] {
  return KNOWN_EFFECT_TYPES.some((t) => t === type);
}

function normalizeEffectType(type: string): NodeEffect["type"] {
  // Figma API未知のエフェクト型はLAYER_BLURにフォールバック
  return isKnownEffectType(type) ? type : "LAYER_BLUR";
}

function extractTypography(node: FigmaNode): NodeTypography | undefined {
  if (node.type !== "TEXT" || !node.style) return undefined;

  const s = node.style;
  return {
    fontFamily: s.fontFamily ?? "sans-serif",
    fontWeight: s.fontWeight ?? 400,
    fontSize: s.fontSize ?? 16,
    lineHeight: s.lineHeightPx ?? "AUTO",
    letterSpacing: s.letterSpacing ?? 0,
    textAlign: normalizeTextAlign(s.textAlignHorizontal),
    textDecoration: "NONE",
    textContent: node.characters ?? "",
  };
}

function normalizeTextAlign(align?: string): "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED" {
  if (align === "CENTER") return "CENTER";
  if (align === "RIGHT") return "RIGHT";
  if (align === "JUSTIFIED") return "JUSTIFIED";
  return "LEFT";
}

function extractChildrenSummary(node: FigmaNode): ChildNodeSummary[] {
  if (!node.children) return [];

  return node.children.map((child) => ({
    nodeId: child.id,
    nodeName: child.name,
    nodeType: child.type,
    visible: child.visible !== false,
    width: child.absoluteBoundingBox?.width ?? 0,
    height: child.absoluteBoundingBox?.height ?? 0,
  }));
}

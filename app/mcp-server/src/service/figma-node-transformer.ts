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
  type DesignToken,
} from "@figdiff/shared";

const roundPx = (n: number): number => Math.round(n * 100) / 100;

const BBOX_TOKEN_NODE_TYPES = new Set([
  "FRAME",
  "GROUP",
  "INSTANCE",
  "COMPONENT",
  "RECTANGLE",
  "TEXT",
]);

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
      color: f.color ? figmaColorToHex(f.color.r, f.color.g, f.color.b, f.color.a) : undefined,
      opacity: f.opacity,
    }));

  const strokes: NodeStroke[] = (node.strokes || [])
    .filter((s) => s.visible !== false)
    .map((s) => ({
      color: s.color ? figmaColorToHex(s.color.r, s.color.g, s.color.b, s.color.a) : "#000000",
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
    width: child.absoluteBoundingBox?.width ?? 0,
    height: child.absoluteBoundingBox?.height ?? 0,
  }));
}

/**
 * Extract design tokens from a FigmaNode tree
 * Recursively traverses the node tree up to the specified depth
 */
export function extractDesignTokens(node: FigmaNode, depth: number): DesignToken[] {
  const tokens: DesignToken[] = [];
  collectTokens(node, tokens, depth, 0);
  return tokens;
}

function pushToken(
  tokens: DesignToken[],
  node: FigmaNode,
  property: string,
  value: string | number,
  unit?: string,
): void {
  tokens.push({
    nodeId: node.id,
    nodeName: node.name,
    nodeType: node.type,
    property,
    value: typeof value === "number" ? roundPx(value) : value,
    unit,
  });
}

function pushTokenIfDefined(
  tokens: DesignToken[],
  node: FigmaNode,
  property: string,
  value: number | undefined,
  unit?: string,
): void {
  if (value !== undefined) {
    pushToken(tokens, node, property, value, unit);
  }
}

function collectTypographyTokens(node: FigmaNode, tokens: DesignToken[]): void {
  if (node.type !== "TEXT" || !node.style) return;

  const s = node.style;
  if (s.fontSize) pushToken(tokens, node, "fontSize", s.fontSize, "px");
  if (s.fontFamily) pushToken(tokens, node, "fontFamily", s.fontFamily);
  if (s.fontWeight) pushToken(tokens, node, "fontWeight", s.fontWeight);
  if (s.lineHeightPx) pushToken(tokens, node, "lineHeight", s.lineHeightPx, "px");
  if (s.letterSpacing !== undefined)
    pushToken(tokens, node, "letterSpacing", s.letterSpacing, "px");
  if (s.textAlignHorizontal)
    pushToken(tokens, node, "textAlign", normalizeTextAlign(s.textAlignHorizontal));
}

function colorWithPaintOpacity(
  color: { r: number; g: number; b: number; a: number },
  opacity?: number,
): string {
  return figmaColorToHex(color.r, color.g, color.b, color.a * (opacity ?? 1));
}

function collectFillTokens(node: FigmaNode, tokens: DesignToken[]): void {
  for (const fill of node.fills || []) {
    if (fill.visible === false) continue;

    if (fill.type === "SOLID" && fill.color) {
      const fillProperty = node.type === "TEXT" ? "color" : "backgroundColor";
      pushToken(tokens, node, fillProperty, colorWithPaintOpacity(fill.color, fill.opacity));
      continue;
    }

    if (fill.type.startsWith("GRADIENT_")) {
      pushToken(tokens, node, "backgroundImage", fill.type);
      for (const [index, stop] of (fill.gradientStops || []).entries()) {
        pushToken(
          tokens,
          node,
          `gradientStop${index}Color`,
          figmaColorToHex(stop.color.r, stop.color.g, stop.color.b, stop.color.a),
        );
        pushToken(tokens, node, `gradientStop${index}Position`, stop.position);
      }
    }
  }
}

function collectStrokeTokens(node: FigmaNode, tokens: DesignToken[]): void {
  for (const stroke of node.strokes || []) {
    if (stroke.visible === false || !stroke.color) continue;
    pushToken(tokens, node, "borderColor", colorWithPaintOpacity(stroke.color, stroke.opacity));
    pushToken(tokens, node, "borderWidth", node.strokeWeight ?? 1, "px");
  }
}

function collectEffectTokens(node: FigmaNode, tokens: DesignToken[]): void {
  for (const effect of node.effects || []) {
    if (effect.visible === false) continue;
    pushToken(tokens, node, "boxShadowType", effect.type);
    if (effect.color)
      pushToken(
        tokens,
        node,
        "boxShadowColor",
        figmaColorToHex(effect.color.r, effect.color.g, effect.color.b, effect.color.a),
      );
    if (effect.offset) {
      pushToken(tokens, node, "boxShadowOffsetX", effect.offset.x, "px");
      pushToken(tokens, node, "boxShadowOffsetY", effect.offset.y, "px");
    }
    pushTokenIfDefined(tokens, node, "boxShadowRadius", effect.radius, "px");
    pushTokenIfDefined(tokens, node, "boxShadowSpread", effect.spread, "px");
  }
}

function collectBorderRadiusTokens(node: FigmaNode, tokens: DesignToken[]): void {
  if (node.rectangleCornerRadii) {
    const [topLeft, topRight, bottomRight, bottomLeft] = node.rectangleCornerRadii;
    pushToken(tokens, node, "borderTopLeftRadius", topLeft, "px");
    pushToken(tokens, node, "borderTopRightRadius", topRight, "px");
    pushToken(tokens, node, "borderBottomRightRadius", bottomRight, "px");
    pushToken(tokens, node, "borderBottomLeftRadius", bottomLeft, "px");
    return;
  }

  pushTokenIfDefined(tokens, node, "borderRadius", node.cornerRadius, "px");
}

function collectTokens(
  node: FigmaNode,
  tokens: DesignToken[],
  maxDepth: number,
  currentDepth: number,
): void {
  const bbox = node.absoluteBoundingBox;

  if (bbox && BBOX_TOKEN_NODE_TYPES.has(node.type) && bbox.width > 0 && bbox.height > 0) {
    pushToken(tokens, node, "width", bbox.width, "px");
    pushToken(tokens, node, "height", bbox.height, "px");
  }

  pushTokenIfDefined(tokens, node, "paddingTop", node.paddingTop, "px");
  pushTokenIfDefined(tokens, node, "paddingRight", node.paddingRight, "px");
  pushTokenIfDefined(tokens, node, "paddingBottom", node.paddingBottom, "px");
  pushTokenIfDefined(tokens, node, "paddingLeft", node.paddingLeft, "px");
  pushTokenIfDefined(tokens, node, "gap", node.itemSpacing, "px");
  collectBorderRadiusTokens(node, tokens);
  collectFillTokens(node, tokens);
  collectStrokeTokens(node, tokens);
  collectEffectTokens(node, tokens);

  if (node.opacity !== undefined && node.opacity < 1)
    pushToken(tokens, node, "opacity", node.opacity);

  collectTypographyTokens(node, tokens);

  if (currentDepth < maxDepth && node.children) {
    for (const child of node.children) {
      collectTokens(child, tokens, maxDepth, currentDepth + 1);
    }
  }
}

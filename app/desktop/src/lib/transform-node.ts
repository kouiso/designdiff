/**
 * FigmaNode → NodeInspection 変換
 * electron/util/transform-node.ts と同一ロジック
 * Web Adapter から利用するために src/lib に配置
 */
import {
  type FigmaNode,
  type FigmaColor,
  figmaColorToHex,
  generateCssSuggestion,
  type NodeInspection,
  type NodeLayout,
  type NodeAppearance,
  type NodeTypography,
  type ChildNodeSummary,
  type NodeFill,
  type NodeStroke,
  type NodeEffect,
  type BorderRadius,
} from "@figdiff/shared";

const extractBorderRadius = (node: FigmaNode): BorderRadius => {
  if (node.rectangleCornerRadii) {
    const [tl, tr, br, bl] = node.rectangleCornerRadii;
    return { topLeft: tl, topRight: tr, bottomRight: br, bottomLeft: bl };
  }
  if (node.cornerRadius !== undefined) {
    const r = node.cornerRadius;
    return { topLeft: r, topRight: r, bottomRight: r, bottomLeft: r };
  }
  return { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 };
};

const colorToHex = (color: FigmaColor | undefined): string | undefined => {
  if (!color) return undefined;
  return figmaColorToHex(color.r, color.g, color.b, color.a);
};

const KNOWN_FILL_TYPES: readonly NodeFill["type"][] = [
  "SOLID",
  "GRADIENT_LINEAR",
  "GRADIENT_RADIAL",
  "GRADIENT_ANGULAR",
  "GRADIENT_DIAMOND",
  "IMAGE",
];

const isKnownFillType = (type: string): type is NodeFill["type"] =>
  KNOWN_FILL_TYPES.some((t) => t === type);

const KNOWN_EFFECT_TYPES: readonly NodeEffect["type"][] = [
  "DROP_SHADOW",
  "INNER_SHADOW",
  "LAYER_BLUR",
  "BACKGROUND_BLUR",
];

const isKnownEffectType = (type: string): type is NodeEffect["type"] =>
  KNOWN_EFFECT_TYPES.some((t) => t === type);

const extractFills = (node: FigmaNode): NodeFill[] => {
  return (node.fills ?? [])
    .filter((f) => f.visible !== false)
    .map((f) => {
      const fillType: NodeFill["type"] = isKnownFillType(f.type) ? f.type : "GRADIENT_LINEAR";
      return {
        type: fillType,
        color: colorToHex(f.color),
        opacity: f.opacity ?? 1.0,
      } satisfies NodeFill;
    });
};

const extractStrokes = (node: FigmaNode): NodeStroke[] => {
  return (node.strokes ?? [])
    .filter((s) => s.visible !== false)
    .map((s) => ({
      color: colorToHex(s.color) ?? "#000000",
      weight: node.strokeWeight ?? 0,
      align: "CENTER" as const,
    }));
};

const extractEffects = (node: FigmaNode): NodeEffect[] => {
  return (node.effects ?? [])
    .filter((e) => e.visible !== false)
    .map((e) => {
      const effectType: NodeEffect["type"] = isKnownEffectType(e.type) ? e.type : "LAYER_BLUR";
      return {
        type: effectType,
        radius: e.radius ?? 0,
        color: colorToHex(e.color),
        offset: e.offset ? { x: e.offset.x, y: e.offset.y } : undefined,
        spread: e.spread,
      } satisfies NodeEffect;
    });
};

const extractTypography = (node: FigmaNode): NodeTypography | undefined => {
  const style = node.style;
  if (!style) return undefined;

  return {
    fontFamily: style.fontFamily ?? "",
    fontSize: style.fontSize ?? 0,
    fontWeight: style.fontWeight ?? 400,
    lineHeight: style.lineHeightPx ?? "AUTO",
    letterSpacing: style.letterSpacing ?? 0,
    textAlign: "LEFT",
    textDecoration: "NONE",
    textContent: node.characters ?? "",
  };
};

export const transformNode = (node: FigmaNode): NodeInspection => {
  const bbox = node.absoluteBoundingBox;

  const layout: NodeLayout = {
    x: bbox?.x ?? 0,
    y: bbox?.y ?? 0,
    width: bbox?.width ?? 0,
    height: bbox?.height ?? 0,
    layoutMode:
      node.layoutMode === "HORIZONTAL"
        ? "HORIZONTAL"
        : node.layoutMode === "VERTICAL"
          ? "VERTICAL"
          : undefined,
    paddingTop: node.paddingTop,
    paddingRight: node.paddingRight,
    paddingBottom: node.paddingBottom,
    paddingLeft: node.paddingLeft,
    itemSpacing: node.itemSpacing,
    primaryAxisAlign: node.primaryAxisAlignItems,
    counterAxisAlign: node.counterAxisAlignItems,
  };

  const appearance: NodeAppearance = {
    fills: extractFills(node),
    strokes: extractStrokes(node),
    borderRadius: extractBorderRadius(node),
    opacity: node.opacity ?? 1.0,
    blendMode: "NORMAL",
    effects: extractEffects(node),
  };

  const typography = extractTypography(node);

  const childrenSummary: ChildNodeSummary[] = (node.children ?? []).map((c) => ({
    nodeId: c.id,
    nodeName: c.name,
    nodeType: c.type,
    width: c.absoluteBoundingBox?.width ?? 0,
    height: c.absoluteBoundingBox?.height ?? 0,
  }));

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
};

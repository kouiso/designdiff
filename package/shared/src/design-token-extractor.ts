import { figmaColorToHex } from "./css-suggestion.js";

import type { FigmaNode } from "./figma-client.js";
import type { DesignToken } from "./type.js";

const roundPx = (value: number): number => Math.round(value * 100) / 100;

const BBOX_TOKEN_NODE_TYPES = new Set([
  "FRAME",
  "GROUP",
  "INSTANCE",
  "COMPONENT",
  "RECTANGLE",
  "TEXT",
]);

const pushToken = (
  tokens: DesignToken[],
  node: FigmaNode,
  property: string,
  value: string | number,
  unit?: string,
): void => {
  tokens.push({
    nodeId: node.id,
    nodeName: node.name,
    nodeType: node.type,
    property,
    value: typeof value === "number" ? roundPx(value) : value,
    unit,
  });
};

const pushTokenIfDefined = (
  tokens: DesignToken[],
  node: FigmaNode,
  property: string,
  value: number | undefined,
  unit?: string,
): void => {
  if (value !== undefined) pushToken(tokens, node, property, value, unit);
};

const normalizeTextAlign = (align?: string): "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED" => {
  if (align === "CENTER") return "CENTER";
  if (align === "RIGHT") return "RIGHT";
  if (align === "JUSTIFIED") return "JUSTIFIED";
  return "LEFT";
};

const collectTypographyTokens = (node: FigmaNode, tokens: DesignToken[]): void => {
  if (node.type !== "TEXT" || !node.style) return;

  const style = node.style;
  if (style.fontSize) pushToken(tokens, node, "fontSize", style.fontSize, "px");
  if (style.fontFamily) pushToken(tokens, node, "fontFamily", style.fontFamily);
  if (style.fontWeight) pushToken(tokens, node, "fontWeight", style.fontWeight);
  if (style.lineHeightPx) pushToken(tokens, node, "lineHeight", style.lineHeightPx, "px");
  if (style.letterSpacing !== undefined)
    pushToken(tokens, node, "letterSpacing", style.letterSpacing, "px");
  if (style.textAlignHorizontal)
    pushToken(tokens, node, "textAlign", normalizeTextAlign(style.textAlignHorizontal));
};

const colorWithPaintOpacity = (
  color: { r: number; g: number; b: number; a: number },
  opacity?: number,
): string => figmaColorToHex(color.r, color.g, color.b, color.a * (opacity ?? 1));

const collectGradientStopTokens = (
  node: FigmaNode,
  tokens: DesignToken[],
  fill: NonNullable<FigmaNode["fills"]>[number],
  stopPrefix: (index: number) => string,
): void => {
  for (const [stopIndex, stop] of (fill.gradientStops ?? []).entries()) {
    const prefix = stopPrefix(stopIndex);
    pushToken(
      tokens,
      node,
      `${prefix}Color`,
      figmaColorToHex(stop.color.r, stop.color.g, stop.color.b, stop.color.a * (fill.opacity ?? 1)),
    );
    pushToken(tokens, node, `${prefix}Position`, stop.position * 100, "%");
  }
};

const collectFillTokens = (node: FigmaNode, tokens: DesignToken[]): void => {
  const visibleFills = (node.fills ?? []).filter((fill) => fill.visible !== false);
  const hasMultipleFills = visibleFills.length > 1;

  for (const [fillIndex, fill] of visibleFills.entries()) {
    const fillPrefix = hasMultipleFills ? `fill${fillIndex}` : "";

    if (fill.type === "SOLID" && fill.color) {
      const fillProperty = node.type === "TEXT" ? "color" : "backgroundColor";
      pushToken(
        tokens,
        node,
        hasMultipleFills ? `${fillPrefix}Color` : fillProperty,
        colorWithPaintOpacity(fill.color, fill.opacity),
      );
      continue;
    }

    if (!fill.type.startsWith("GRADIENT_")) continue;

    pushToken(
      tokens,
      node,
      hasMultipleFills ? `${fillPrefix}BackgroundImage` : "backgroundImage",
      fill.type,
    );
    collectGradientStopTokens(node, tokens, fill, (stopIndex) =>
      hasMultipleFills ? `${fillPrefix}GradientStop${stopIndex}` : `gradientStop${stopIndex}`,
    );
  }
};

const collectStrokeTokens = (node: FigmaNode, tokens: DesignToken[]): void => {
  const visibleStrokes = (node.strokes ?? []).filter(
    (stroke) => stroke.visible !== false && stroke.color,
  );
  const hasMultipleStrokes = visibleStrokes.length > 1;

  for (const [index, stroke] of visibleStrokes.entries()) {
    if (!stroke.color) continue;
    pushToken(
      tokens,
      node,
      hasMultipleStrokes ? `stroke${index}Color` : "borderColor",
      colorWithPaintOpacity(stroke.color, stroke.opacity),
    );
  }

  if (visibleStrokes.length > 0) {
    pushToken(tokens, node, "borderWidth", node.strokeWeight ?? 1, "px");
  }
};

const collectEffectTokens = (node: FigmaNode, tokens: DesignToken[]): void => {
  const visibleEffects = (node.effects ?? []).filter((effect) => effect.visible !== false);
  const hasMultipleEffects = visibleEffects.length > 1;

  for (const [index, effect] of visibleEffects.entries()) {
    const effectPrefix = hasMultipleEffects ? `effect${index}` : "";

    if (effect.type === "LAYER_BLUR") {
      pushTokenIfDefined(
        tokens,
        node,
        hasMultipleEffects ? `${effectPrefix}BlurRadius` : "blurRadius",
        effect.radius,
        "px",
      );
      continue;
    }

    if (effect.type === "BACKGROUND_BLUR") {
      pushTokenIfDefined(
        tokens,
        node,
        hasMultipleEffects ? `${effectPrefix}BackdropBlurRadius` : "backdropBlurRadius",
        effect.radius,
        "px",
      );
      continue;
    }

    if (effect.type !== "DROP_SHADOW" && effect.type !== "INNER_SHADOW") continue;

    const shadowPrefix = hasMultipleEffects ? `${effectPrefix}BoxShadow` : "boxShadow";
    pushToken(tokens, node, `${shadowPrefix}Type`, effect.type);
    if (effect.type === "INNER_SHADOW") pushToken(tokens, node, `${shadowPrefix}Inset`, "inset");
    if (effect.color)
      pushToken(
        tokens,
        node,
        `${shadowPrefix}Color`,
        figmaColorToHex(effect.color.r, effect.color.g, effect.color.b, effect.color.a),
      );
    if (effect.offset) {
      pushToken(tokens, node, `${shadowPrefix}OffsetX`, effect.offset.x, "px");
      pushToken(tokens, node, `${shadowPrefix}OffsetY`, effect.offset.y, "px");
    }
    pushTokenIfDefined(tokens, node, `${shadowPrefix}Radius`, effect.radius, "px");
    pushTokenIfDefined(tokens, node, `${shadowPrefix}Spread`, effect.spread, "px");
  }
};

const collectBorderRadiusTokens = (node: FigmaNode, tokens: DesignToken[]): void => {
  if (node.rectangleCornerRadii) {
    const [topLeft, topRight, bottomRight, bottomLeft] = node.rectangleCornerRadii;
    pushToken(tokens, node, "borderTopLeftRadius", topLeft, "px");
    pushToken(tokens, node, "borderTopRightRadius", topRight, "px");
    pushToken(tokens, node, "borderBottomRightRadius", bottomRight, "px");
    pushToken(tokens, node, "borderBottomLeftRadius", bottomLeft, "px");
    return;
  }

  pushTokenIfDefined(tokens, node, "borderRadius", node.cornerRadius, "px");
};

const collectTokens = (
  node: FigmaNode,
  tokens: DesignToken[],
  maxDepth: number,
  currentDepth: number,
): void => {
  if (node.visible === false) return;

  const boundingBox = node.absoluteBoundingBox;
  if (
    boundingBox &&
    BBOX_TOKEN_NODE_TYPES.has(node.type) &&
    boundingBox.width > 0 &&
    boundingBox.height > 0
  ) {
    pushToken(tokens, node, "width", boundingBox.width, "px");
    pushToken(tokens, node, "height", boundingBox.height, "px");
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
    for (const child of node.children) collectTokens(child, tokens, maxDepth, currentDepth + 1);
  }
};

/** MCP とデスクトップで同じ Figma ノード値を表示するため、抽出規則を共有する。 */
export const extractDesignTokens = (node: FigmaNode, depth: number): DesignToken[] => {
  const tokens: DesignToken[] = [];
  collectTokens(node, tokens, depth, 0);
  return tokens;
};

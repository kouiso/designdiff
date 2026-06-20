/**
 * CSS Suggestion Generator
 * Generates CSS strings from NodeInspection data
 * Translated from Rust transform.rs generate_css_suggestion()
 */

import type { NodeAppearance, NodeLayout, NodeTypography } from "./type.js";

function figmaPrimaryAxisToJustify(value: string | undefined): string | undefined {
  switch (value) {
    case "MIN":
      return "flex-start";
    case "MAX":
      return "flex-end";
    case "CENTER":
      return "center";
    case "SPACE_BETWEEN":
      return "space-between";
    default:
      return undefined;
  }
}

function figmaCounterAxisToAlign(value: string | undefined): string | undefined {
  switch (value) {
    case "MIN":
      return "flex-start";
    case "MAX":
      return "flex-end";
    case "CENTER":
      return "center";
    case "BASELINE":
      return "baseline";
    default:
      return undefined;
  }
}

function applyOpacityToHex(color: string, opacity: number | undefined): string {
  if (opacity === undefined || opacity >= 1 || !color.startsWith("#")) return color;

  const alphaHex = color.length === 9 ? color.slice(7, 9) : "FF";
  const alpha = Number.parseInt(alphaHex, 16) / 255;
  return `${color.slice(0, 7)}${Math.round(alpha * opacity * 255)
    .toString(16)
    .padStart(2, "0")}`.toUpperCase();
}

function gradientFunction(type: string): string {
  return type === "GRADIENT_RADIAL" ? "radial-gradient" : "linear-gradient";
}

function formatGradient(fill: NonNullable<NodeAppearance["fills"]>[number]): string | undefined {
  if (!fill.type.startsWith("GRADIENT_") || !fill.gradientStops?.length) return undefined;

  const stops = fill.gradientStops.map(
    (stop) => `${stop.color} ${(stop.position * 100).toFixed(1)}%`,
  );
  return `${gradientFunction(fill.type)}(${stops.join(", ")})`;
}

function appendLayoutCss(parts: string[], layout: NodeLayout): void {
  parts.push(`width: ${layout.width.toFixed(1)}px;`);
  parts.push(`height: ${layout.height.toFixed(1)}px;`);

  if (layout.layoutMode) {
    switch (layout.layoutMode) {
      case "HORIZONTAL":
        parts.push("display: flex; flex-direction: row;");
        break;
      case "VERTICAL":
        parts.push("display: flex; flex-direction: column;");
        break;
    }

    if (layout.layoutMode === "HORIZONTAL" || layout.layoutMode === "VERTICAL") {
      const justifyContent = figmaPrimaryAxisToJustify(layout.primaryAxisAlign);
      const alignItems = figmaCounterAxisToAlign(layout.counterAxisAlign);
      if (justifyContent && layout.primaryAxisAlign !== "MIN") {
        parts.push(`justify-content: ${justifyContent};`);
      }
      if (alignItems) {
        parts.push(`align-items: ${alignItems};`);
      }
    }
  }

  const pt = layout.paddingTop;
  const pr = layout.paddingRight;
  const pb = layout.paddingBottom;
  const pl = layout.paddingLeft;
  if (pt !== undefined && pr !== undefined && pb !== undefined && pl !== undefined) {
    const allEqual =
      Math.abs(pt - pr) < 0.01 && Math.abs(pr - pb) < 0.01 && Math.abs(pb - pl) < 0.01;

    if (allEqual) {
      parts.push(`padding: ${pt.toFixed(1)}px;`);
    } else {
      parts.push(
        `padding: ${pt.toFixed(1)}px ${pr.toFixed(1)}px ${pb.toFixed(1)}px ${pl.toFixed(1)}px;`,
      );
    }
  }

  if (layout.itemSpacing !== undefined && layout.itemSpacing > 0) {
    parts.push(`gap: ${layout.itemSpacing.toFixed(1)}px;`);
  }
}

function appendAppearanceCss(
  parts: string[],
  appearance: NodeAppearance,
  isTextNode: boolean,
): void {
  if (appearance.fills && appearance.fills.length > 0) {
    const fill = appearance.fills[0];
    const gradient = formatGradient(fill);
    if (gradient) {
      parts.push(`background-image: ${gradient};`);
    } else if (fill.color) {
      parts.push(
        `${isTextNode ? "color" : "background-color"}: ${applyOpacityToHex(fill.color, fill.opacity)};`,
      );
    }
  }

  if (appearance.strokes && appearance.strokes.length > 0) {
    const stroke = appearance.strokes[0];
    if (stroke.color) {
      const weight = stroke.weight || 1;
      parts.push(`border: ${weight.toFixed(1)}px solid ${stroke.color};`);
    }
  }

  appendBorderRadiusCss(parts, appearance);
  appendEffectsCss(parts, appearance);

  if (Math.abs(appearance.opacity - 1.0) > 0.01) {
    parts.push(`opacity: ${appearance.opacity.toFixed(2)};`);
  }
}

function appendBorderRadiusCss(parts: string[], appearance: NodeAppearance): void {
  if (!appearance.borderRadius) return;

  const br = appearance.borderRadius;
  if (br.topLeft === 0 && br.topRight === 0 && br.bottomRight === 0 && br.bottomLeft === 0) {
    return;
  }
  const allEqual =
    Math.abs(br.topLeft - br.topRight) < 0.01 &&
    Math.abs(br.topRight - br.bottomRight) < 0.01 &&
    Math.abs(br.bottomRight - br.bottomLeft) < 0.01;

  if (allEqual) {
    parts.push(`border-radius: ${br.topLeft.toFixed(1)}px;`);
  } else {
    parts.push(
      `border-radius: ${br.topLeft.toFixed(1)}px ${br.topRight.toFixed(1)}px ${br.bottomRight.toFixed(1)}px ${br.bottomLeft.toFixed(1)}px;`,
    );
  }
}

function appendEffectsCss(parts: string[], appearance: NodeAppearance): void {
  if (!appearance.effects) return;

  for (const effect of appearance.effects) {
    if (effect.type === "DROP_SHADOW") {
      const offsetX = effect.offset?.x ?? 0;
      const offsetY = effect.offset?.y ?? 0;
      const radius = effect.radius || 0;
      const spread = effect.spread || 0;
      const color = effect.color || "rgba(0,0,0,0.25)";
      parts.push(
        `box-shadow: ${offsetX.toFixed(1)}px ${offsetY.toFixed(1)}px ${radius.toFixed(1)}px ${spread.toFixed(1)}px ${color};`,
      );
    }
  }
}

function appendTypographyCss(parts: string[], typography: NodeTypography): void {
  parts.push(`font-family: "${typography.fontFamily}";`);
  parts.push(`font-size: ${typography.fontSize.toFixed(1)}px;`);
  parts.push(`font-weight: ${typography.fontWeight.toFixed(0)};`);

  if (typography.lineHeight !== undefined && typography.lineHeight !== "AUTO") {
    parts.push(`line-height: ${typography.lineHeight.toFixed(1)}px;`);
  }

  if (typography.letterSpacing !== undefined && Math.abs(typography.letterSpacing) > 0.01) {
    parts.push(`letter-spacing: ${typography.letterSpacing.toFixed(1)}px;`);
  }

  if (typography.textAlign) {
    parts.push(`text-align: ${typography.textAlign.toLowerCase()};`);
  }
}

export function generateCssSuggestion(
  layout: NodeLayout,
  appearance: NodeAppearance,
  typography: NodeTypography | undefined,
): string {
  const parts: string[] = [];

  appendLayoutCss(parts, layout);
  appendAppearanceCss(parts, appearance, typography !== undefined);
  if (typography) {
    appendTypographyCss(parts, typography);
  }

  return parts.join(" ");
}

/**
 * Helper: Convert Figma RGBA color to hex string
 * Figma colors are normalized 0-1, we convert to 0-255
 */
export function figmaColorToHex(r: number, g: number, b: number, a?: number): string {
  const r8 = Math.round(r * 255);
  const g8 = Math.round(g * 255);
  const b8 = Math.round(b * 255);

  if (a === undefined || Math.abs(a - 1.0) < 0.001) {
    return `#${r8.toString(16).padStart(2, "0")}${g8.toString(16).padStart(2, "0")}${b8.toString(16).padStart(2, "0")}`.toUpperCase();
  } else {
    const a8 = Math.round(a * 255);
    return `#${r8.toString(16).padStart(2, "0")}${g8.toString(16).padStart(2, "0")}${b8.toString(16).padStart(2, "0")}${a8.toString(16).padStart(2, "0")}`.toUpperCase();
  }
}

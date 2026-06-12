import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const parseLightThemeColors = () => {
  const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
  const match = css.match(/:root \{([\s\S]*?)\}/);
  if (!match) throw new Error("Light theme block not found");

  return Object.fromEntries(
    [...match[1].matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map(([, name, value]) => [
      name,
      value,
    ]),
  );
};

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5]
    .map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrastRatio = (foreground: string, background: string) => {
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);

  return (lighter + 0.05) / (darker + 0.05);
};

const mix = (foreground: string, background: string, alpha: number) => {
  const channels = [1, 3, 5].map((index) => {
    const foregroundValue = Number.parseInt(foreground.slice(index, index + 2), 16);
    const backgroundValue = Number.parseInt(background.slice(index, index + 2), 16);
    return Math.round(foregroundValue * alpha + backgroundValue * (1 - alpha));
  });

  return `#${channels.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
};

describe("light theme contrast", () => {
  it.each([
    ["fg", "bg"],
    ["muted-fg", "bg"],
    ["muted-fg", "muted"],
    ["primary", "bg"],
    ["primary-fg", "primary"],
    ["accent-fg", "accent"],
    ["destructive", "bg"],
    ["destructive-fg", "destructive"],
    ["success", "bg"],
    ["success-fg", "success"],
  ])("%s on %s meets WCAG AA contrast for normal text", (foreground, background) => {
    const colors = parseLightThemeColors();

    expect(contrastRatio(colors[foreground], colors[background])).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ["primary", "primary", 0.15],
    ["primary", "primary", 0.2],
    ["success", "success", 0.15],
    ["success", "success", 0.2],
    ["destructive", "destructive", 0.1],
    ["muted-fg", "muted", 0.5],
    ["accent-fg", "accent", 0.3],
    ["accent-fg", "accent", 0.5],
  ])("%s on %s/%d alpha over background meets WCAG AA contrast for normal text", (foreground, background, alpha) => {
    const colors = parseLightThemeColors();
    const effectiveBackground = mix(colors[background], colors.bg, alpha);

    expect(contrastRatio(colors[foreground], effectiveBackground)).toBeGreaterThanOrEqual(4.5);
  });
});

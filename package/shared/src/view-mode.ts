/**
 * View Mode Types and Constants
 * Shared across Desktop App, MCP Server, and Figma Plugin
 */

/**
 * 7 comparison view modes (document.md Section 4.2)
 * Pixelay-equivalent (1-6) + FigDiff-unique (7)
 */
export type ViewMode =
  | "design_only"
  | "implementation"
  | "transparent_overlay"
  | "split_screen"
  | "blended_diff"
  | "draggable_overlay"
  | "pixel_diff";

export const VIEW_MODES: readonly ViewMode[] = [
  "design_only",
  "implementation",
  "transparent_overlay",
  "split_screen",
  "blended_diff",
  "draggable_overlay",
  "pixel_diff",
];

/**
 * View Mode metadata for UI display
 */
export interface ViewModeMetadata {
  id: ViewMode;
  label: string;
  icon: string;
  pixelayEquivalent: string | null;
  requiresOpacitySlider: boolean;
  i18nKey: string;
}

export const VIEW_MODE_METADATA: Record<ViewMode, ViewModeMetadata> = {
  design_only: {
    id: "design_only",
    label: "Design Only",
    icon: "🎨",
    pixelayEquivalent: "Original Design",
    requiresOpacitySlider: false,
    i18nKey: "viewMode.designOnly",
  },
  implementation: {
    id: "implementation",
    label: "Implementation",
    icon: "</>",
    pixelayEquivalent: "Website Build",
    requiresOpacitySlider: false,
    i18nKey: "viewMode.implementation",
  },
  transparent_overlay: {
    id: "transparent_overlay",
    label: "Transparent Overlay",
    icon: "🔲",
    pixelayEquivalent: "Transparent Overlay",
    requiresOpacitySlider: true,
    i18nKey: "viewMode.transparentOverlay",
  },
  split_screen: {
    id: "split_screen",
    label: "Split Screen",
    icon: "◧",
    pixelayEquivalent: "Split Screen",
    requiresOpacitySlider: false,
    i18nKey: "viewMode.splitScreen",
  },
  blended_diff: {
    id: "blended_diff",
    label: "Blended Diff",
    icon: "◐",
    pixelayEquivalent: "Blended Diff",
    requiresOpacitySlider: false,
    i18nKey: "viewMode.blendedDiff",
  },
  draggable_overlay: {
    id: "draggable_overlay",
    label: "Draggable Overlay",
    icon: "✥",
    pixelayEquivalent: "Draggable Overlay",
    requiresOpacitySlider: false,
    i18nKey: "viewMode.draggableOverlay",
  },
  pixel_diff: {
    id: "pixel_diff",
    label: "Pixel Diff ★",
    icon: "🔴",
    pixelayEquivalent: null,
    requiresOpacitySlider: false,
    i18nKey: "viewMode.pixelDiff",
  },
};

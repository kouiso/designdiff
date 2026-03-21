/**
 * FigDiff Figma Plugin — Sandbox Code
 * Runs in Figma's main thread with access to the Figma API
 *
 * Commands:
 * - compare: Open comparison UI with screenshot upload
 * - export-frame: Export selected frame as PNG
 * - inspect: Show Dev Mode-like inspection of selected node
 */

// Plugin command handler
figma.showUI(__html__, { width: 360, height: 480, themeColors: true });

type PluginMessage =
  | { type: "get-selection" }
  | { type: "export-frame"; nodeId?: string }
  | { type: "inspect-node"; nodeId?: string }
  | { type: "compare-images"; designBase64: string; screenshotBase64: string }
  | { type: "resize"; width: number; height: number }
  | { type: "close" };

figma.ui.onmessage = async (msg: PluginMessage) => {
  switch (msg.type) {
    case "get-selection":
      await handleGetSelection();
      break;
    case "export-frame":
      await handleExportFrame(msg.nodeId);
      break;
    case "inspect-node":
      await handleInspectNode(msg.nodeId);
      break;
    case "compare-images":
      await handleCompareImages(msg.designBase64, msg.screenshotBase64);
      break;
    case "resize":
      figma.ui.resize(msg.width, msg.height);
      break;
    case "close":
      figma.closePlugin();
      break;
  }
};

// Send initial selection info when plugin opens
handleGetSelection();

/**
 * Get current selection info and send to UI
 */
async function handleGetSelection(): Promise<void> {
  const selection = figma.currentPage.selection;

  if (selection.length === 0) {
    figma.ui.postMessage({ type: "selection", nodes: [] });
    return;
  }

  const nodes = selection.map((node) => ({
    id: node.id,
    name: node.name,
    type: node.type,
    width: "width" in node ? node.width : 0,
    height: "height" in node ? node.height : 0,
  }));

  figma.ui.postMessage({ type: "selection", nodes });
}

/**
 * Export selected frame as PNG base64
 */
export function isSceneNode(node: BaseNode): node is SceneNode {
  return node.type !== "DOCUMENT" && node.type !== "PAGE";
}

export function toSceneNode(node: BaseNode | null): SceneNode | null {
  if (node === null) return null;
  if (!isSceneNode(node)) return null;
  return node;
}

async function handleExportFrame(nodeId?: string): Promise<void> {
  let node: SceneNode | null = null;

  if (nodeId) {
    node = toSceneNode(figma.getNodeById(nodeId));
  } else if (figma.currentPage.selection.length > 0) {
    node = figma.currentPage.selection[0];
  }

  if (!node) {
    figma.ui.postMessage({ type: "export-result", error: "No node selected" });
    return;
  }

  try {
    const bytes = await node.exportAsync({
      format: "PNG",
      constraint: { type: "SCALE", value: 2 },
    });

    const base64 = figma.base64Encode(bytes);

    figma.ui.postMessage({
      type: "export-result",
      base64,
      nodeId: node.id,
      nodeName: node.name,
      width: "width" in node ? node.width : 0,
      height: "height" in node ? node.height : 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    figma.ui.postMessage({
      type: "export-result",
      error: `Export failed: ${message}`,
    });
  }
}

/**
 * Inspect selected node and return Dev Mode-like properties
 */
async function handleInspectNode(nodeId?: string): Promise<void> {
  let node: SceneNode | null = null;

  if (nodeId) {
    node = toSceneNode(figma.getNodeById(nodeId));
  } else if (figma.currentPage.selection.length > 0) {
    node = figma.currentPage.selection[0];
  }

  if (!node) {
    figma.ui.postMessage({ type: "inspect-result", error: "No node selected" });
    return;
  }

  const inspection = extractNodeInspection(node);
  figma.ui.postMessage({ type: "inspect-result", inspection });
}

/**
 * Compare two images using pixelmatch (delegated to UI iframe for Canvas access)
 */
async function handleCompareImages(designBase64: string, screenshotBase64: string): Promise<void> {
  // pixelmatch runs in UI iframe since it needs Canvas API
  // Just forward the request back
  figma.ui.postMessage({
    type: "run-comparison",
    designBase64,
    screenshotBase64,
  });
}

// --- Node Inspection Helpers ---

interface InspectionResult {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  layout: Record<string, unknown>;
  appearance: Record<string, unknown>;
  typography?: Record<string, unknown>;
  cssSuggestion: string;
  children: { id: string; name: string; type: string; width: number; height: number }[];
}

export function extractNodeInspection(node: SceneNode): InspectionResult {
  const layout = extractLayoutFromNode(node);
  const appearance = extractAppearanceFromNode(node);
  const typography = node.type === "TEXT" ? extractTypographyFromNode(node) : undefined;
  const cssSuggestion = buildCssSuggestion(layout, appearance, typography);
  const children = extractChildren(node);

  return {
    nodeId: node.id,
    nodeName: node.name,
    nodeType: node.type,
    layout,
    appearance,
    typography,
    cssSuggestion,
    children,
  };
}

export function extractLayoutFromNode(node: SceneNode): Record<string, unknown> {
  const layout: Record<string, unknown> = {
    x: node.x,
    y: node.y,
    width: "width" in node ? node.width : 0,
    height: "height" in node ? node.height : 0,
  };

  if ("layoutMode" in node && node.layoutMode !== "NONE") {
    layout.layoutMode = node.layoutMode;
    layout.paddingTop = "paddingTop" in node ? node.paddingTop : 0;
    layout.paddingRight = "paddingRight" in node ? node.paddingRight : 0;
    layout.paddingBottom = "paddingBottom" in node ? node.paddingBottom : 0;
    layout.paddingLeft = "paddingLeft" in node ? node.paddingLeft : 0;
    layout.itemSpacing = "itemSpacing" in node ? node.itemSpacing : 0;
    layout.primaryAxisAlignItems =
      "primaryAxisAlignItems" in node ? node.primaryAxisAlignItems : undefined;
    layout.counterAxisAlignItems =
      "counterAxisAlignItems" in node ? node.counterAxisAlignItems : undefined;
  }

  return layout;
}

export function extractAppearanceFromNode(node: SceneNode): Record<string, unknown> {
  const appearance: Record<string, unknown> = {
    opacity: "opacity" in node ? node.opacity : 1,
  };

  if ("fills" in node && node.fills !== figma.mixed) {
    appearance.fills = node.fills
      .filter((f) => f.visible !== false)
      .map((f) => {
        if (f.type === "SOLID") {
          return {
            type: "SOLID",
            color: rgbToHex(f.color.r, f.color.g, f.color.b),
            opacity: f.opacity,
          };
        }
        return { type: f.type };
      });
  }

  if ("strokes" in node) {
    appearance.strokes = node.strokes
      .filter((s) => s.visible !== false)
      .map((s) => {
        if (s.type === "SOLID") {
          return {
            type: "SOLID",
            color: rgbToHex(s.color.r, s.color.g, s.color.b),
            weight: "strokeWeight" in node ? node.strokeWeight : 1,
          };
        }
        return { type: s.type };
      });
  }

  if ("cornerRadius" in node && typeof node.cornerRadius === "number") {
    appearance.borderRadius = node.cornerRadius;
  }

  if ("effects" in node) {
    appearance.effects = node.effects
      .filter((e) => e.visible !== false)
      .map((e) => ({
        type: e.type,
        radius: "radius" in e ? e.radius : 0,
      }));
  }

  return appearance;
}

export function extractTypographyFromNode(textNode: SceneNode): Record<string, unknown> {
  if (textNode.type !== "TEXT") return {};
  return {
    fontFamily: typeof textNode.fontName !== "symbol" ? textNode.fontName.family : "Mixed",
    fontSize: typeof textNode.fontSize !== "symbol" ? textNode.fontSize : 0,
    fontWeight: typeof textNode.fontName !== "symbol" ? textNode.fontName.style : "Regular",
    lineHeight:
      typeof textNode.lineHeight !== "symbol" && textNode.lineHeight.unit !== "AUTO"
        ? textNode.lineHeight.value
        : "AUTO",
    letterSpacing: typeof textNode.letterSpacing !== "symbol" ? textNode.letterSpacing.value : 0,
    textAlignHorizontal: textNode.textAlignHorizontal,
    textContent: textNode.characters,
  };
}

export function buildCssSuggestion(
  layout: Record<string, unknown>,
  appearance: Record<string, unknown>,
  typography: Record<string, unknown> | undefined,
): string {
  const cssParts: string[] = [];
  cssParts.push(`width: ${layout.width}px;`);
  cssParts.push(`height: ${layout.height}px;`);

  if (layout.layoutMode === "HORIZONTAL") cssParts.push("display: flex; flex-direction: row;");
  if (layout.layoutMode === "VERTICAL") cssParts.push("display: flex; flex-direction: column;");

  if (layout.paddingTop !== undefined) {
    cssParts.push(
      `padding: ${layout.paddingTop}px ${layout.paddingRight}px ${layout.paddingBottom}px ${layout.paddingLeft}px;`,
    );
  }
  if (layout.itemSpacing) cssParts.push(`gap: ${layout.itemSpacing}px;`);

  const fillsValue = appearance.fills;
  const fills =
    Array.isArray(fillsValue) &&
    fillsValue.every(
      (f): f is { type: string; color?: string } =>
        typeof f === "object" && f !== null && "type" in f,
    )
      ? fillsValue
      : undefined;
  if (fills && fills.length > 0 && fills[0].color) {
    cssParts.push(`background-color: ${fills[0].color};`);
  }
  if (appearance.borderRadius) cssParts.push(`border-radius: ${appearance.borderRadius}px;`);

  if (typography) {
    cssParts.push(`font-family: "${typography.fontFamily}";`);
    cssParts.push(`font-size: ${typography.fontSize}px;`);
  }

  return cssParts.join(" ");
}

export function hasChildren(
  node: SceneNode,
): node is SceneNode & { children: readonly SceneNode[] } {
  return "children" in node && Array.isArray(node.children);
}

export function extractChildren(
  node: SceneNode,
): { id: string; name: string; type: string; width: number; height: number }[] {
  const children: { id: string; name: string; type: string; width: number; height: number }[] = [];
  if (hasChildren(node)) {
    for (const child of node.children) {
      children.push({
        id: child.id,
        name: child.name,
        type: child.type,
        width: "width" in child ? child.width : 0,
        height: "height" in child ? child.height : 0,
      });
    }
  }
  return children;
}

export function rgbToHex(r: number, g: number, b: number): string {
  const r8 = Math.round(r * 255);
  const g8 = Math.round(g * 255);
  const b8 = Math.round(b * 255);
  return `#${r8.toString(16).padStart(2, "0")}${g8.toString(16).padStart(2, "0")}${b8.toString(16).padStart(2, "0")}`.toUpperCase();
}

// Listen for selection changes
figma.on("selectionchange", () => {
  handleGetSelection();
});

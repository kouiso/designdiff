import { describe, it, expect } from "vitest";

import type { FigmaNode } from "@figdiff/shared";

import { transformNodeToInspection, extractDesignTokens } from "./figma-node-transformer.js";

const makeNode = (overrides: Partial<FigmaNode> = {}): FigmaNode => ({
  id: "node-1",
  name: "TestNode",
  type: "FRAME",
  absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 200 },
  fills: [],
  strokes: [],
  effects: [],
  children: [],
  ...overrides,
});

describe("transformNodeToInspection", () => {
  describe("basic node transformation", () => {
    it("maps nodeId, nodeName, and nodeType from raw node", () => {
      // Arrange
      const node = makeNode({ id: "abc-123", name: "MyFrame", type: "FRAME" });

      // Act
      const result = transformNodeToInspection(node);

      // Assert
      expect(result.nodeId).toBe("abc-123");
      expect(result.nodeName).toBe("MyFrame");
      expect(result.nodeType).toBe("FRAME");
    });

    it("extracts bounding box into layout", () => {
      const node = makeNode({
        absoluteBoundingBox: { x: 10, y: 20, width: 300, height: 400 },
      });

      const result = transformNodeToInspection(node);

      expect(result.layout.x).toBe(10);
      expect(result.layout.y).toBe(20);
      expect(result.layout.width).toBe(300);
      expect(result.layout.height).toBe(400);
    });

    it("defaults layout coordinates to 0 when absoluteBoundingBox is absent", () => {
      const node = makeNode({ absoluteBoundingBox: undefined });

      const result = transformNodeToInspection(node);

      expect(result.layout.x).toBe(0);
      expect(result.layout.y).toBe(0);
      expect(result.layout.width).toBe(0);
      expect(result.layout.height).toBe(0);
    });

    it("maps HORIZONTAL layoutMode correctly", () => {
      const node = makeNode({ layoutMode: "HORIZONTAL" });

      const result = transformNodeToInspection(node);

      expect(result.layout.layoutMode).toBe("HORIZONTAL");
    });

    it("maps VERTICAL layoutMode correctly", () => {
      const node = makeNode({ layoutMode: "VERTICAL" });

      const result = transformNodeToInspection(node);

      expect(result.layout.layoutMode).toBe("VERTICAL");
    });

    it("returns undefined layoutMode when layoutMode is absent", () => {
      const node = makeNode({ layoutMode: undefined });

      const result = transformNodeToInspection(node);

      expect(result.layout.layoutMode).toBeUndefined();
    });
  });

  describe("TEXT node transformation", () => {
    it("extracts typography from a TEXT node", () => {
      const node = makeNode({
        type: "TEXT",
        characters: "Hello World",
        style: {
          fontFamily: "Inter",
          fontWeight: 700,
          fontSize: 24,
          lineHeightPx: 32,
          letterSpacing: 0.5,
          textAlignHorizontal: "CENTER",
        },
      });

      const result = transformNodeToInspection(node);

      expect(result.typography).not.toBeNull();
      expect(result.typography?.fontFamily).toBe("Inter");
      expect(result.typography?.fontWeight).toBe(700);
      expect(result.typography?.fontSize).toBe(24);
      expect(result.typography?.lineHeight).toBe(32);
      expect(result.typography?.textAlign).toBe("CENTER");
      expect(result.typography?.textContent).toBe("Hello World");
    });

    it("defaults typography fields when style properties are absent", () => {
      const node = makeNode({
        type: "TEXT",
        style: {},
      });

      const result = transformNodeToInspection(node);

      expect(result.typography?.fontFamily).toBe("sans-serif");
      expect(result.typography?.fontWeight).toBe(400);
      expect(result.typography?.fontSize).toBe(16);
    });

    it("returns nullish typography for non-TEXT nodes", () => {
      const node = makeNode({ type: "RECTANGLE" });

      const result = transformNodeToInspection(node);

      // implementation returns undefined (not null) for non-TEXT nodes
      expect(result.typography).toBeFalsy();
    });
  });

  describe("fill and stroke style extraction", () => {
    it("extracts solid fills with hex color", () => {
      const node = makeNode({
        fills: [
          {
            type: "SOLID",
            visible: true,
            color: { r: 1, g: 0, b: 0, a: 1 },
          },
        ],
      });

      const result = transformNodeToInspection(node);

      expect(result.appearance.fills).toHaveLength(1);
      expect(result.appearance.fills[0].type).toBe("SOLID");
      // figmaColorToHex outputs uppercase hex; alpha=1.0 is omitted per implementation
      expect(result.appearance.fills[0].color).toBe("#FF0000");
    });

    it("filters out invisible fills", () => {
      const node = makeNode({
        fills: [{ type: "SOLID", visible: false, color: { r: 0, g: 0, b: 0, a: 1 } }],
      });

      const result = transformNodeToInspection(node);

      expect(result.appearance.fills).toHaveLength(0);
    });

    it("extracts stroke with weight", () => {
      const node = makeNode({
        strokes: [{ type: "SOLID", visible: true, color: { r: 0, g: 0, b: 1, a: 1 } }],
        strokeWeight: 2,
      });

      const result = transformNodeToInspection(node);

      expect(result.appearance.strokes).toHaveLength(1);
      expect(result.appearance.strokes[0].weight).toBe(2);
      // figmaColorToHex outputs uppercase hex; alpha=1.0 is omitted per implementation
      expect(result.appearance.strokes[0].color).toBe("#0000FF");
    });

    it("handles empty fills and strokes safely", () => {
      const node = makeNode({ fills: [], strokes: [] });

      const result = transformNodeToInspection(node);

      expect(result.appearance.fills).toEqual([]);
      expect(result.appearance.strokes).toEqual([]);
    });
  });

  describe("nested children transformation", () => {
    it("extracts child node summaries", () => {
      const node = makeNode({
        children: [
          {
            id: "child-1",
            name: "ChildFrame",
            type: "FRAME",
            absoluteBoundingBox: { x: 0, y: 0, width: 50, height: 50 },
            fills: [],
            strokes: [],
            effects: [],
            children: [],
          },
        ],
      });

      const result = transformNodeToInspection(node);

      expect(result.childrenSummary).toHaveLength(1);
      expect(result.childrenSummary[0].nodeId).toBe("child-1");
      expect(result.childrenSummary[0].nodeName).toBe("ChildFrame");
      expect(result.childrenSummary[0].width).toBe(50);
      expect(result.childrenSummary[0].height).toBe(50);
    });

    it("returns empty childrenSummary when children is absent", () => {
      const node = makeNode({ children: undefined });

      const result = transformNodeToInspection(node);

      expect(result.childrenSummary).toEqual([]);
    });
  });

  describe("border radius extraction", () => {
    it("uses cornerRadius as uniform value when rectangleCornerRadii is absent", () => {
      const node = makeNode({ cornerRadius: 8 });

      const result = transformNodeToInspection(node);

      expect(result.appearance.borderRadius.topLeft).toBe(8);
      expect(result.appearance.borderRadius.topRight).toBe(8);
      expect(result.appearance.borderRadius.bottomRight).toBe(8);
      expect(result.appearance.borderRadius.bottomLeft).toBe(8);
    });

    it("uses rectangleCornerRadii for per-corner values", () => {
      const node = makeNode({ rectangleCornerRadii: [4, 8, 12, 16] });

      const result = transformNodeToInspection(node);

      expect(result.appearance.borderRadius.topLeft).toBe(4);
      expect(result.appearance.borderRadius.topRight).toBe(8);
      expect(result.appearance.borderRadius.bottomRight).toBe(12);
      expect(result.appearance.borderRadius.bottomLeft).toBe(16);
    });
  });
});

describe("extractDesignTokens", () => {
  it("extracts width and height tokens from bounding box", () => {
    const node = makeNode({
      absoluteBoundingBox: { x: 0, y: 0, width: 320, height: 480 },
    });

    const tokens = extractDesignTokens(node, 1);

    const widthToken = tokens.find((t) => t.property === "width");
    const heightToken = tokens.find((t) => t.property === "height");

    expect(widthToken?.value).toBe(320);
    expect(widthToken?.unit).toBe("px");
    expect(heightToken?.value).toBe(480);
  });

  it("extracts padding tokens when defined", () => {
    const node = makeNode({
      paddingTop: 8,
      paddingRight: 16,
      paddingBottom: 8,
      paddingLeft: 16,
    });

    const tokens = extractDesignTokens(node, 1);

    expect(tokens.find((t) => t.property === "paddingTop")?.value).toBe(8);
    expect(tokens.find((t) => t.property === "paddingRight")?.value).toBe(16);
    expect(tokens.find((t) => t.property === "paddingBottom")?.value).toBe(8);
    expect(tokens.find((t) => t.property === "paddingLeft")?.value).toBe(16);
  });

  it("extracts typography tokens from TEXT nodes", () => {
    const node = makeNode({
      type: "TEXT",
      style: {
        fontSize: 18,
        fontFamily: "Roboto",
        fontWeight: 600,
        lineHeightPx: 28,
      },
    });

    const tokens = extractDesignTokens(node, 1);

    expect(tokens.find((t) => t.property === "fontSize")?.value).toBe(18);
    expect(tokens.find((t) => t.property === "fontFamily")?.value).toBe("Roboto");
    expect(tokens.find((t) => t.property === "fontWeight")?.value).toBe(600);
    expect(tokens.find((t) => t.property === "lineHeight")?.value).toBe(28);
  });

  it("maps solid fill tokens to color for TEXT and backgroundColor for non-TEXT nodes", () => {
    const textNode = makeNode({
      id: "text",
      name: "Label",
      type: "TEXT",
      fills: [{ type: "SOLID", visible: true, color: { r: 0, g: 0.2, b: 1, a: 1 } }],
    });
    const frameNode = makeNode({
      id: "frame",
      name: "Panel",
      type: "FRAME",
      fills: [{ type: "SOLID", visible: true, color: { r: 1, g: 1, b: 1, a: 1 } }],
    });

    const textTokens = extractDesignTokens(textNode, 1);
    const frameTokens = extractDesignTokens(frameNode, 1);

    expect(textTokens).toContainEqual(
      expect.objectContaining({ nodeId: "text", property: "color", value: "#0033FF" }),
    );
    expect(textTokens.some((t) => t.property === "backgroundColor")).toBe(false);
    expect(frameTokens).toContainEqual(
      expect.objectContaining({ nodeId: "frame", property: "backgroundColor", value: "#FFFFFF" }),
    );
  });

  it("does not extract tokens beyond specified depth", () => {
    const deepChild: FigmaNode = {
      id: "deep",
      name: "DeepNode",
      type: "RECTANGLE",
      absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
      fills: [],
      strokes: [],
      effects: [],
      children: [],
    };
    const child: FigmaNode = {
      id: "child",
      name: "Child",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 50, height: 50 },
      fills: [],
      strokes: [],
      effects: [],
      children: [deepChild],
    };
    const root = makeNode({ children: [child] });

    const tokensDepth1 = extractDesignTokens(root, 1);
    const nodeIds = tokensDepth1.map((t) => t.nodeId);

    expect(nodeIds).not.toContain("deep");
  });
});

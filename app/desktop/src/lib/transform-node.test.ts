import { describe, expect, it, vi } from "vitest";

import type { FigmaNode } from "@figdiff/shared";

import { transformNode } from "./transform-node";

vi.mock("@figdiff/shared", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    generateCssSuggestion: vi.fn().mockReturnValue("mocked-css"),
  };
});

const createMinimalNode = (overrides: Partial<FigmaNode> = {}): FigmaNode => ({
  id: "1:1",
  name: "TestNode",
  type: "FRAME",
  children: [],
  fills: [],
  strokes: [],
  effects: [],
  ...overrides,
});

describe("transformNode", () => {
  describe("layout", () => {
    it("absoluteBoundingBox ありの場合、x/y/width/height に反映される", () => {
      const node = createMinimalNode({
        absoluteBoundingBox: { x: 10, y: 20, width: 300, height: 400 },
      });
      const result = transformNode(node);
      expect(result.layout.x).toBe(10);
      expect(result.layout.y).toBe(20);
      expect(result.layout.width).toBe(300);
      expect(result.layout.height).toBe(400);
    });

    it("absoluteBoundingBox なしの場合、全座標0", () => {
      const node = createMinimalNode();
      const result = transformNode(node);
      expect(result.layout.x).toBe(0);
      expect(result.layout.y).toBe(0);
      expect(result.layout.width).toBe(0);
      expect(result.layout.height).toBe(0);
    });

    it("layoutMode HORIZONTAL が変換される", () => {
      const node = createMinimalNode({ layoutMode: "HORIZONTAL" });
      const result = transformNode(node);
      expect(result.layout.layoutMode).toBe("HORIZONTAL");
    });

    it("layoutMode VERTICAL が変換される", () => {
      const node = createMinimalNode({ layoutMode: "VERTICAL" });
      const result = transformNode(node);
      expect(result.layout.layoutMode).toBe("VERTICAL");
    });

    it("layoutMode undefined の場合 undefined", () => {
      const node = createMinimalNode();
      const result = transformNode(node);
      expect(result.layout.layoutMode).toBeUndefined();
    });

    it("padding/itemSpacing が反映される", () => {
      const node = createMinimalNode({
        paddingTop: 8,
        paddingRight: 16,
        paddingBottom: 8,
        paddingLeft: 16,
        itemSpacing: 12,
      });
      const result = transformNode(node);
      expect(result.layout.paddingTop).toBe(8);
      expect(result.layout.paddingRight).toBe(16);
      expect(result.layout.paddingBottom).toBe(8);
      expect(result.layout.paddingLeft).toBe(16);
      expect(result.layout.itemSpacing).toBe(12);
    });
  });

  describe("appearance.borderRadius", () => {
    it("rectangleCornerRadii [4,8,12,16] で各値が正しく設定される", () => {
      const node = createMinimalNode({
        rectangleCornerRadii: [4, 8, 12, 16],
      });
      const result = transformNode(node);
      expect(result.appearance.borderRadius).toEqual({
        topLeft: 4,
        topRight: 8,
        bottomRight: 12,
        bottomLeft: 16,
      });
    });

    it("cornerRadius のみの場合、4角同一値", () => {
      const node = createMinimalNode({ cornerRadius: 10 });
      const result = transformNode(node);
      expect(result.appearance.borderRadius).toEqual({
        topLeft: 10,
        topRight: 10,
        bottomRight: 10,
        bottomLeft: 10,
      });
    });

    it("両方なしの場合、全0", () => {
      const node = createMinimalNode();
      const result = transformNode(node);
      expect(result.appearance.borderRadius).toEqual({
        topLeft: 0,
        topRight: 0,
        bottomRight: 0,
        bottomLeft: 0,
      });
    });
  });

  describe("appearance.fills", () => {
    it("visible=false の fill は除外される", () => {
      const node = createMinimalNode({
        fills: [
          { type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 }, visible: true },
          { type: "SOLID", color: { r: 0, g: 1, b: 0, a: 1 }, visible: false },
        ],
      });
      const result = transformNode(node);
      expect(result.appearance.fills).toHaveLength(1);
    });

    it("SOLID fill の color が hex 変換される", () => {
      const node = createMinimalNode({
        fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
      });
      const result = transformNode(node);
      expect(result.appearance.fills[0].type).toBe("SOLID");
      expect(result.appearance.fills[0].color).toMatch(/^#FF0000/);
    });

    it("GRADIENT_LINEAR が正しく変換される", () => {
      const node = createMinimalNode({
        fills: [{ type: "GRADIENT_LINEAR" }],
      });
      const result = transformNode(node);
      expect(result.appearance.fills[0].type).toBe("GRADIENT_LINEAR");
    });

    it("fills が undefined の場合、空配列", () => {
      const node = createMinimalNode();
      const result = transformNode(node);
      expect(result.appearance.fills).toEqual([]);
    });
  });

  describe("appearance.strokes", () => {
    it("visible=false 除外 + strokeWeight 反映", () => {
      const node = createMinimalNode({
        strokes: [
          { type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 }, visible: true },
          { type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 }, visible: false },
        ],
        strokeWeight: 2,
      });
      const result = transformNode(node);
      expect(result.appearance.strokes).toHaveLength(1);
      expect(result.appearance.strokes[0].weight).toBe(2);
      expect(result.appearance.strokes[0].align).toBe("CENTER");
    });
  });

  describe("appearance.effects", () => {
    it("DROP_SHADOW の offset/radius/color が反映される", () => {
      const node = createMinimalNode({
        effects: [
          {
            type: "DROP_SHADOW",
            radius: 4,
            color: { r: 0, g: 0, b: 0, a: 0.25 },
            offset: { x: 0, y: 4 },
          },
        ],
      });
      const result = transformNode(node);
      expect(result.appearance.effects[0].type).toBe("DROP_SHADOW");
      expect(result.appearance.effects[0].radius).toBe(4);
      expect(result.appearance.effects[0].offset).toEqual({ x: 0, y: 4 });
    });

    it("INNER_SHADOW が正しく変換される", () => {
      const node = createMinimalNode({
        effects: [{ type: "INNER_SHADOW", radius: 2 }],
      });
      const result = transformNode(node);
      expect(result.appearance.effects[0].type).toBe("INNER_SHADOW");
    });

    it("LAYER_BLUR が BLUR に正規化される", () => {
      const node = createMinimalNode({
        effects: [{ type: "LAYER_BLUR", radius: 8 }],
      });
      const result = transformNode(node);
      expect(result.appearance.effects[0].type).toBe("BLUR");
      expect(result.appearance.effects[0].radius).toBe(8);
    });
  });

  describe("typography", () => {
    it("style ありの場合、fontFamily/fontSize/fontWeight が変換される", () => {
      const node = createMinimalNode({
        style: {
          fontFamily: "Inter",
          fontSize: 16,
          fontWeight: 700,
          lineHeightPx: 24,
          letterSpacing: 0.5,
        },
        characters: "Hello",
      });
      const result = transformNode(node);
      expect(result.typography).toEqual({
        fontFamily: "Inter",
        fontSize: 16,
        fontWeight: 700,
        lineHeight: 24,
        letterSpacing: 0.5,
        textAlign: "LEFT",
        textDecoration: "NONE",
        textContent: "Hello",
      });
    });

    it("style なしの場合 undefined", () => {
      const node = createMinimalNode();
      const result = transformNode(node);
      expect(result.typography).toBeUndefined();
    });
  });

  describe("childrenSummary", () => {
    it("children ありの場合、nodeId/nodeName/nodeType/width/height が含まれる", () => {
      const node = createMinimalNode({
        children: [
          createMinimalNode({
            id: "2:1",
            name: "Child",
            type: "TEXT",
            absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 50 },
          }),
        ],
      });
      const result = transformNode(node);
      expect(result.childrenSummary).toHaveLength(1);
      expect(result.childrenSummary[0]).toEqual({
        nodeId: "2:1",
        nodeName: "Child",
        nodeType: "TEXT",
        width: 100,
        height: 50,
      });
    });
  });

  describe("top-level fields", () => {
    it("nodeId/nodeName/nodeType/cssSuggestion が含まれる", () => {
      const node = createMinimalNode({ id: "3:1", name: "MyFrame", type: "FRAME" });
      const result = transformNode(node);
      expect(result.nodeId).toBe("3:1");
      expect(result.nodeName).toBe("MyFrame");
      expect(result.nodeType).toBe("FRAME");
      expect(result.cssSuggestion).toBe("mocked-css");
    });
  });
});

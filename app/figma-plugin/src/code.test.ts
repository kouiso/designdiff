import { describe, it, expect } from "vitest";

import type { NodeAppearance, NodeLayout, NodeTypography } from "@figdiff/shared";

import {
  rgbToHex,
  buildCssSuggestion,
  isSceneNode,
  toSceneNode,
  hasChildren,
  extractChildren,
  extractLayoutFromNode,
  extractAppearanceFromNode,
  extractTypographyFromNode,
  extractNodeInspection,
} from "./code";

function makeLayout(overrides: Partial<NodeLayout> = {}): NodeLayout {
  return {
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    ...overrides,
  };
}

function makeAppearance(overrides: Partial<NodeAppearance> = {}): NodeAppearance {
  return {
    fills: [],
    strokes: [],
    borderRadius: {
      topLeft: 0,
      topRight: 0,
      bottomRight: 0,
      bottomLeft: 0,
    },
    opacity: 1,
    blendMode: "NORMAL",
    effects: [],
    ...overrides,
  };
}

function makeTypography(overrides: Partial<NodeTypography> = {}): NodeTypography {
  return {
    fontFamily: "Inter",
    fontWeight: 400,
    fontSize: 16,
    lineHeight: "AUTO",
    letterSpacing: 0,
    textAlign: "LEFT",
    textDecoration: "NONE",
    textContent: "",
    ...overrides,
  };
}

describe("rgbToHex", () => {
  it("(0,0,0) → #000000", () => {
    expect(rgbToHex(0, 0, 0)).toBe("#000000");
  });

  it("(1,1,1) → #FFFFFF", () => {
    expect(rgbToHex(1, 1, 1)).toBe("#FFFFFF");
  });

  it("(0.5,0,0) → #800000", () => {
    expect(rgbToHex(0.5, 0, 0)).toBe("#800000");
  });

  it("(1, 0, 0) → #FF0000", () => {
    expect(rgbToHex(1, 0, 0)).toBe("#FF0000");
  });

  it("小数点の丸め: Math.round(127.5)=128 → 80", () => {
    const result = rgbToHex(0.5, 0.5, 0.5);
    expect(result).toBe("#808080");
  });
});

describe("buildCssSuggestion", () => {
  it("layout only → width/height を含む", () => {
    const result = buildCssSuggestion(
      makeLayout({ width: 200, height: 100 }),
      makeAppearance(),
      undefined,
    );
    expect(result).toContain("width: 200.0px;");
    expect(result).toContain("height: 100.0px;");
  });

  it("HORIZONTAL layout → flex-direction: row を含む", () => {
    const result = buildCssSuggestion(
      makeLayout({ width: 200, height: 100, layoutMode: "HORIZONTAL" }),
      makeAppearance(),
      undefined,
    );
    expect(result).toContain("flex-direction: row");
  });

  it("VERTICAL layout → flex-direction: column を含む", () => {
    const result = buildCssSuggestion(
      makeLayout({ width: 200, height: 100, layoutMode: "VERTICAL" }),
      makeAppearance(),
      undefined,
    );
    expect(result).toContain("flex-direction: column");
  });

  it("padding あり → padding CSS を含む", () => {
    const result = buildCssSuggestion(
      makeLayout({
        width: 200,
        height: 100,
        paddingTop: 10,
        paddingRight: 20,
        paddingBottom: 10,
        paddingLeft: 20,
      }),
      makeAppearance(),
      undefined,
    );
    expect(result).toContain("padding: 10.0px 20.0px 10.0px 20.0px;");
  });

  it("itemSpacing あり → gap CSS を含む", () => {
    const result = buildCssSuggestion(
      makeLayout({ width: 200, height: 100, itemSpacing: 8 }),
      makeAppearance(),
      undefined,
    );
    expect(result).toContain("gap: 8.0px;");
  });

  it("fills あり → background-color を含む", () => {
    const appearance = makeAppearance({ fills: [{ type: "SOLID", color: "#FF0000" }] });
    const result = buildCssSuggestion(makeLayout(), appearance, undefined);
    expect(result).toContain("background-color: #FF0000;");
  });

  it("borderRadius あり → border-radius を含む", () => {
    const appearance = makeAppearance({
      borderRadius: { topLeft: 8, topRight: 8, bottomRight: 8, bottomLeft: 8 },
    });
    const result = buildCssSuggestion(makeLayout(), appearance, undefined);
    expect(result).toContain("border-radius: 8.0px;");
  });

  it("typography あり → font-family を含む", () => {
    const typography = makeTypography({ fontFamily: "Inter", fontSize: 16 });
    const result = buildCssSuggestion(makeLayout(), makeAppearance(), typography);
    expect(result).toContain('font-family: "Inter";');
    expect(result).toContain("font-size: 16.0px;");
  });
});

describe("isSceneNode", () => {
  it("FRAME ノード → true", () => {
    const node = { type: "FRAME" };
    expect(isSceneNode(node as unknown as BaseNode)).toBe(true);
  });

  it("DOCUMENT ノード → false", () => {
    const node = { type: "DOCUMENT" };
    expect(isSceneNode(node as unknown as BaseNode)).toBe(false);
  });

  it("PAGE ノード → false", () => {
    const node = { type: "PAGE" };
    expect(isSceneNode(node as unknown as BaseNode)).toBe(false);
  });
});

describe("toSceneNode", () => {
  it("null → null", () => {
    expect(toSceneNode(null)).toBeNull();
  });

  it("DOCUMENT ノード → null", () => {
    const node = { type: "DOCUMENT" };
    expect(toSceneNode(node as unknown as BaseNode)).toBeNull();
  });

  it("FRAME ノード → そのまま返す", () => {
    const node = { type: "FRAME", id: "1:2" };
    expect(toSceneNode(node as unknown as BaseNode)).toBe(node);
  });
});

describe("hasChildren", () => {
  it("children プロパティあり → true", () => {
    const node = { type: "FRAME", children: [] };
    expect(hasChildren(node as unknown as SceneNode)).toBe(true);
  });

  it("children なし → false", () => {
    const node = { type: "RECTANGLE" };
    expect(hasChildren(node as unknown as SceneNode)).toBe(false);
  });
});

describe("extractChildren", () => {
  it("子ノードあり → 配列を返す", () => {
    const node = {
      type: "FRAME",
      children: [
        { id: "1:1", name: "child1", type: "RECTANGLE", width: 100, height: 50 },
        { id: "1:2", name: "child2", type: "TEXT", width: 200, height: 30 },
      ],
    };
    const result = extractChildren(node as unknown as SceneNode);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: "1:1",
      name: "child1",
      type: "RECTANGLE",
      width: 100,
      height: 50,
    });
    expect(result[1]).toEqual({ id: "1:2", name: "child2", type: "TEXT", width: 200, height: 30 });
  });

  it("子ノードなし → 空配列", () => {
    const node = { type: "RECTANGLE" };
    const result = extractChildren(node as unknown as SceneNode);
    expect(result).toEqual([]);
  });
});

describe("extractLayoutFromNode", () => {
  it("基本レイアウト → x, y, width, height を含む", () => {
    const node = { type: "RECTANGLE", x: 10, y: 20, width: 300, height: 200 };
    const result = extractLayoutFromNode(node as unknown as SceneNode);
    expect(result.x).toBe(10);
    expect(result.y).toBe(20);
    expect(result.width).toBe(300);
    expect(result.height).toBe(200);
  });

  it("auto-layout ノード → padding, gap を含む", () => {
    const node = {
      type: "FRAME",
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      layoutMode: "HORIZONTAL",
      paddingTop: 10,
      paddingRight: 20,
      paddingBottom: 10,
      paddingLeft: 20,
      itemSpacing: 8,
      primaryAxisAlignItems: "CENTER",
      counterAxisAlignItems: "MIN",
    };
    const result = extractLayoutFromNode(node as unknown as SceneNode);
    expect(result.layoutMode).toBe("HORIZONTAL");
    expect(result.paddingTop).toBe(10);
    expect(result.paddingRight).toBe(20);
    expect(result.itemSpacing).toBe(8);
  });

  it("layoutMode NONE → auto-layout 情報を含まない", () => {
    const node = { type: "FRAME", x: 0, y: 0, width: 100, height: 100, layoutMode: "NONE" };
    const result = extractLayoutFromNode(node as unknown as SceneNode);
    expect(result.layoutMode).toBeUndefined();
  });
});

describe("extractAppearanceFromNode", () => {
  it("opacity を含む", () => {
    const node = { type: "RECTANGLE", opacity: 0.8 };
    const result = extractAppearanceFromNode(node as unknown as SceneNode);
    expect(result.opacity).toBe(0.8);
  });

  it("SOLID fills → HEX 色を含む", () => {
    const node = {
      type: "RECTANGLE",
      opacity: 1,
      fills: [{ type: "SOLID", visible: true, color: { r: 1, g: 0, b: 0 }, opacity: 1 }],
    };
    const result = extractAppearanceFromNode(node as unknown as SceneNode);
    const fills = result.fills as { type: string; color: string }[];
    expect(fills[0].color).toBe("#FF0000");
  });

  it("cornerRadius → borderRadius を含む", () => {
    const node = { type: "RECTANGLE", opacity: 1, cornerRadius: 12 };
    const result = extractAppearanceFromNode(node as unknown as SceneNode);
    expect(result.borderRadius).toEqual({
      topLeft: 12,
      topRight: 12,
      bottomRight: 12,
      bottomLeft: 12,
    });
  });

  it("strokes → stroke 情報を含む", () => {
    const node = {
      type: "RECTANGLE",
      opacity: 1,
      strokes: [{ type: "SOLID", visible: true, color: { r: 0, g: 0, b: 0 } }],
      strokeWeight: 2,
    };
    const result = extractAppearanceFromNode(node as unknown as SceneNode);
    const strokes = result.strokes as { type: string; color: string; weight: number }[];
    expect(strokes[0].color).toBe("#000000");
    expect(strokes[0].weight).toBe(2);
  });

  it("effects → effects を含む", () => {
    const node = {
      type: "RECTANGLE",
      opacity: 1,
      effects: [{ type: "DROP_SHADOW", visible: true, radius: 4 }],
    };
    const result = extractAppearanceFromNode(node as unknown as SceneNode);
    const effects = result.effects as { type: string; radius: number }[];
    expect(effects[0]).toEqual({ type: "DROP_SHADOW", radius: 4 });
  });
});

describe("extractTypographyFromNode", () => {
  it("TEXT ノード → タイポグラフィ情報を返す", () => {
    const node = {
      type: "TEXT",
      fontName: { family: "Inter", style: "Bold" },
      fontSize: 24,
      lineHeight: { unit: "PIXELS", value: 32 },
      letterSpacing: { value: 0.5 },
      textAlignHorizontal: "LEFT",
      characters: "Hello",
    };
    const result = extractTypographyFromNode(node as unknown as SceneNode);
    expect(result.fontFamily).toBe("Inter");
    expect(result.fontSize).toBe(24);
    expect(result.fontWeight).toBe(700);
    expect(result.lineHeight).toBe(32);
    expect(result.letterSpacing).toBe(0.5);
    expect(result.textContent).toBe("Hello");
  });

  it("非TEXT ノード → 空オブジェクト", () => {
    const node = { type: "RECTANGLE" };
    const result = extractTypographyFromNode(node as unknown as SceneNode);
    expect(result).toBeUndefined();
  });

  it("AUTO lineHeight → 'AUTO' を返す", () => {
    const node = {
      type: "TEXT",
      fontName: { family: "Inter", style: "Regular" },
      fontSize: 16,
      lineHeight: { unit: "AUTO" },
      letterSpacing: { value: 0 },
      textAlignHorizontal: "LEFT",
      characters: "Test",
    };
    const result = extractTypographyFromNode(node as unknown as SceneNode);
    expect(result.lineHeight).toBe("AUTO");
  });
});

describe("extractNodeInspection", () => {
  it("完全なノード → 全フィールドを含む InspectionResult を返す", () => {
    const node = {
      id: "1:1",
      name: "Frame 1",
      type: "FRAME",
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      opacity: 1,
      children: [{ id: "1:2", name: "child", type: "TEXT", width: 100, height: 20 }],
    };
    const result = extractNodeInspection(node as unknown as SceneNode);
    expect(result.nodeId).toBe("1:1");
    expect(result.nodeName).toBe("Frame 1");
    expect(result.nodeType).toBe("FRAME");
    expect(result.layout.width).toBe(400);
    expect(result.children).toHaveLength(1);
    expect(result.cssSuggestion).toContain("width: 400.0px;");
  });
});

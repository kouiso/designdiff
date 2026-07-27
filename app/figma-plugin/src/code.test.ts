import { describe, it, expect, beforeEach, vi } from "vitest";

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

// --- figma API を経由する経路 ---

// Figma のノード型は巨大なので、テストでは必要なプロパティだけを持つ偽物を渡す。
// 型アサーション禁止のため、型述語で目的の型とみなす。
function isShapeOf<T>(_value: unknown): _value is T {
  return true;
}

function fake<T>(source: object): T {
  if (!isShapeOf<T>(source)) throw new Error("unreachable");
  return source;
}

function postedMessages(): { type: string; [key: string]: unknown }[] {
  return vi.mocked(figma.ui.postMessage).mock.calls.map((call) => fake(call[0]));
}

function lastMessageOfType(type: string): Record<string, unknown> | undefined {
  return postedMessages()
    .filter((msg) => msg.type === type)
    .at(-1);
}

function sendToPlugin(msg: object): void {
  const handler = figma.ui.onmessage;
  if (!handler) throw new Error("code.ts が figma.ui.onmessage を設定していない");
  handler(msg, { origin: "*" });
}

function makeExportableNode(overrides: object = {}): SceneNode {
  return fake({
    id: "1:1",
    name: "Frame 1",
    type: "FRAME",
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    opacity: 1,
    exportAsync: () => Promise.resolve(new Uint8Array([1, 2, 3])),
    ...overrides,
  });
}

beforeEach(() => {
  vi.mocked(figma.ui.postMessage).mockClear();
  vi.mocked(figma.getNodeById).mockReset();
  figma.currentPage.selection = [];
});

describe("figma.ui.onmessage: get-selection", () => {
  it("選択なし → 空配列を返す", async () => {
    sendToPlugin({ type: "get-selection" });
    await vi.waitFor(() => {
      expect(lastMessageOfType("selection")).toEqual({ type: "selection", nodes: [] });
    });
  });

  it("選択あり → id/name/type/幅高さを返す", async () => {
    figma.currentPage.selection = [makeExportableNode({ id: "2:2", name: "Card" })];
    sendToPlugin({ type: "get-selection" });
    await vi.waitFor(() => {
      expect(lastMessageOfType("selection")).toEqual({
        type: "selection",
        nodes: [{ id: "2:2", name: "Card", type: "FRAME", width: 200, height: 100 }],
      });
    });
  });

  it("幅高さを持たないノード → 0 で埋める", async () => {
    figma.currentPage.selection = [fake({ id: "3:3", name: "Slice", type: "SLICE" })];
    sendToPlugin({ type: "get-selection" });
    await vi.waitFor(() => {
      expect(lastMessageOfType("selection")?.nodes).toEqual([
        { id: "3:3", name: "Slice", type: "SLICE", width: 0, height: 0 },
      ]);
    });
  });
});

describe("figma.ui.onmessage: export-frame", () => {
  it("nodeId 指定 → base64 を返す", async () => {
    vi.mocked(figma.getNodeById).mockReturnValue(makeExportableNode({ id: "4:4", name: "Hero" }));
    sendToPlugin({ type: "export-frame", nodeId: "4:4" });
    await vi.waitFor(() => {
      expect(lastMessageOfType("export-result")).toEqual({
        type: "export-result",
        base64: figma.base64Encode(new Uint8Array([1, 2, 3])),
        nodeId: "4:4",
        nodeName: "Hero",
        width: 200,
        height: 100,
      });
    });
  });

  it("nodeId なし → 選択中のノードを書き出す", async () => {
    figma.currentPage.selection = [makeExportableNode()];
    sendToPlugin({ type: "export-frame" });
    await vi.waitFor(() => {
      expect(lastMessageOfType("export-result")?.nodeId).toBe("1:1");
    });
  });

  it("対象ノードなし → エラーを返す", async () => {
    vi.mocked(figma.getNodeById).mockReturnValue(null);
    sendToPlugin({ type: "export-frame", nodeId: "missing" });
    await vi.waitFor(() => {
      expect(lastMessageOfType("export-result")).toEqual({
        type: "export-result",
        error: "No node selected",
      });
    });
  });

  it("PAGE ノード → SceneNode でないのでエラーを返す", async () => {
    vi.mocked(figma.getNodeById).mockReturnValue(fake({ id: "0:1", type: "PAGE" }));
    sendToPlugin({ type: "export-frame", nodeId: "0:1" });
    await vi.waitFor(() => {
      expect(lastMessageOfType("export-result")?.error).toBe("No node selected");
    });
  });

  it("exportAsync が失敗 → エラー文言を返す", async () => {
    figma.currentPage.selection = [
      makeExportableNode({ exportAsync: () => Promise.reject(new Error("too large")) }),
    ];
    sendToPlugin({ type: "export-frame" });
    await vi.waitFor(() => {
      expect(lastMessageOfType("export-result")?.error).toBe("Export failed: too large");
    });
  });

  it("Error 以外の失敗 → 文字列化して返す", async () => {
    // Figma API は Error 以外も投げうる。String() 側の分岐を通すための偽物。
    const nonError: Error = fake({ toString: () => "boom" });
    figma.currentPage.selection = [
      makeExportableNode({ exportAsync: () => Promise.reject(nonError) }),
    ];
    sendToPlugin({ type: "export-frame" });
    await vi.waitFor(() => {
      expect(lastMessageOfType("export-result")?.error).toBe("Export failed: boom");
    });
  });

  it("幅高さを持たないノード → 0 で埋める", async () => {
    figma.currentPage.selection = [
      fake({
        id: "5:5",
        name: "Slice",
        type: "SLICE",
        exportAsync: () => Promise.resolve(new Uint8Array([1])),
      }),
    ];
    sendToPlugin({ type: "export-frame" });
    await vi.waitFor(() => {
      const result = lastMessageOfType("export-result");
      expect(result?.width).toBe(0);
      expect(result?.height).toBe(0);
    });
  });
});

describe("figma.ui.onmessage: inspect-node", () => {
  it("nodeId 指定 → 検査結果を返す", async () => {
    vi.mocked(figma.getNodeById).mockReturnValue(makeExportableNode({ id: "6:6", name: "Panel" }));
    sendToPlugin({ type: "inspect-node", nodeId: "6:6" });
    await vi.waitFor(() => {
      expect(lastMessageOfType("inspect-result")?.inspection).toMatchObject({
        nodeId: "6:6",
        nodeName: "Panel",
      });
    });
  });

  it("nodeId なし → 選択中のノードを検査する", async () => {
    figma.currentPage.selection = [makeExportableNode()];
    sendToPlugin({ type: "inspect-node" });
    await vi.waitFor(() => {
      expect(lastMessageOfType("inspect-result")?.inspection).toMatchObject({ nodeId: "1:1" });
    });
  });

  it("対象ノードなし → エラーを返す", async () => {
    vi.mocked(figma.getNodeById).mockReturnValue(null);
    sendToPlugin({ type: "inspect-node", nodeId: "missing" });
    await vi.waitFor(() => {
      expect(lastMessageOfType("inspect-result")).toEqual({
        type: "inspect-result",
        error: "No node selected",
      });
    });
  });
});

describe("figma.ui.onmessage: その他のコマンド", () => {
  it("compare-images → UI へ比較依頼を差し戻す", async () => {
    sendToPlugin({ type: "compare-images", designBase64: "d", screenshotBase64: "s" });
    await vi.waitFor(() => {
      expect(lastMessageOfType("run-comparison")).toEqual({
        type: "run-comparison",
        designBase64: "d",
        screenshotBase64: "s",
      });
    });
  });

  it("resize → figma.ui.resize を呼ぶ", () => {
    sendToPlugin({ type: "resize", width: 500, height: 600 });
    expect(figma.ui.resize).toHaveBeenCalledWith(500, 600);
  });

  it("close → プラグインを閉じる", () => {
    sendToPlugin({ type: "close" });
    expect(figma.closePlugin).toHaveBeenCalled();
  });
});

describe("selectionchange ハンドラ", () => {
  it("選択変更 → 現在の選択を UI へ送る", async () => {
    const registered = vi.mocked(figma.on).mock.calls.find((call) => call[0] === "selectionchange");
    if (!registered) throw new Error("selectionchange が登録されていない");
    const handler: () => void = fake(registered[1]);

    figma.currentPage.selection = [makeExportableNode({ id: "7:7", name: "Changed" })];
    handler();

    await vi.waitFor(() => {
      expect(lastMessageOfType("selection")?.nodes).toEqual([
        { id: "7:7", name: "Changed", type: "FRAME", width: 200, height: 100 },
      ]);
    });
  });
});

describe("正規化ヘルパー (公開 API 経由)", () => {
  it("グラデーション fill → 型をそのまま保つ", () => {
    const node = fake<SceneNode>({
      type: "RECTANGLE",
      opacity: 1,
      fills: [
        { type: "GRADIENT_RADIAL", visible: true },
        { type: "IMAGE", visible: true },
      ],
    });
    expect(extractAppearanceFromNode(node).fills).toEqual([
      { type: "GRADIENT_RADIAL" },
      { type: "IMAGE" },
    ]);
  });

  it("未知の fill 型 → GRADIENT_LINEAR に寄せる", () => {
    const node = fake<SceneNode>({
      type: "RECTANGLE",
      opacity: 1,
      fills: [{ type: "VIDEO", visible: true }],
    });
    expect(extractAppearanceFromNode(node).fills).toEqual([{ type: "GRADIENT_LINEAR" }]);
  });

  it("非表示の fill / stroke → 除外する", () => {
    const node = fake<SceneNode>({
      type: "RECTANGLE",
      opacity: 1,
      fills: [{ type: "SOLID", visible: false, color: { r: 0, g: 0, b: 0 } }],
      strokes: [
        { type: "SOLID", visible: false, color: { r: 0, g: 0, b: 0 } },
        { type: "GRADIENT_LINEAR", visible: true },
      ],
    });
    const appearance = extractAppearanceFromNode(node);
    expect(appearance.fills).toEqual([]);
    expect(appearance.strokes).toEqual([]);
  });

  it("strokeWeight が数値でない → 1 を使う", () => {
    const node = fake<SceneNode>({
      type: "RECTANGLE",
      opacity: 1,
      strokes: [{ type: "SOLID", visible: true, color: { r: 0, g: 0, b: 0 } }],
      strokeWeight: figma.mixed,
    });
    expect(extractAppearanceFromNode(node).strokes[0].weight).toBe(1);
  });

  it("各 effect 型 → そのまま保ち、未知の型は LAYER_BLUR に寄せる", () => {
    const node = fake<SceneNode>({
      type: "RECTANGLE",
      opacity: 1,
      effects: [
        { type: "INNER_SHADOW", visible: true, radius: 2 },
        { type: "BACKGROUND_BLUR", visible: true, radius: 3 },
        { type: "NOISE", visible: true },
      ],
    });
    expect(extractAppearanceFromNode(node).effects).toEqual([
      { type: "INNER_SHADOW", radius: 2 },
      { type: "BACKGROUND_BLUR", radius: 3 },
      { type: "LAYER_BLUR", radius: 0 },
    ]);
  });

  it("mixed な fills → 何も取り出さない", () => {
    const node = fake<SceneNode>({ type: "RECTANGLE", opacity: 1, fills: figma.mixed });
    expect(extractAppearanceFromNode(node).fills).toEqual([]);
  });

  function makeTextNode(overrides: object): SceneNode {
    return fake({
      type: "TEXT",
      fontName: { family: "Inter", style: "Regular" },
      fontSize: 16,
      lineHeight: { unit: "AUTO" },
      letterSpacing: { value: 0 },
      textAlignHorizontal: "LEFT",
      characters: "Test",
      ...overrides,
    });
  }

  it.each([
    ["Thin", 100],
    ["Extra Light", 200],
    ["ExtraLight", 200],
    ["Light", 300],
    ["Regular", 400],
    ["Medium", 500],
    ["Semi Bold", 600],
    ["SemiBold", 600],
    ["Extra Bold", 800],
    ["ExtraBold", 800],
    ["Black", 900],
    ["Heavy", 900],
    ["Bold", 700],
  ])("fontStyle %s → fontWeight %i", (style, weight) => {
    const node = makeTextNode({ fontName: { family: "Inter", style } });
    expect(extractTypographyFromNode(node)?.fontWeight).toBe(weight);
  });

  it.each([
    ["CENTER", "CENTER"],
    ["RIGHT", "RIGHT"],
    ["JUSTIFIED", "JUSTIFIED"],
    ["LEFT", "LEFT"],
    ["UNKNOWN", "LEFT"],
  ])("textAlignHorizontal %s → textAlign %s", (input, expected) => {
    const node = makeTextNode({ textAlignHorizontal: input });
    expect(extractTypographyFromNode(node)?.textAlign).toBe(expected);
  });

  it("mixed な fontName / fontSize / letterSpacing → 既定値に落とす", () => {
    const node = makeTextNode({
      fontName: figma.mixed,
      fontSize: figma.mixed,
      lineHeight: figma.mixed,
      letterSpacing: figma.mixed,
    });
    const typography = extractTypographyFromNode(node);
    expect(typography?.fontFamily).toBe("Mixed");
    expect(typography?.fontSize).toBe(0);
    expect(typography?.fontWeight).toBe(400);
    expect(typography?.lineHeight).toBe("AUTO");
    expect(typography?.letterSpacing).toBe(0);
  });

  it("TEXT ノードの検査 → typography を含む", () => {
    const result = extractNodeInspection(makeTextNode({ id: "8:8", name: "Label", x: 0, y: 0 }));
    expect(result.typography?.fontFamily).toBe("Inter");
  });
});

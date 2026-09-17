import { describe, expect, it } from "vitest";

import { extractDesignTokens } from "./design-token-extractor.js";

import type { FigmaNode } from "./figma-client.js";

const node = (overrides: Partial<FigmaNode> = {}): FigmaNode => ({
  id: crypto.randomUUID(),
  name: "Panel",
  type: "FRAME",
  children: [],
  fills: [],
  strokes: [],
  effects: [],
  ...overrides,
});

describe("extractDesignTokens", () => {
  it("Figmaの寸法・余白・描画値を同じ丸め規則で抽出する", () => {
    const target = node({
      absoluteBoundingBox: { x: 0, y: 0, width: 320.555, height: 180.444 },
      paddingTop: 8,
      itemSpacing: 12,
      fills: [
        {
          type: "SOLID",
          opacity: 0.5,
          color: { r: 1, g: 0, b: 0, a: 1 },
        },
      ],
      effects: [{ type: "DROP_SHADOW", offset: { x: 1.234, y: 2.345 }, radius: 8.678 }],
    });

    const tokens = extractDesignTokens(target, 1);

    expect(tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: "width", value: 320.56, unit: "px" }),
        expect.objectContaining({ property: "height", value: 180.44, unit: "px" }),
        expect.objectContaining({ property: "paddingTop", value: 8, unit: "px" }),
        expect.objectContaining({ property: "gap", value: 12, unit: "px" }),
        expect.objectContaining({ property: "backgroundColor", value: "#FF000080" }),
        expect.objectContaining({ property: "boxShadowOffsetX", value: 1.23, unit: "px" }),
        expect.objectContaining({ property: "boxShadowOffsetY", value: 2.35, unit: "px" }),
        expect.objectContaining({ property: "boxShadowRadius", value: 8.68, unit: "px" }),
      ]),
    );
  });

  it("深さの上限を越えた子と非表示ノードを除外する", () => {
    const hidden = node({
      visible: false,
      absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
    });
    const grandchild = node({ absoluteBoundingBox: { x: 0, y: 0, width: 20, height: 20 } });
    const child = node({
      absoluteBoundingBox: { x: 0, y: 0, width: 40, height: 40 },
      children: [hidden, grandchild],
    });
    const root = node({ children: [child] });

    const nodeIds = extractDesignTokens(root, 1).map((token) => token.nodeId);

    expect(nodeIds).toContain(child.id);
    expect(nodeIds).not.toContain(hidden.id);
    expect(nodeIds).not.toContain(grandchild.id);
  });
});

import { describe, expect, it } from "vitest";

import type { DomElementStyle, FigmaNode } from "@figdiff/shared";

import {
  blockingMismatches,
  MIN_COMPARABLE_NODES,
  normalizeCssColor,
  normalizeFontFamily,
  overlapRatio,
  runTokenDiff,
} from "./token-diff-service.js";

function node(overrides: Partial<FigmaNode> & Pick<FigmaNode, "id" | "name" | "type">): FigmaNode {
  return {
    children: [],
    fills: [],
    strokes: [],
    effects: [],
    ...overrides,
  };
}

function solidFill(hex: { r: number; g: number; b: number }) {
  return [{ type: "SOLID", color: { ...hex, a: 1 } }];
}

function textNode(
  id: string,
  box: { x: number; y: number; width: number; height: number },
  style: { fontSize: number; fontWeight: number; fontFamily: string },
  color: { r: number; g: number; b: number },
): FigmaNode {
  return node({
    id,
    name: `text-${id}`,
    type: "TEXT",
    absoluteBoundingBox: box,
    fills: solidFill(color),
    style,
  });
}

function domText(
  box: { x: number; y: number; width: number; height: number },
  style: { color: string; fontSize: number; fontWeight: number; fontFamily: string },
): DomElementStyle {
  return { tag: "p", text: "sample", ...box, ...style };
}

/** 3つのテキストが完全一致する、素直なフレーム。 */
function matchingFixture(): { root: FigmaNode; dom: DomElementStyle[] } {
  const boxes = [
    { x: 100, y: 100, width: 200, height: 24 },
    { x: 100, y: 140, width: 200, height: 24 },
    { x: 100, y: 180, width: 200, height: 24 },
  ];
  const root = node({
    id: "0:1",
    name: "Frame",
    type: "FRAME",
    absoluteBoundingBox: { x: 100, y: 100, width: 400, height: 300 },
    children: boxes.map((box, index) =>
      textNode(
        `1:${index}`,
        box,
        { fontSize: 16, fontWeight: 400, fontFamily: "Inter" },
        { r: 0, g: 0, b: 0 },
      ),
    ),
  });
  const dom = boxes.map((box) =>
    domText(
      { x: box.x - 100, y: box.y - 100, width: box.width, height: box.height },
      { color: "rgb(0, 0, 0)", fontSize: 16, fontWeight: 400, fontFamily: "Inter, sans-serif" },
    ),
  );
  return { root, dom };
}

describe("normalizeCssColor", () => {
  it("rgb 表記と16進表記を同じ形へ揃える", () => {
    expect(normalizeCssColor("rgb(34, 170, 136)")).toBe("#22AA88");
    expect(normalizeCssColor("#22aa88")).toBe("#22AA88");
    expect(normalizeCssColor("#2a8")).toBe("#22AA88");
  });

  it("不透明な rgba は alpha を落とす", () => {
    expect(normalizeCssColor("rgba(255, 255, 255, 1)")).toBe("#FFFFFF");
  });

  it("半透明は alpha 付きで残す", () => {
    expect(normalizeCssColor("rgba(0, 0, 0, 0.5)")).toBe("#00000080");
  });

  it("解釈できない表記は undefined を返す (推測で色を作らない)", () => {
    expect(normalizeCssColor("linear-gradient(red, blue)")).toBeUndefined();
    expect(normalizeCssColor("rebeccapurple")).toBeUndefined();
    expect(normalizeCssColor("")).toBeUndefined();
    expect(normalizeCssColor(undefined)).toBeUndefined();
  });
});

describe("normalizeFontFamily", () => {
  it("候補指定の先頭だけを取り出す", () => {
    expect(normalizeFontFamily('"Helvetica Neue", Arial, sans-serif')).toBe("helvetica neue");
    expect(normalizeFontFamily("Inter")).toBe("inter");
  });
});

describe("overlapRatio", () => {
  it("完全一致は1", () => {
    const rect = { x: 0, y: 0, width: 10, height: 10 };
    expect(overlapRatio(rect, rect)).toBe(1);
  });

  it("離れていれば0", () => {
    expect(
      overlapRatio({ x: 0, y: 0, width: 10, height: 10 }, { x: 50, y: 50, width: 10, height: 10 }),
    ).toBe(0);
  });
});

describe("runTokenDiff", () => {
  it("完全一致なら不一致ゼロで、判定に使える", () => {
    const { root, dom } = matchingFixture();
    const report = runTokenDiff({ figmaRootNode: root, domStyles: dom, screenshotWidth: 400 });

    expect(report.matchedNodeCount).toBe(3);
    expect(report.unmatchedNodeCount).toBe(0);
    expect(report.mismatches).toHaveLength(0);
    expect(report.reliable).toBe(true);
    expect(report.checkedPropertyCount).toBeGreaterThan(0);
  });

  // ledger の #FCFCFC vs #FFFFFF ケース。画素経路ではアンチエイリアスに埋もれる差。
  it("わずかな色違いを critical として捕まえる", () => {
    const { root, dom } = matchingFixture();
    dom[0] = { ...dom[0], color: "rgb(252, 252, 252)" };

    const report = runTokenDiff({ figmaRootNode: root, domStyles: dom, screenshotWidth: 400 });
    const blocking = blockingMismatches(report);

    expect(blocking).toHaveLength(1);
    expect(blocking[0].property).toBe("color");
    expect(blocking[0].designValue).toBe("#000000");
    expect(blocking[0].implValue).toBe("#FCFCFC");
    expect(blocking[0].region).toEqual({ x: 0, y: 0, w: 200, h: 24 });
  });

  it("フォントサイズと太さの違いも critical として出す", () => {
    const { root, dom } = matchingFixture();
    dom[1] = { ...dom[1], fontSize: 18, fontWeight: 700 };

    const report = runTokenDiff({ figmaRootNode: root, domStyles: dom, screenshotWidth: 400 });
    const properties = blockingMismatches(report).map((mismatch) => mismatch.property);

    expect(properties).toContain("fontSize");
    expect(properties).toContain("fontWeight");
  });

  it("許容差の内側の丸めは不一致にしない", () => {
    const { root, dom } = matchingFixture();
    dom[2] = { ...dom[2], fontSize: 16.4 };

    const report = runTokenDiff({ figmaRootNode: root, domStyles: dom, screenshotWidth: 400 });

    expect(report.mismatches).toHaveLength(0);
  });

  // 候補指定 (Inter, sans-serif) の違いだけで落とすと、まともな CSS が全部落ちる。
  it("フォント指定の違いは報告するが合否は落とさない", () => {
    const { root, dom } = matchingFixture();
    dom[0] = { ...dom[0], fontFamily: "Arial, sans-serif" };

    const report = runTokenDiff({ figmaRootNode: root, domStyles: dom, screenshotWidth: 400 });

    expect(report.mismatches.map((mismatch) => mismatch.property)).toContain("fontFamily");
    expect(blockingMismatches(report)).toHaveLength(0);
  });

  it("Figma 幅とスクショ幅が違っても倍率で吸収する", () => {
    const { root, dom } = matchingFixture();
    const scaled = dom.map((entry) => ({
      ...entry,
      x: entry.x * 2,
      y: entry.y * 2,
      width: entry.width * 2,
      height: entry.height * 2,
    }));

    const report = runTokenDiff({ figmaRootNode: root, domStyles: scaled, screenshotWidth: 800 });

    expect(report.matchedNodeCount).toBe(3);
    expect(report.mismatches).toHaveLength(0);
  });

  it("座標がずれて対応付けできなければ、判定に使わず理由を残す", () => {
    const { root, dom } = matchingFixture();
    const shifted = dom.map((entry) => ({ ...entry, y: entry.y + 5_000 }));

    const report = runTokenDiff({ figmaRootNode: root, domStyles: shifted, screenshotWidth: 400 });

    expect(report.matchedNodeCount).toBe(0);
    expect(report.unmatchedRatio).toBe(1);
    expect(report.reliable).toBe(false);
    expect(report.demotionReason).toContain("足りません");
    expect(blockingMismatches(report)).toHaveLength(0);
  });

  it("対応付けが最低件数に届かなければ、不一致があっても合否に使わない", () => {
    const { root, dom } = matchingFixture();
    dom[0] = { ...dom[0], color: "rgb(255, 0, 0)" };
    const partial = [dom[0]];

    const report = runTokenDiff({ figmaRootNode: root, domStyles: partial, screenshotWidth: 400 });

    expect(report.matchedNodeCount).toBeLessThan(MIN_COMPARABLE_NODES);
    expect(report.mismatches.length).toBeGreaterThan(0);
    expect(blockingMismatches(report)).toHaveLength(0);
  });

  it("フレーム全面を覆う塗りは未照合として数えない", () => {
    const { root, dom } = matchingFixture();
    const withBackdrop = node({
      ...root,
      children: [
        node({
          id: "1:99",
          name: "Backdrop",
          type: "RECTANGLE",
          absoluteBoundingBox: { x: 100, y: 100, width: 400, height: 300 },
          fills: solidFill({ r: 1, g: 1, b: 1 }),
        }),
        ...(root.children ?? []),
      ],
    });

    const report = runTokenDiff({
      figmaRootNode: withBackdrop,
      domStyles: dom,
      screenshotWidth: 400,
    });

    expect(report.comparedNodeCount).toBe(3);
    expect(report.unmatchedNodeCount).toBe(0);
  });

  // 全部違うのは「実装が全部間違い」より「別のフレームと比べとる」ほうが起こりやすい。
  it("対応付けの過半で食い違うときは、一覧は残して合否には使わない", () => {
    const { root, dom } = matchingFixture();
    const allWrong = dom.map((entry) => ({ ...entry, color: "rgb(255, 0, 0)" }));

    const report = runTokenDiff({ figmaRootNode: root, domStyles: allWrong, screenshotWidth: 400 });

    expect(report.matchedNodeCount).toBe(3);
    expect(report.mismatches).toHaveLength(3);
    expect(report.reliable).toBe(false);
    expect(report.demotionReason).toContain("別のフレーム");
    expect(blockingMismatches(report)).toHaveLength(0);
  });

  it("食い違いが少数なら合否に使う", () => {
    const { root, dom } = matchingFixture();
    dom[0] = { ...dom[0], color: "rgb(255, 0, 0)" };

    const report = runTokenDiff({ figmaRootNode: root, domStyles: dom, screenshotWidth: 400 });

    expect(report.reliable).toBe(true);
    expect(blockingMismatches(report)).toHaveLength(1);
  });

  it("フレームの寸法が取れなければ理由付きで判定を放棄する", () => {
    const report = runTokenDiff({
      figmaRootNode: node({ id: "0:1", name: "Frame", type: "FRAME" }),
      domStyles: [],
      screenshotWidth: 400,
    });

    expect(report.reliable).toBe(false);
    expect(report.demotionReason).toContain("寸法");
  });
});

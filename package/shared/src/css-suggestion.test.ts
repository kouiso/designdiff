import { describe, expect, it } from "vitest";

import { figmaColorToHex, generateCssSuggestion } from "./css-suggestion.js";

import type { NodeAppearance, NodeLayout } from "./type.js";

const layout: NodeLayout = {
  x: 0,
  y: 0,
  width: 100,
  height: 50,
};

function makeAppearance(borderRadius: NodeAppearance["borderRadius"]): NodeAppearance {
  return {
    fills: [],
    strokes: [],
    borderRadius,
    opacity: 1,
    blendMode: "NORMAL",
    effects: [],
  };
}

describe("generateCssSuggestion", () => {
  it("layout と appearance と typography から CSS を生成する", () => {
    const css = generateCssSuggestion(
      {
        ...layout,
        layoutMode: "HORIZONTAL",
        paddingTop: 8,
        paddingRight: 12,
        paddingBottom: 8,
        paddingLeft: 12,
        itemSpacing: 16,
      },
      {
        fills: [{ type: "SOLID", color: "#112233" }],
        strokes: [{ color: "#445566", weight: 2, align: "CENTER" }],
        borderRadius: {
          topLeft: 4,
          topRight: 4,
          bottomRight: 4,
          bottomLeft: 4,
        },
        opacity: 0.5,
        blendMode: "NORMAL",
        effects: [
          {
            type: "DROP_SHADOW",
            color: "rgba(0,0,0,0.25)",
            offset: { x: 1, y: 2 },
            radius: 3,
            spread: 4,
          },
        ],
      },
      {
        fontFamily: "Inter",
        fontWeight: 700,
        fontSize: 16,
        lineHeight: 24,
        letterSpacing: 0.5,
        textAlign: "CENTER",
        textDecoration: "NONE",
        textContent: "Hello",
      },
    );

    expect(css).toContain("display: flex; flex-direction: row;");
    expect(css).toContain("padding: 8.0px 12.0px 8.0px 12.0px;");
    expect(css).toContain("gap: 16.0px;");
    expect(css).toContain("color: #112233;");
    expect(css).toContain("border: 2.0px solid #445566;");
    expect(css).toContain("border-radius: 4.0px;");
    expect(css).toContain("box-shadow: 1.0px 2.0px 3.0px 4.0px rgba(0,0,0,0.25);");
    expect(css).toContain("opacity: 0.50;");
    expect(css).toContain('font-family: "Inter";');
    expect(css).toContain("line-height: 24.0px;");
    expect(css).toContain("letter-spacing: 0.5px;");
    expect(css).toContain("text-align: center;");
  });

  it("等しい padding と個別 border-radius を生成する", () => {
    const css = generateCssSuggestion(
      {
        ...layout,
        layoutMode: "VERTICAL",
        paddingTop: 8,
        paddingRight: 8,
        paddingBottom: 8,
        paddingLeft: 8,
      },
      makeAppearance({
        topLeft: 2,
        topRight: 4,
        bottomRight: 6,
        bottomLeft: 8,
      }),
      undefined,
    );

    expect(css).toContain("display: flex; flex-direction: column;");
    expect(css).toContain("padding: 8.0px;");
    expect(css).toContain("border-radius: 2.0px 4.0px 6.0px 8.0px;");
  });

  it("auto-layout alignment を flex alignment CSS に変換する", () => {
    const css = generateCssSuggestion(
      {
        ...layout,
        layoutMode: "HORIZONTAL",
        primaryAxisAlign: "SPACE_BETWEEN",
        counterAxisAlign: "CENTER",
      },
      makeAppearance(undefined),
      undefined,
    );

    expect(css).toContain("justify-content: space-between;");
    expect(css).toContain("align-items: center;");
  });

  it("primary-axis MIN は省略し counter-axis MIN は flex-start を出力する", () => {
    const css = generateCssSuggestion(
      {
        ...layout,
        layoutMode: "VERTICAL",
        primaryAxisAlign: "MIN",
        counterAxisAlign: "MIN",
      },
      makeAppearance(undefined),
      undefined,
    );

    expect(css).not.toContain("justify-content");
    expect(css).toContain("align-items: flex-start;");
  });

  it("counter-axis SPACE_BETWEEN は invalid な align-items を出力しない", () => {
    const css = generateCssSuggestion(
      {
        ...layout,
        layoutMode: "HORIZONTAL",
        counterAxisAlign: "SPACE_BETWEEN",
      },
      makeAppearance(undefined),
      undefined,
    );

    expect(css).not.toContain("align-items: space-between;");
  });

  it("gradient fill は background-image として生成する", () => {
    const css = generateCssSuggestion(
      layout,
      {
        fills: [
          {
            type: "GRADIENT_LINEAR",
            gradientStops: [
              { color: "#FF0000", position: 0 },
              { color: "#0000FF80", position: 0.5 },
            ],
          },
        ],
        strokes: [],
        borderRadius: undefined,
        opacity: 1,
        blendMode: "NORMAL",
        effects: [],
      },
      undefined,
    );

    expect(css).toContain("background-image: linear-gradient(#FF0000 0.0%, #0000FF80 50.0%);");
  });

  it("pre-folded fill opacity color をそのまま生成する", () => {
    const css = generateCssSuggestion(
      layout,
      {
        fills: [{ type: "SOLID", color: "#FF000080", opacity: 0.5 }],
        strokes: [],
        borderRadius: undefined,
        opacity: 1,
        blendMode: "NORMAL",
        effects: [],
      },
      undefined,
    );

    expect(css).toContain("background-color: #FF000080;");
  });

  it("typography がある fill は color として生成する", () => {
    const css = generateCssSuggestion(
      layout,
      {
        fills: [{ type: "SOLID", color: "#112233" }],
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
      },
      {
        fontFamily: "Inter",
        fontWeight: 400,
        fontSize: 16,
        lineHeight: "AUTO",
        letterSpacing: 0,
        textAlign: "LEFT",
        textDecoration: "NONE",
        textContent: "Hello",
      },
    );

    expect(css).toContain("color: #112233;");
    expect(css).not.toContain("background-color: #112233;");
  });

  it("ゼロの border-radius は CSS に出力しない", () => {
    const css = generateCssSuggestion(
      layout,
      makeAppearance({
        topLeft: 0,
        topRight: 0,
        bottomRight: 0,
        bottomLeft: 0,
      }),
      undefined,
    );

    expect(css).not.toContain("border-radius");
  });
});

describe("figmaColorToHex", () => {
  it("alpha が 1 未満なら RGBA hex を返す", () => {
    expect(figmaColorToHex(1, 0.5, 0, 0.5)).toBe("#FF800080");
  });
});

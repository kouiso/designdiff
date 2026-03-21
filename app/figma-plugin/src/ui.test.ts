import { describe, it, expect } from "vitest";

import { escapeHtml, isPluginResponse, pixelmatchSimple } from "./ui";

describe("escapeHtml", () => {
  it("& → &amp;", () => {
    expect(escapeHtml("&")).toBe("&amp;");
  });

  it("< → &lt;", () => {
    expect(escapeHtml("<")).toBe("&lt;");
  });

  it("> → &gt;", () => {
    expect(escapeHtml(">")).toBe("&gt;");
  });

  it('" → &quot;', () => {
    expect(escapeHtml('"')).toBe("&quot;");
  });

  it("<script> → &lt;script&gt;", () => {
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
  });

  it("通常文字列 → 変更なし", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });

  it("空文字列 → 空文字列", () => {
    expect(escapeHtml("")).toBe("");
  });
});

describe("isPluginResponse", () => {
  it("{ type: 'selection', nodes: [] } → true", () => {
    expect(isPluginResponse({ type: "selection", nodes: [] })).toBe(true);
  });

  it("{ type: 'export-result', base64: '...' } → true", () => {
    expect(isPluginResponse({ type: "export-result", base64: "abc" })).toBe(true);
  });

  it("{} → false (type なし)", () => {
    expect(isPluginResponse({})).toBe(false);
  });

  it("null → false", () => {
    expect(isPluginResponse(null)).toBe(false);
  });

  it("undefined → false", () => {
    expect(isPluginResponse(undefined)).toBe(false);
  });

  it("{ type: 123 } → false (type が string でない)", () => {
    expect(isPluginResponse({ type: 123 })).toBe(false);
  });

  it('"string" → false (object でない)', () => {
    expect(isPluginResponse("string")).toBe(false);
  });
});

describe("pixelmatchSimple", () => {
  it("同一画像 → diffCount = 0", () => {
    const img = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
    const output = new Uint8ClampedArray(8);
    const diff = pixelmatchSimple(img, img, output, 2, 1, 0.1);
    expect(diff).toBe(0);
  });

  it("完全に異なる画像 → diffCount > 0", () => {
    const img1 = new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255]);
    const img2 = new Uint8ClampedArray([0, 255, 0, 255, 0, 255, 0, 255]);
    const output = new Uint8ClampedArray(8);
    const diff = pixelmatchSimple(img1, img2, output, 2, 1, 0.1);
    expect(diff).toBeGreaterThan(0);
  });

  it("差分ピクセルは赤(255,0,0,200)で出力される", () => {
    const img1 = new Uint8ClampedArray([255, 0, 0, 255]);
    const img2 = new Uint8ClampedArray([0, 255, 0, 255]);
    const output = new Uint8ClampedArray(4);
    pixelmatchSimple(img1, img2, output, 1, 1, 0.1);
    expect(output[0]).toBe(255);
    expect(output[1]).toBe(0);
    expect(output[2]).toBe(0);
    expect(output[3]).toBe(200);
  });

  it("一致ピクセルは元画像の半透明(alpha=60)で出力される", () => {
    const img = new Uint8ClampedArray([100, 150, 200, 255]);
    const output = new Uint8ClampedArray(4);
    pixelmatchSimple(img, img, output, 1, 1, 0.1);
    expect(output[0]).toBe(100);
    expect(output[1]).toBe(150);
    expect(output[2]).toBe(200);
    expect(output[3]).toBe(60);
  });

  it("threshold=1.0 → 微小差分は一致扱い", () => {
    // maxDelta = 35215 * 1.0^2 = 35215
    // delta = 100^2 + 100^2 + 0 = 20000 < 35215 → 一致扱い
    const img1 = new Uint8ClampedArray([200, 100, 50, 255]);
    const img2 = new Uint8ClampedArray([100, 0, 50, 255]);
    const output = new Uint8ClampedArray(4);
    const diff = pixelmatchSimple(img1, img2, output, 1, 1, 1.0);
    expect(diff).toBe(0);
  });
});

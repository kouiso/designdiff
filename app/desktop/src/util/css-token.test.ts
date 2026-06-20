import { afterEach, describe, expect, it, vi } from "vitest";

import { readCssToken } from "./css-token";

describe("readCssToken", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("CSS トークン値を trim して返す", () => {
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: (name: string) => (name === "--cobalt" ? "  oklch(0.54 0.165 256)  " : ""),
    } as CSSStyleDeclaration);

    expect(readCssToken("--cobalt", "#3b82f6")).toBe("oklch(0.54 0.165 256)");
  });

  it("CSS トークン値が空なら fallback を返す", () => {
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: () => "   ",
    } as CSSStyleDeclaration);

    expect(readCssToken("--missing", "#3b82f6")).toBe("#3b82f6");
  });
});

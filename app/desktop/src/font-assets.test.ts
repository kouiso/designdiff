import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

describe("desktop font assets", () => {
  it("外部フォントへ接続せず、同梱したフォントを読み込む", () => {
    const html = readSource("../index.html");
    const entrypoint = readSource("./main.tsx");

    expect(html).not.toContain("fonts.googleapis.com");
    expect(html).not.toContain("fonts.gstatic.com");
    expect(entrypoint).toContain('import "@fontsource-variable/hanken-grotesk"');
    expect(entrypoint).toContain('import "@fontsource-variable/jetbrains-mono"');
    expect(entrypoint).toContain('import "@fontsource-variable/noto-sans-jp"');
  });
});

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function readAppFile(relativePath: string): string {
  return readFileSync(resolve(APP_ROOT, relativePath), "utf8");
}

// test-inspector.html は dev サーバー上でだけ開く検証用ハーネス。
// 製品の入力 (Electron renderer / Web ビルド) に載ると製品へ混入するので、設定に現れないことを固定する。
describe("検証用ハーネスは製品ビルドに入らない", () => {
  it("electron renderer のビルド入力は index.html だけ", () => {
    const config = readAppFile("electron.vite.config.ts");

    expect(config).not.toContain("test-inspector");
    expect(config).toContain('resolve(__dirname, "index.html")');
  });

  it("Web ビルドの設定にハーネスを入力として足していない", () => {
    expect(readAppFile("vite.web.config.ts")).not.toContain("test-inspector");
  });

  it("製品の index.html からハーネスを参照していない", () => {
    expect(readAppFile("index.html")).not.toContain("test-inspector");
  });
});

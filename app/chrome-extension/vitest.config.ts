import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      // ビルド用スクリプトと手動スモークは製品コードやない。
      // 分母に入れると「未テストの製品コード」の量が読めなくなる。
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/__mock__/**"],
      // 目標は4軸すべて80% (document.md Phase E)。
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.ts"],
    setupFiles: ["./src/__mock__/setup.ts"],
  },
});

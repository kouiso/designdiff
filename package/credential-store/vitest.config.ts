import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      // 目標は4軸すべて80% (document.md Phase E)。まだ届いていないので、
      // 現状の実測値を下限に置いて「下がったら止める」状態にしてある。
      // 80%まで引き上げる作業は #307 で追う。
      thresholds: {
        statements: 49,
        branches: 87,
        functions: 72,
        lines: 49,
      },
    },
    environment: "node",
    passWithNoTests: false,
  },
});

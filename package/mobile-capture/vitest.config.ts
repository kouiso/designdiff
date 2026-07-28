import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      // document.md Phase E の目標 (4軸すべて80%) を満たしている。
      // CLI 入口も分母に含めたうえでの数字。除外して数字を作っていない。
      //
      // 2026-07-28 実測: statements 92.39 / branches 96.36 / functions 92.85 /
      // lines 92.39。撮影プロバイダ3本の単体テストを足して上がった分を下限へ
      // 反映する。実測より下に置くと、下がったことに誰も気づかない。
      // 下限を下げて通すのは禁止。下がったら原因を直すこと。
      thresholds: {
        statements: 90,
        branches: 95,
        functions: 90,
        lines: 90,
      },
    },
  },
});

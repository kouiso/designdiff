import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify("0.0.0-test"),
    __POSTHOG_KEY__: JSON.stringify(""),
    __POSTHOG_HOST__: JSON.stringify("https://eu.i.posthog.com"),
  },
  test: {
    environment: "node",
    include: ["electron/**/*.test.ts"],
    globals: true,
    // Electron のメインプロセス側は、以前は一度も測られていなかった。画面側だけを
    // 測った数字を「デスクトップ全体の値」として報告しており、出荷しているコードの
    // 約2割が計測の外にあった。
    //
    // 2026-07-28 実測: statements 82.35 / branches 87.46 / functions 92.85 /
    // lines 82.35。document.md Phase E の目標 (4軸すべて80%) を満たした。
    // 下限を下げて通すのは禁止。下がったら原因を直すこと。
    coverage: {
      provider: "v8",
      include: ["electron/**/*.ts"],
      // 型宣言だけのファイル。実行される行が1つも無いので、数えると
      // 分母だけが膨らむ。テストの書きようも無い。
      exclude: ["electron/**/*.test.ts", "electron/type/**"],
      thresholds: {
        statements: 80,
        branches: 85,
        functions: 90,
        lines: 80,
      },
    },
  },
});

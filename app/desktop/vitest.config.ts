import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify("0.0.0-test"),
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/__mock__/setup.ts"],
    globals: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      // 除外してよいのは「実行される製品ロジックを持たないファイル」だけ。
      // 出荷コードを分母から外して数字を作るのは禁止。
      // - src/i18n/**: i18next の初期化19行と翻訳辞書(JSON)のみで分岐なし
      // - src/env.d.ts: ambient 宣言のみでランタイム出力なし
      // - src/main.tsx: createRoot して App を描くだけの13行の起動処理
      // - src/lib/platform/platform-adapter.ts: interface と型宣言のみ、関数本体ゼロ
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/__mock__/**",
        "src/test-fixture/**",
        "src/i18n/**",
        "src/env.d.ts",
        "src/main.tsx",
        "src/lib/platform/platform-adapter.ts",
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});

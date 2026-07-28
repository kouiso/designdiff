import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify("0.0.0-test"),
  },
  test: {
    environment: "node",
    include: ["electron/**/*.test.ts"],
    globals: true,
    // Electron のメインプロセス側 2,348 行は、これまで一度も測られていなかった。
    // 画面側だけを測った数字を「デスクトップ全体の値」として報告しており、
    // 出荷しているコードの約2割が計測の外にあった。
    //
    // 2026-07-28 実測: statements 51.22 / branches 85.82 / functions 88.18 /
    // lines 51.22。重ね合わせの窓口を足した分だけ上がった。行の数で目標の80%へ
    // 届くには、起動処理(234行)と案件・ファイルの窓口が残っている。
    // 実測値を下限に置いて、これ以上下がったら止まるようにする。
    // 下限を下げて通すのは禁止。下がったら原因を直すこと。
    coverage: {
      provider: "v8",
      include: ["electron/**/*.ts"],
      // 型宣言だけのファイル。実行される行が1つも無いので、数えると
      // 分母だけが膨らむ。テストの書きようも無い。
      exclude: ["electron/**/*.test.ts", "electron/type/**"],
      thresholds: {
        statements: 51,
        branches: 85,
        functions: 88,
        lines: 51,
      },
    },
  },
});

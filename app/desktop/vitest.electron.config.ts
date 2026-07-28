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
    // 2026-07-28 実測: statements 23.16 / branches 75.00 / functions 69.38 /
    // lines 23.16。画面側と中身が同じだった変換を共有側へ寄せ、画面へ差し込む
    // 文字列の組み立て12本に検査を足した分だけ上がった。目標の80%にはまだ遠い。
    // 実測値を下限に置いて、これ以上下がったら止まるようにする。
    // 下限を下げて通すのは禁止。下がったら原因を直すこと。
    coverage: {
      provider: "v8",
      include: ["electron/**/*.ts"],
      // 型宣言だけのファイル。実行される行が1つも無いので、数えると
      // 分母だけが膨らむ。テストの書きようも無い。
      exclude: ["electron/**/*.test.ts", "electron/type/**"],
      thresholds: {
        statements: 23,
        branches: 74,
        functions: 68,
        lines: 23,
      },
    },
  },
});

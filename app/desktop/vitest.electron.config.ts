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
    // 2026-07-28 実測: statements 31.94 / branches 85.43 / functions 86.45 /
    // lines 31.94。画面へ差し込む文字列、画像の保管、資格情報の受け渡し、
    // 画面側へ公開する窓口に検査を足した分だけ上がった。行の数では目標の80%に
    // まだ遠い。残りは重ね合わせのIPC(376行)と起動処理(234行)。
    // 実測値を下限に置いて、これ以上下がったら止まるようにする。
    // 下限を下げて通すのは禁止。下がったら原因を直すこと。
    coverage: {
      provider: "v8",
      include: ["electron/**/*.ts"],
      // 型宣言だけのファイル。実行される行が1つも無いので、数えると
      // 分母だけが膨らむ。テストの書きようも無い。
      exclude: ["electron/**/*.test.ts", "electron/type/**"],
      thresholds: {
        statements: 31,
        branches: 85,
        functions: 86,
        lines: 31,
      },
    },
  },
});

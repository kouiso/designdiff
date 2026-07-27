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
    // 2026-07-27 実測: statements 16.93 / branches 68.29 / functions 58.97 /
    // lines 16.93。目標の80%には遠い。まず実測値を下限に置いて、これ以上
    // 下がったら止まるようにする。80%へ引き上げる作業は別途追う。
    // 下限を下げて通すのは禁止。下がったら原因を直すこと。
    coverage: {
      provider: "v8",
      include: ["electron/**/*.ts"],
      exclude: ["electron/**/*.test.ts"],
      thresholds: {
        statements: 16,
        branches: 68,
        functions: 58,
        lines: 16,
      },
    },
  },
});

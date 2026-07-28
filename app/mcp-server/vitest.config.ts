import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@figdiff/shared": path.resolve(import.meta.dirname, "../../package/shared/src/index.ts"),
    },
  },
  test: {
    globals: true,
    // v8 coverage instrumentation adds meaningful overhead to the
    // sharp/pixelmatch-heavy tests in this package; the default 5000ms
    // vitest timeout is regularly exceeded under `test:coverage` on CI
    // runners (11 tests across 4 files timed out in the same run) even
    // though every test passes comfortably under `test` (no coverage).
    //
    // 2026-07-27 実測: `test:coverage` 下の最遅は verify_fix の 30.4 秒
    // (ファイル全体で 66.9 秒)。60 秒は最遅テストの約 2 倍しか余裕がない。
    // 撤去も短縮も現状ではできん。縮めたいなら先に verify_fix の実画像比較を
    // 軽くすること。数字を測らずにこの値だけ動かさんように。
    testTimeout: 60000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts", "src/pixelmatch.d.ts"],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});

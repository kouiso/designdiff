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
    testTimeout: 60000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts", "src/pixelmatch.d.ts"],
      thresholds: {
        statements: 77,
        branches: 77,
        functions: 75,
        lines: 77,
      },
    },
  },
});

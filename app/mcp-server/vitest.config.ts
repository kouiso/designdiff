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
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts", "src/pixelmatch.d.ts"],
    },
  },
});

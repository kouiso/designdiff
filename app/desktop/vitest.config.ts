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
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/__mock__/**",
        "src/test-fixture/**",
        "src/i18n/**",
        "src/env.d.ts",
        "src/main.tsx",
        "src/App.tsx",
        "src/lib/platform/web-adapter.ts",
        "src/lib/platform/platform-adapter.ts",
      ],
    },
  },
});

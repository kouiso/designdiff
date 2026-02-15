import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@tauri-apps/api/core": resolve(__dirname, "./src/__mock__/tauri.ts"),
      "@tauri-apps/plugin-store": resolve(__dirname, "./src/__mock__/tauri-store.ts"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/__mock__/setup.ts"],
    globals: true,
  },
});

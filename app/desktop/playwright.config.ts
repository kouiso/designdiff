import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  // 既定の html レポーターは実行後にサーバーを立ち上げようとする。CI では戻ってこないので開かせない。
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:1420",
    headless: true,
  },
  webServer: {
    command: "pnpm exec vite --config vite.web.config.ts --port 1420",
    port: 1420,
    reuseExistingServer: true,
    timeout: 30000,
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});

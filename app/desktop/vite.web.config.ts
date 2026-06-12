import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify("0.0.0-dev"),
  },
  build: {
    outDir: "dist/web",
  },
  server: {
    port: 5174,
  },
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const pkg: unknown = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf-8"));
const appVersion =
  typeof pkg === "object" && pkg !== null && "version" in pkg ? String(pkg.version) : "0.0.0";

// PostHog の公式リージョンホストだけを焼き込む。HTTP や未知の origin を許すと、
// ビルド設定のミスひとつで API key とイベントが平文/意図しない宛先へ送られる。
const ALLOWED_POSTHOG_HOSTS = ["https://us.i.posthog.com", "https://eu.i.posthog.com"];
const DEFAULT_POSTHOG_HOST = "https://eu.i.posthog.com";
const resolvePostHogHost = (raw: string | undefined): string => {
  if (!raw) return DEFAULT_POSTHOG_HOST;
  if (!ALLOWED_POSTHOG_HOSTS.includes(raw)) {
    console.warn(
      `[build] POSTHOG_HOST "${raw}" is not an allowlisted HTTPS origin; falling back to ${DEFAULT_POSTHOG_HOST}`,
    );
    return DEFAULT_POSTHOG_HOST;
  }
  return raw;
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      // 未設定なら空文字 = telemetry.ts が黙って no-op になる。renderer には配らん
      // (main 専用の define なので renderer バンドルに焼き込まれることは無い)。
      __POSTHOG_KEY__: JSON.stringify(process.env.POSTHOG_KEY ?? ""),
      __POSTHOG_HOST__: JSON.stringify(resolvePostHogHost(process.env.POSTHOG_HOST)),
    },
    build: {
      outDir: "dist/main",
      rollupOptions: {
        input: {
          main: resolve(__dirname, "electron/main.ts"),
        },
        external: ["@napi-rs/keyring"],
      },
    },
  },

  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist/preload",
      lib: {
        entry: resolve(__dirname, "electron/preload.ts"),
        formats: ["cjs"],
        fileName: () => "preload.cjs",
      },
      rollupOptions: {
        output: {
          entryFileNames: "preload.cjs",
        },
      },
    },
  },

  renderer: {
    root: ".",
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": resolve(__dirname, "./src"),
      },
    },
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
    },
    build: {
      outDir: "dist/renderer",
      rollupOptions: {
        input: {
          main: resolve(__dirname, "index.html"),
        },
      },
    },
    server: {
      port: 5173,
    },
  },
});

/**
 * esbuild configuration for Figma plugin
 * Bundles code.ts (plugin sandbox) and ui.ts (iframe UI) separately
 */

import * as esbuild from "esbuild";
import * as fs from "node:fs";
import * as path from "node:path";

const isWatch = process.argv.includes("--watch");

// Plugin sandbox code (runs in Figma's main thread)
const codeConfig = {
  entryPoints: ["src/code.ts"],
  bundle: true,
  outfile: "dist/code.js",
  format: "iife",
  target: "es2022",
  platform: "browser",
  sourcemap: false,
};

// UI code (runs in iframe)
const uiConfig = {
  entryPoints: ["src/ui.ts"],
  bundle: true,
  outfile: "dist/ui-bundle.js",
  format: "iife",
  target: "es2022",
  platform: "browser",
  sourcemap: false,
};

// Generate ui.html with inlined JS
function generateUiHtml() {
  const jsPath = path.resolve("dist/ui-bundle.js");
  if (!fs.existsSync(jsPath)) return;
  const js = fs.readFileSync(jsPath, "utf-8");

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: Inter, system-ui, -apple-system, sans-serif;
      font-size: 12px;
      color: #333;
      background: #fff;
    }
    .container { padding: 12px; }
    h2 { font-size: 14px; font-weight: 600; margin-bottom: 8px; }
    .section { margin-bottom: 12px; }
    .label { font-size: 11px; color: #666; margin-bottom: 4px; }
    .value { font-size: 12px; font-weight: 500; }
    .match-rate { font-size: 24px; font-weight: 700; text-align: center; padding: 16px; }
    .match-rate.good { color: #18A957; }
    .match-rate.warning { color: #F5A623; }
    .match-rate.bad { color: #E53935; }
    .diff-region { padding: 8px; border: 1px solid #E0E0E0; border-radius: 4px; margin-bottom: 6px; }
    .diff-region .name { font-weight: 600; }
    .diff-region .detail { font-size: 11px; color: #888; margin-top: 2px; }
    .css-block { background: #F5F5F5; padding: 8px; border-radius: 4px; font-family: monospace; font-size: 11px; white-space: pre-wrap; word-break: break-all; }
    .btn { display: block; width: 100%; padding: 8px; background: #0D99FF; color: #fff; border: none; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; text-align: center; margin-top: 8px; }
    .btn:hover { background: #0B85DE; }
    .btn-secondary { background: #F0F0F0; color: #333; }
    .btn-secondary:hover { background: #E0E0E0; }
    .dropzone { border: 2px dashed #CCC; border-radius: 8px; padding: 24px; text-align: center; color: #999; cursor: pointer; }
    .dropzone.active { border-color: #0D99FF; background: #F0F8FF; color: #0D99FF; }
    .node-info { background: #FAFAFA; padding: 8px; border-radius: 4px; margin-bottom: 6px; }
    .node-info .prop { display: flex; justify-content: space-between; padding: 2px 0; }
    .node-info .prop-name { color: #666; }
    .node-info .prop-value { font-weight: 500; font-family: monospace; }
    .hidden { display: none; }
    .tabs { display: flex; gap: 2px; margin-bottom: 12px; }
    .tab { flex: 1; padding: 6px; text-align: center; border: 1px solid #E0E0E0; border-radius: 4px; cursor: pointer; font-size: 11px; }
    .tab.active { background: #0D99FF; color: #fff; border-color: #0D99FF; }
  </style>
</head>
<body>
  <div class="container" id="app"></div>
  <script>${js}</script>
</body>
</html>`;

  fs.writeFileSync("dist/ui.html", html);
}

async function build() {
  fs.mkdirSync("dist", { recursive: true });

  if (isWatch) {
    const codeCtx = await esbuild.context(codeConfig);
    const uiCtx = await esbuild.context(uiConfig);

    await codeCtx.watch();

    // For UI, rebuild and regenerate HTML on change
    const uiPlugin = {
      name: "generate-html",
      setup(build) {
        build.onEnd(() => generateUiHtml());
      },
    };
    const uiWatchCtx = await esbuild.context({ ...uiConfig, plugins: [uiPlugin] });
    await uiWatchCtx.watch();

    console.info("Watching for changes...");
  } else {
    await esbuild.build(codeConfig);
    await esbuild.build(uiConfig);
    generateUiHtml();
    console.info("Build complete.");
  }
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});

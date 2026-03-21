/**
 * esbuild configuration for Chrome Extension
 * Bundles background.ts, content.ts, and popup.ts separately
 */

import * as esbuild from "esbuild";
import * as fs from "node:fs";
import * as path from "node:path";

const isWatch = process.argv.includes("--watch");

const sharedConfig = {
  bundle: true,
  target: "es2022",
  platform: "browser",
  sourcemap: isWatch,
  minify: !isWatch,
};

const entryPoints = [
  { entry: "src/background.ts", outfile: "dist/background.js" },
  { entry: "src/content.ts", outfile: "dist/content.js" },
  { entry: "src/popup.ts", outfile: "dist/popup.js" },
];

async function build() {
  // Create dist directory
  fs.mkdirSync("dist", { recursive: true });

  // Copy public files to dist
  const publicDir = "public";
  if (fs.existsSync(publicDir)) {
    for (const file of fs.readdirSync(publicDir)) {
      const src = path.join(publicDir, file);
      const dest = path.join("dist", file);
      if (fs.statSync(src).isFile()) {
        fs.copyFileSync(src, dest);
      } else if (fs.statSync(src).isDirectory()) {
        fs.cpSync(src, dest, { recursive: true });
      }
    }
  }

  // Build each entry point
  for (const { entry, outfile } of entryPoints) {
    if (!fs.existsSync(entry)) continue;

    if (isWatch) {
      const ctx = await esbuild.context({ ...sharedConfig, entryPoints: [entry], outfile });
      await ctx.watch();
    } else {
      await esbuild.build({ ...sharedConfig, entryPoints: [entry], outfile });
    }
  }

  // Generate popup.html
  generatePopupHtml();

  // Generate content.css
  generateContentCss();

  if (isWatch) {
    console.info("Watching for changes...");
  } else {
    console.info("Build complete.");
  }
}

function generatePopupHtml() {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { width: 320px; font-family: system-ui, -apple-system, sans-serif; font-size: 13px; color: #333; }
    .header { padding: 12px 16px; background: #1E1E1E; color: #fff; }
    .header h1 { font-size: 16px; font-weight: 700; }
    .header .subtitle { font-size: 11px; color: #999; margin-top: 2px; }
    .content { padding: 12px 16px; }
    .section { margin-bottom: 12px; }
    .label { font-size: 11px; color: #666; margin-bottom: 4px; font-weight: 600; }
    .input-group { display: flex; gap: 4px; }
    input[type="text"], input[type="file"] { flex: 1; padding: 6px 8px; border: 1px solid #DDD; border-radius: 4px; font-size: 12px; }
    .btn { display: block; width: 100%; padding: 8px; border: none; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; text-align: center; }
    .btn-primary { background: #0D99FF; color: #fff; }
    .btn-primary:hover { background: #0B85DE; }
    .btn-secondary { background: #F0F0F0; color: #333; margin-top: 6px; }
    .btn-secondary:hover { background: #E0E0E0; }
    .btn-danger { background: #E53935; color: #fff; margin-top: 6px; }
    .result { text-align: center; padding: 12px; }
    .match-rate { font-size: 28px; font-weight: 700; }
    .match-rate.good { color: #18A957; }
    .match-rate.warning { color: #F5A623; }
    .match-rate.bad { color: #E53935; }
    .stats { font-size: 11px; color: #888; margin-top: 4px; }
    .opacity-slider { width: 100%; margin-top: 4px; }
    .mode-select { display: flex; gap: 4px; flex-wrap: wrap; }
    .mode-btn { padding: 4px 8px; border: 1px solid #DDD; border-radius: 4px; font-size: 11px; cursor: pointer; background: #fff; }
    .mode-btn.active { background: #0D99FF; color: #fff; border-color: #0D99FF; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <div class="header">
    <h1>FigDiff</h1>
    <div class="subtitle">Design Comparison Tool</div>
  </div>
  <div class="content" id="app"></div>
  <script src="popup.js"></script>
</body>
</html>`;

  fs.writeFileSync("dist/popup.html", html);
}

function generateContentCss() {
  const css = `
.figdiff-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: 2147483646;
  pointer-events: none;
  opacity: 0.5;
  mix-blend-mode: difference;
}

.figdiff-overlay.draggable {
  pointer-events: auto;
  cursor: move;
  mix-blend-mode: normal;
}

.figdiff-overlay img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: top left;
}

.figdiff-controls {
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 2147483647;
  background: #1E1E1E;
  color: #fff;
  padding: 8px 12px;
  border-radius: 8px;
  font-family: system-ui, sans-serif;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  pointer-events: auto;
}

.figdiff-controls input[type="range"] {
  width: 80px;
  accent-color: #0D99FF;
}

.figdiff-controls button {
  background: none;
  border: none;
  color: #fff;
  cursor: pointer;
  font-size: 14px;
  padding: 2px 4px;
}

.figdiff-controls button:hover {
  color: #0D99FF;
}

.figdiff-controls .label {
  font-size: 10px;
  color: #999;
}
`;

  fs.writeFileSync("dist/content.css", css);
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});

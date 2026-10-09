// 9810-3055 png-v2 発火窓の性質を既存分類器で確かめる。
// 1) classifyGlyphEdgeRasterization: 前景/背景トークン一致で縁だけ違うか
// 2) ±2px 変位説明率
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const checkout = "/home/factory-user/dd-figma-path";
const { classifyGlyphEdgeRasterization } = await import(
  pathToFileURL(join(checkout, "package/shared/dist/signal/glyph-edge-raster.js")).href
);
const ctors = { Uint8ClampedArray, Uint8Array, Float32Array, Float64Array };
const load = async (dir) => {
  const { buffers, rest } = JSON.parse(await readFile(join(dir, "options.json"), "utf8"));
  const options = { ...rest };
  for (const [key, ctor] of Object.entries(buffers)) {
    const raw = await readFile(join(dir, `${key}.bin`));
    const C = ctors[ctor];
    options[key] = new C(raw.buffer, raw.byteOffset, raw.byteLength / C.BYTES_PER_ELEMENT);
  }
  return options;
};
const options = await load("/tmp/dd-dump/png-v2/9810-3055");
const { designPixels, screenshotPixels, width } = options;
const win = { x: 0, y: 151, w: 390, h: 22 };

const glyph = classifyGlyphEdgeRasterization(
  designPixels, screenshotPixels, width, options.height,
  { x: win.x, y: win.y, w: win.w, h: win.h },
);
console.log("glyphEdge:", JSON.stringify(glyph));

let big = 0, shiftOk = 0;
for (let y = win.y; y < win.y + win.h; y++)
  for (let x = win.x; x < win.x + win.w; x++) {
    const i = (y * width + x) * 4;
    const approx =
      (Math.abs(designPixels[i] - screenshotPixels[i]) +
        Math.abs(designPixels[i + 1] - screenshotPixels[i + 1]) +
        Math.abs(designPixels[i + 2] - screenshotPixels[i + 2])) / 3;
    if (approx <= 2) continue;
    big++;
    let found = false;
    outer: for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= options.height) continue;
        const j = (ny * width + nx) * 4;
        if (
          Math.abs(screenshotPixels[j] - designPixels[i]) <= 6 &&
          Math.abs(screenshotPixels[j + 1] - designPixels[i + 1]) <= 6 &&
          Math.abs(screenshotPixels[j + 2] - designPixels[i + 2]) <= 6
        ) { found = true; break outer; }
      }
    if (found) shiftOk++;
  }
console.log(`big=${big} shiftExplainable(±2px,tol6)=${((100 * shiftOk) / big).toFixed(1)}%`);

// 窓内の画素値ヒストグラム的な把握: design/shot それぞれの代表値
const hist = (px) => {
  const m = new Map();
  for (let y = win.y; y < win.y + win.h; y++)
    for (let x = win.x; x < win.x + win.w; x++) {
      const i = (y * width + x) * 4;
      const key = `${px[i]},${px[i + 1]},${px[i + 2]}`;
      m.set(key, (m.get(key) ?? 0) + 1);
    }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
};
console.log("design top colors:", hist(designPixels));
console.log("shot   top colors:", hist(screenshotPixels));

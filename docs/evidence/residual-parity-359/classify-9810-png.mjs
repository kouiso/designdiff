// 9810-3055 png-v2 の発火窓 (0,151,390x22) を正本と突き合わせる。
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire("/home/factory-user/dd-figma-path/package.json");
const {
  PNG,
} = require("/home/factory-user/dd-figma-path/node_modules/.pnpm/pngjs@7.0.0/node_modules/pngjs/lib/png.js");
const HM = "/home/factory-user/horsemanager/doc/evidence/pixel-perfect/canonical";
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
const loadPng = async (path) => {
  const png = PNG.sync.read(await readFile(path));
  return png.data;
};
const win = { x: 0, y: 151, w: 390, h: 22 };
const stats = (a, b, w) => {
  let count = 0,
    changed = 0,
    sum = 0;
  for (let y = win.y; y < win.y + win.h; y++)
    for (let x = win.x; x < win.x + win.w; x++) {
      const i = (y * w + x) * 4;
      const d =
        (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
      if (d > 2) changed++;
      sum += d;
      count++;
    }
  return `changed=${((100 * changed) / count).toFixed(1)}% mean|d|=${(sum / count).toFixed(2)}`;
};

const dump = await load("/tmp/dd-dump/png-v2/9810-3055");
const orig = await loadPng(join(HM, "originals", "9810-3055.png"));
const cap = await loadPng(join(HM, "captures", "9810-3055", "capture.png"));
console.info("A dumpDesign vs canonOriginal:", stats(dump.designPixels, orig, 390));
console.info("B dumpShot   vs canonCapture:", stats(dump.screenshotPixels, cap, 390));
console.info("C canonOrig  vs canonCapture:", stats(orig, cap, 390));
console.info(
  "D dumpDesign vs dumpShot     :",
  stats(dump.designPixels, dump.screenshotPixels, 390),
);
// 帯の上下の様子: design/shot それぞれで y145-175 の代表色
for (const [name, px] of [
  ["design", dump.designPixels],
  ["shot", dump.screenshotPixels],
  ["canonOrig", orig],
  ["canonCap", cap],
]) {
  const rows = [];
  for (const y of [150, 155, 160, 165, 170, 173]) {
    const i = (y * 390 + 200) * 4;
    rows.push(`y${y}=(${px[i]},${px[i + 1]},${px[i + 2]})`);
  }
  console.info(name, rows.join(" "));
}

// pixelmatch を dump 画素に直接かけ、発火窓内の大差分画素が
// (a) diff 赤 (b) AA 黄 (c) 未マーク のどれに分類されるかを数える。
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire("/home/factory-user/dd-figma-path/package.json");
const pixelmatchModule = require("/home/factory-user/dd-figma-path/node_modules/.pnpm/pixelmatch@7.2.0/node_modules/pixelmatch/index.js");
const pixelmatch = pixelmatchModule.default ?? pixelmatchModule;

const ctors = { Uint8ClampedArray, Uint8Array, Float32Array, Float64Array };
const load = async (dir) => {
  const { buffers, rest } = JSON.parse(await readFile(join(dir, "options.json"), "utf8"));
  const options = { ...rest };
  delete options.resolvedAlignment;
  for (const [key, ctor] of Object.entries(buffers)) {
    const raw = await readFile(join(dir, `${key}.bin`));
    const C = ctors[ctor];
    options[key] = new C(raw.buffer, raw.byteOffset, raw.byteLength / C.BYTES_PER_ELEMENT);
  }
  return options;
};

const windows = {
  "9705-6069": { x: 0, y: 302, w: 390, h: 22 },
  "9804-4204": { x: 292, y: 259, w: 49, h: 87 },
  "9810-3055": { x: 0, y: 129, w: 390, h: 22 },
  "9892-8063": { x: 0, y: 475, w: 390, h: 22 },
};

for (const node of process.argv.slice(2)) {
  const o = await load(join("/tmp/dd-dump/live-v3", node));
  const { designPixels, screenshotPixels, width, height } = o;
  const out = new Uint8ClampedArray(width * height * 4);
  const diffCount = pixelmatch(designPixels, screenshotPixels, out, width, height, {
    threshold: 0.1,
    diffMask: true,
    checkerboard: false,
  });
  const win = windows[node];
  let big = 0,
    red = 0,
    yellow = 0,
    unmarked = 0,
    other = 0;
  for (let y = win.y; y < win.y + win.h; y++) {
    for (let x = win.x; x < win.x + win.w; x++) {
      const i = (y * width + x) * 4;
      const approx =
        (Math.abs(designPixels[i] - screenshotPixels[i]) +
          Math.abs(designPixels[i + 1] - screenshotPixels[i + 1]) +
          Math.abs(designPixels[i + 2] - screenshotPixels[i + 2])) /
        3;
      if (approx <= 2) continue;
      big += 1;
      const r = out[i],
        g = out[i + 1],
        b = out[i + 2],
        a = out[i + 3];
      if (a === 0) unmarked += 1;
      else if (r === 255 && g === 0 && b === 0) red += 1;
      else if (r === 255 && g === 255 && b === 0) yellow += 1;
      else other += 1;
    }
  }
  console.info(
    `${node} diffCount=${diffCount} window big=${big} red(diff)=${red} yellow(AA)=${yellow} unmarked=${unmarked} other=${other}`,
  );
}

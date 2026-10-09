// 発火窓内の「大きく違う画素」が、±2px 以内の平行移動で説明できるかを調べる。
// ずれ由来 (displacement, 既に許容済みの原因) なら design の色が shot の近傍に
// そのまま存在するはず。コンテンツ欠落・色違いなら近傍にも無い。
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const checkout = "/home/factory-user/dd-figma-path";
const { buildDiffReport } = await import(
  pathToFileURL(join(checkout, "app/mcp-server/dist/service/diff-report-builder.js")).href
);
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

const near = (px, w, h, x, y, r, g, b, tol) => {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx,
        ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const i = (ny * w + nx) * 4;
      if (
        Math.abs(px[i] - r) <= tol &&
        Math.abs(px[i + 1] - g) <= tol &&
        Math.abs(px[i + 2] - b) <= tol
      )
        return true;
    }
  }
  return false;
};

for (const node of process.argv.slice(2)) {
  const options = await load(join("/tmp/dd-dump/live-v3", node));
  const report = buildDiffReport(options);
  const issue = report.issues.find((i) => i.evidence?.signal === "residual_color_drift");
  if (!issue) {
    console.info(node, "no residual issue");
    continue;
  }
  const win = issue.bbox;
  const { designPixels, screenshotPixels, diffMask, perceptibleMask, width, height } = options;
  let big = 0,
    shiftOk = 0,
    inDiffMask = 0,
    inPerc = 0;
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
      const mi = y * width + x;
      if (diffMask?.[mi]) inDiffMask += 1;
      if (perceptibleMask?.[mi]) inPerc += 1;
      // design 側の色が shot の ±2px 内に存在するか (ずれ説明可能)
      if (
        near(
          screenshotPixels,
          width,
          height,
          x,
          y,
          designPixels[i],
          designPixels[i + 1],
          designPixels[i + 2],
          12,
        )
      )
        shiftOk += 1;
    }
  }
  console.info(
    `${node} window=(${win.x},${win.y},${win.w}x${win.h}) bigDiffPx=${big} shiftExplainable=${((100 * shiftOk) / big).toFixed(1)}% inDiffMask=${((100 * inDiffMask) / big).toFixed(1)}% inPerceptible=${((100 * inPerc) / big).toFixed(1)}%`,
  );
}

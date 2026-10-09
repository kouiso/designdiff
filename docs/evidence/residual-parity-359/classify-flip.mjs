// 4件の PASS→FAIL フリップ画面について、発火窓を canonical ground truth
// (figma original PNG = 設計正本, capture.png = 実装正本 @ 2026-10-01) と突き合わせ、
// 残差発火が真陽性かどうかを分類する。
//
// 判定ロジック:
//   C = canonicalOriginal vs canonicalCapture (正本同士の design-vs-実装 差)
//   C が窓内で大きい → 実装が設計から実際に乖離 → TRUE POSITIVE
//   C が静かで D(dump design vs dump shot) が大きい → 正本以降に Figma 側が
//   更新された可能性 (design-drift confound)。その場合は A(dumpDesign vs
//   canonicalOriginal) を見て確認する。
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire("/home/factory-user/dd-figma-path/package.json");
const { PNG } = require(
  "/home/factory-user/dd-figma-path/node_modules/.pnpm/pngjs@7.0.0/node_modules/pngjs/lib/png.js"
);

const checkout = "/home/factory-user/dd-figma-path";
const { buildDiffReport } = await import(
  pathToFileURL(join(checkout, "app/mcp-server/dist/service/diff-report-builder.js")).href
);

const HM = "/home/factory-user/horsemanager/doc/evidence/pixel-perfect/canonical";
const ctors = { Uint8ClampedArray, Uint8Array, Float32Array, Float64Array };

const loadDump = async (dir) => {
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

const loadPng = async (path) => {
  const png = PNG.sync.read(await readFile(path));
  return { data: png.data, width: png.width, height: png.height };
};

// 窓内の mean|ΔRGB|・変化画素率・最大チャネル差を返す
const windowStats = (a, b, widthA, widthB, win) => {
  let count = 0, changed = 0, sum = 0, maxCh = 0;
  for (let y = win.y; y < win.y + win.h; y++) {
    for (let x = win.x; x < win.x + win.w; x++) {
      const ia = (y * widthA + x) * 4;
      const ib = (y * widthB + x) * 4;
      const dr = Math.abs(a[ia] - b[ib]);
      const dg = Math.abs(a[ia + 1] - b[ib + 1]);
      const db = Math.abs(a[ia + 2] - b[ib + 2]);
      const m = Math.max(dr, dg, db);
      if (m > maxCh) maxCh = m;
      const approx = (dr + dg + db) / 3;
      if (approx > 2) changed += 1;
      sum += approx;
      count += 1;
    }
  }
  return { px: count, changedPct: (100 * changed) / count, meanAbs: sum / count, maxCh };
};

const fmt = (s) =>
  `px=${s.px} changed=${s.changedPct.toFixed(1)}% mean|d|=${s.meanAbs.toFixed(2)} maxCh=${s.maxCh}`;

const nodes = process.argv.slice(2);
for (const node of nodes) {
  const options = await loadDump(join("/tmp/dd-dump/live-v3", node));
  const report = buildDiffReport(options);
  const issue = report.issues.find((i) => i.evidence?.signal === "residual_color_drift");
  if (!issue) {
    console.log(`${node}: no residual issue (live-v3)`);
    continue;
  }
  const win = issue.bbox;
  const orig = await loadPng(join(HM, "originals", `${node}.png`));
  const cap = await loadPng(join(HM, "captures", node, "capture.png"));
  console.log(
    `${node} window=(${win.x},${win.y},${win.w}x${win.h}) residual=${issue.evidence.actual.toFixed(2)}`
  );
  console.log(
    `  dims: dump=${options.width}x${options.height} orig=${orig.width}x${orig.height} capture=${cap.width}x${cap.height}`
  );
  const w = Math.min(options.width, orig.width, cap.width);
  const h = Math.min(options.height, orig.height, cap.height);
  const winClamped = {
    x: win.x,
    y: win.y,
    w: Math.min(win.w, w - win.x),
    h: Math.min(win.h, h - win.y),
  };
  const A = windowStats(options.designPixels, orig.data, options.width, orig.width, winClamped);
  const B = windowStats(options.screenshotPixels, cap.data, options.width, cap.width, winClamped);
  const C = windowStats(orig.data, cap.data, orig.width, cap.width, winClamped);
  const D = windowStats(options.designPixels, options.screenshotPixels, options.width, options.width, winClamped);
  console.log(`  A dumpDesign  vs canonOriginal : ${fmt(A)}`);
  console.log(`  B dumpShot    vs canonCapture  : ${fmt(B)}`);
  console.log(`  C canonOrigin vs canonCapture  : ${fmt(C)}  <- ground-truth design-vs-impl`);
  console.log(`  D dumpDesign  vs dumpShot      : ${fmt(D)}  <- what residual measured`);
  const truePositive = C.changedPct > 10 && C.meanAbs > 2;
  const designDrift = A.changedPct > 10 && A.meanAbs > 2;
  const implDrift = B.changedPct > 10 && B.meanAbs > 2;
  let verdict;
  if (truePositive && !designDrift && !implDrift) verdict = "TRUE_POSITIVE (canonical design-vs-impl gap, unchanged since canonical)";
  else if (truePositive && (designDrift || implDrift)) verdict = "TRUE_POSITIVE_BUT_MOVED (canonical gap exists; pixels also changed since canonical)";
  else if (!truePositive && designDrift) verdict = "DESIGN_DRIFT_CONFOUND (canonical was clean; Figma design changed since)";
  else if (!truePositive && implDrift) verdict = "IMPL_CHANGED_SINCE_CANONICAL (canonical was clean; implementation render changed)";
  else verdict = "FALSE_ALARM_CANDIDATE (canonical clean, dump pair loud, neither A nor B explains)";
  console.log(`  => ${verdict}`);
}

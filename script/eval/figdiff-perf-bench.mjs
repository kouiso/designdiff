#!/usr/bin/env node
/**
 * compareImages() の壁時計ベンチ — SP / PC / 縦長フレームで p50/p95 を測る。
 *
 * figdiff-cluster-bench.mjs が「実検体ペアで判定精度」を見るのに対し、
 * こちらは「合成検体で処理時間」を見る。生成コストを除外するため、
 * 検体 PNG は起動時に1回だけ作って使い回す (fetch 経路の計測対象は
 * デコード済みの比較コアであり、ネットワーク揺れを性能値に混ぜない)。
 * 実 Figma API の fetch 時間は credentials 依存なので対象外 — 取得側は
 * `designLoad` (file read + base64) を代理ステージとして別途記録する。
 *
 * Usage:
 *   node script/eval/figdiff-perf-bench.mjs
 *
 * Optional env:
 *   FIGDIFF_MCP_DIST        — @figdiff/mcp-server の dist (default: app/mcp-server/dist)
 *   FIGDIFF_PERF_ITERATIONS — 各プロファイルの反復回数 (default 20。p95 が意味を持つ下限)
 *   FIGDIFF_PERF_OUT        — 結果 JSON の出力先 (default: docs/evidence/perf-bench.json)
 *   FIGDIFF_PERF_P95_MS     — 設定時は p95 閾値ガード。超過プロファイルがあれば exit 1
 *   FIGDIFF_PERF_P95_MS_<PROFILE> — プロファイル別の上書き (例: FIGDIFF_PERF_P95_MS_TALL=10000)
 *   FIGDIFF_ANTIALIAS_BLUR_SIGMA — compareImages に渡す AA blur (default: unset)
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const requireFromMcp = createRequire(join(REPO, "app/mcp-server/package.json"));
const sharp = requireFromMcp("sharp");

const MCP_DIST = process.env.FIGDIFF_MCP_DIST ?? join(REPO, "app/mcp-server/dist");
const SERVICE_ENTRY = join(MCP_DIST, "service/image-compare-service.js");
if (!existsSync(SERVICE_ENTRY)) {
  console.error(
    `MCP server build not found at ${SERVICE_ENTRY}.\n` +
      "Run `pnpm --filter @figdiff/mcp-server build` first, or set FIGDIFF_MCP_DIST.",
  );
  process.exit(2);
}

const ITERATIONS = Number(process.env.FIGDIFF_PERF_ITERATIONS ?? 20);
if (!Number.isInteger(ITERATIONS) || ITERATIONS < 1) {
  console.error(`FIGDIFF_PERF_ITERATIONS must be a positive integer, got ${ITERATIONS}`);
  process.exit(2);
}
const OUT_PATH = process.env.FIGDIFF_PERF_OUT ?? join(REPO, "docs/evidence/perf-bench.json");
const P95_GATE_MS = process.env.FIGDIFF_PERF_P95_MS
  ? Number(process.env.FIGDIFF_PERF_P95_MS)
  : null;

// SP / PC / 縦長 — Issue #251 の対象フォルダ。大きさがクラスタ負荷の主変数なので、
// 内容は決定的な矩形グリッド + 注入差分で揃える (乱数は使わない)。
const PROFILES = [
  { name: "sp", width: 375, height: 812 },
  { name: "pc", width: 1440, height: 900 },
  { name: "tall", width: 1440, height: 4000 },
];

const cellColor = (x, y) => {
  const palette = ["#FFFFFF", "#F3F4F6", "#18A957", "#2563EB", "#111827", "#F59E0B"];
  return palette[(x * 31 + y * 17) % palette.length];
};

// グリッド状の色セル + 枠線で「実際のUIっぽい」画像を組み立てる。
// screenshot 側には決定的な差分矩形を乗せる (セル境界とはずらした位置)。
const buildPair = async ({ name, width, height }) => {
  const cell = 40;
  const designRects = [];
  const shotRects = [];
  for (let y = 0; y < height; y += cell) {
    for (let x = 0; x < width; x += cell) {
      const color = cellColor(x / cell, y / cell);
      designRects.push(
        `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${color}" stroke="#E5E7EB" stroke-width="1"/>`,
      );
      const isDiff = (x / cell + 2 * (y / cell)) % 23 === 0;
      shotRects.push(
        `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${isDiff ? "#EF4444" : color}" stroke="#E5E7EB" stroke-width="1"/>`,
      );
    }
  }
  const svgWrap = (rects) =>
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${rects.join("")}</svg>`,
    );
  const dir = join(tmpdir(), `figdiff-perf-${process.pid}`);
  await mkdir(dir, { recursive: true });
  const designPath = join(dir, `${name}-design.png`);
  const shotPath = join(dir, `${name}-shot.png`);
  await sharp(svgWrap(designRects)).png().toFile(designPath);
  await sharp(svgWrap(shotRects)).png().toFile(shotPath);
  return { designPath, shotPath };
};

const percentile = (samples, p) => {
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
  return sorted[idx];
};

const { compareImages } = await import(pathToFileURL(SERVICE_ENTRY).href);

const report = {
  generatedAt: new Date().toISOString(),
  iterations: ITERATIONS,
  p95GateMs: P95_GATE_MS,
  profiles: {},
};

for (const profile of PROFILES) {
  const { designPath, shotPath } = await buildPair(profile);

  // fetch の代理: 実環境での design 画像取得に対応するコストはディスク読み +
  // base64 化。比較コアと分けて記録する (ネットワークは測定対象外)。
  const loadSamples = [];
  let designBase64 = "";
  let shotBase64 = "";
  for (let i = 0; i < ITERATIONS; i += 1) {
    const t0 = performance.now();
    const design = (await readFile(designPath)).toString("base64");
    const shot = (await readFile(shotPath)).toString("base64");
    loadSamples.push(performance.now() - t0);
    designBase64 = design;
    shotBase64 = shot;
  }

  // ウォームアップ: sharp スレッドプールと V8 JIT の初回コストは
  // 定常値ではないので捨てる。
  await compareImages({ designBase64, screenshotBase64: shotBase64, threshold: 0.1 });

  const compareSamples = [];
  let lastResult = null;
  for (let i = 0; i < ITERATIONS; i += 1) {
    const t0 = performance.now();
    lastResult = await compareImages({
      designBase64,
      screenshotBase64: shotBase64,
      threshold: 0.1,
    });
    compareSamples.push(performance.now() - t0);
  }

  const stats = (samples) => ({
    min: Math.min(...samples),
    p50: percentile(samples, 0.5),
    p95: percentile(samples, 0.95),
    max: Math.max(...samples),
    mean: samples.reduce((a, b) => a + b, 0) / samples.length,
  });

  report.profiles[profile.name] = {
    width: profile.width,
    height: profile.height,
    pixels: profile.width * profile.height,
    designLoad: stats(loadSamples),
    compare: stats(compareSamples),
    matchRate: lastResult?.matchRate ?? null,
    diffRegions: lastResult?.diffRegions?.length ?? lastResult?.diff_regions?.length ?? null,
  };

  const c = report.profiles[profile.name].compare;
  console.info(
    `${profile.name.padEnd(5)} ${profile.width}x${profile.height} ` +
      `p50=${c.p50.toFixed(0)}ms p95=${c.p95.toFixed(0)}ms max=${c.max.toFixed(0)}ms ` +
      `(load p50=${report.profiles[profile.name].designLoad.p50.toFixed(0)}ms, ` +
      `matchRate=${report.profiles[profile.name].matchRate})`,
  );
}

await mkdir(dirname(OUT_PATH), { recursive: true });
await writeFile(OUT_PATH, `${JSON.stringify(report, null, 2)}\n`);

let overGate = false;
for (const [name, p] of Object.entries(report.profiles)) {
  const gate = process.env[`FIGDIFF_PERF_P95_MS_${name.toUpperCase()}`]
    ? Number(process.env[`FIGDIFF_PERF_P95_MS_${name.toUpperCase()}`])
    : P95_GATE_MS;
  p.p95GateMs = gate;
  if (gate !== null && p.compare.p95 > gate) {
    console.error(`GATE FAIL: ${name} p95 ${p.compare.p95.toFixed(0)}ms > ${gate}ms`);
    overGate = true;
  }
}
if (P95_GATE_MS !== null && !overGate) {
  const gates = Object.entries(report.profiles)
    .map(([n, p]) => `${n}=${p.p95GateMs}ms`)
    .join(" ");
  console.info(`p95 gates (${gates}): all profiles within budget`);
}
console.info(`report: ${OUT_PATH}`);
if (overGate) process.exitCode = 1;

#!/usr/bin/env node
/**
 * designdiff capability eval runner — vs sample-corporate.
 *
 * Invokes designdiff's compareImages() service directly (bypassing MCP protocol
 * overhead; tests the same core diff logic that compare_design tool wraps).
 *
 * Usage:
 *   # Run from anywhere; resolves the in-repo MCP server build relative to this script.
 *   FIGDIFF_SCREENSHOTS=/path/to/sample-corporate/astro/test/screenshots \
 *     node scripts/eval/figdiff-cluster-bench.mjs
 *
 * Required env:
 *   FIGDIFF_SCREENSHOTS  — directory containing `figma/<page>.png` + `astro/<page>.png` pairs
 *
 * Optional env:
 *   FIGDIFF_MCP_DIST     — override path to @figdiff/mcp-server dist (default: ../../app/mcp-server/dist)
 *   FIGDIFF_THRESHOLD    — pixelmatch threshold (default 0.1)
 *   FIGDIFF_OUT          — output JSON path (default /tmp/figdiff-eval-results.json)
 */

import { existsSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MCP_BUILD_DIR = process.env.FIGDIFF_MCP_DIST ?? resolve(HERE, "../../app/mcp-server/dist");
const SERVICE_ENTRY = resolve(MCP_BUILD_DIR, "service/image-compare-service.js");
if (!existsSync(SERVICE_ENTRY)) {
  console.error(
    `MCP server build not found at ${SERVICE_ENTRY}.\n` +
      "Run `pnpm --filter @figdiff/mcp-server build` first, or set FIGDIFF_MCP_DIST to a built dist/ dir.",
  );
  process.exit(2);
}
// Use a file:// URL so dynamic import works on Windows where raw absolute
// paths (C:\...) aren't valid ESM specifiers.
const SELF = fileURLToPath(import.meta.url);
const THRESHOLD = process.env.FIGDIFF_THRESHOLD ? Number(process.env.FIGDIFF_THRESHOLD) : 0.1;
const PAGE_TIMEOUT_MS = process.env.FIGDIFF_PAGE_TIMEOUT_MS
  ? Number(process.env.FIGDIFF_PAGE_TIMEOUT_MS)
  : 90_000;
const OUT = process.env.FIGDIFF_OUT ?? join(tmpdir(), "figdiff-eval-results.json");

if (process.env.FIGDIFF_EVAL_WORKER === "1") {
  const page = JSON.parse(process.env.FIGDIFF_EVAL_PAGE ?? "{}");
  const result = await comparePage(page);
  await writeFile(process.env.FIGDIFF_EVAL_PAGE_OUT, JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

const BASE = process.env.FIGDIFF_SCREENSHOTS;
if (!BASE) {
  console.error(
    "FIGDIFF_SCREENSHOTS env var is required (path to a directory containing figma/ and astro/ subdirs).",
  );
  process.exit(2);
}
const PAGES = [
  { name: "top-pc", figma: `${BASE}/figma/top-pc.png`, impl: `${BASE}/astro/top-pc.png` },
  { name: "top-sp", figma: `${BASE}/figma/top-sp.png`, impl: `${BASE}/astro/top-sp.png` },
  { name: "about-pc", figma: `${BASE}/figma/about-pc.png`, impl: `${BASE}/astro/about-pc.png` },
  { name: "about-sp", figma: `${BASE}/figma/about-sp.png`, impl: `${BASE}/astro/about-sp.png` },
  {
    name: "service-pc",
    figma: `${BASE}/figma/service-pc.png`,
    impl: `${BASE}/astro/service-pc.png`,
  },
  {
    name: "service-sp",
    figma: `${BASE}/figma/service-sp.png`,
    impl: `${BASE}/astro/service-sp.png`,
  },
  {
    name: "recruit-pc",
    figma: `${BASE}/figma/recruit-pc.png`,
    impl: `${BASE}/astro/recruit-pc.png`,
  },
  {
    name: "recruit-sp",
    figma: `${BASE}/figma/recruit-sp.png`,
    impl: `${BASE}/astro/recruit-sp.png`,
  },
  { name: "news-pc", figma: `${BASE}/figma/news-pc.png`, impl: `${BASE}/astro/news-pc.png` },
  { name: "news-sp", figma: `${BASE}/figma/news-sp.png`, impl: `${BASE}/astro/news-sp.png` },
  {
    name: "contact-pc",
    figma: `${BASE}/figma/contact-pc.png`,
    impl: `${BASE}/astro/contact-pc.png`,
  },
  {
    name: "contact-sp",
    figma: `${BASE}/figma/contact-sp.png`,
    impl: `${BASE}/astro/contact-sp.png`,
  },
];

const selectedPages = new Set(
  (process.env.FIGDIFF_PAGES ?? "")
    .split(",")
    .map((page) => page.trim())
    .filter(Boolean),
);
const pages =
  selectedPages.size === 0 ? PAGES : PAGES.filter((page) => selectedPages.has(page.name));
if (pages.length === 0) {
  console.error("No pages selected. Check FIGDIFF_PAGES.");
  process.exit(2);
}

const memStart = process.memoryUsage();
const startAll = performance.now();
const results = [];

for (const page of pages) {
  const pageResult = await runPageWorker(page);
  results.push(pageResult);
  if (pageResult.ok) {
    process.stdout.write(
      `✓ ${page.name}: match_rate=${pageResult.result.matchRate}% regions=${pageResult.result.diffRegions?.length ?? 0} t=${pageResult.wall_ms}ms\n`,
    );
  } else {
    process.stdout.write(`✗ ${page.name}: ${pageResult.error}\n`);
  }
}

const endAll = performance.now();
const memEnd = process.memoryUsage();

const summary = {
  ran_at: new Date().toISOString(),
  threshold: THRESHOLD,
  page_timeout_ms: PAGE_TIMEOUT_MS,
  pages: results.length,
  ok_count: results.filter((r) => r.ok).length,
  total_wall_ms: Math.round(endAll - startAll),
  rss_start_mb: Math.round(memStart.rss / 1024 / 1024),
  rss_end_mb: Math.round(memEnd.rss / 1024 / 1024),
  results,
};

const failedCount = summary.pages - summary.ok_count;
await writeFile(OUT, JSON.stringify(summary, null, 2));
process.stdout.write(`\nResults: ${OUT}\n`);
process.stdout.write(
  `Total: ${summary.total_wall_ms}ms, RSS ${summary.rss_start_mb} → ${summary.rss_end_mb}MB\n`,
);
if (failedCount > 0) {
  // Fail-loud so CI / automation never reports a green run on a partially-broken
  // benchmark. ok_count is also in the JSON for programmatic callers.
  process.stderr.write(`${failedCount} of ${summary.pages} pages failed; exiting non-zero.\n`);
  process.exit(1);
}

async function runPageWorker(page) {
  const pageOut = join(tmpdir(), `figdiff-eval-${process.pid}-${page.name}.json`);
  const startedAt = performance.now();
  const child = spawn(process.execPath, [SELF], {
    env: {
      ...process.env,
      FIGDIFF_EVAL_WORKER: "1",
      FIGDIFF_EVAL_PAGE: JSON.stringify(page),
      FIGDIFF_EVAL_PAGE_OUT: pageOut,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, PAGE_TIMEOUT_MS);

  const code = await new Promise((resolveCode) => {
    child.on("close", resolveCode);
  });
  clearTimeout(timeout);

  if (timedOut) {
    await unlink(pageOut).catch(() => undefined);
    return {
      page: page.name,
      ok: false,
      wall_ms: Math.round(performance.now() - startedAt),
      error: `timeout after ${PAGE_TIMEOUT_MS}ms`,
      stdout,
      stderr,
    };
  }

  try {
    const result = JSON.parse(await readFile(pageOut, "utf8"));
    await unlink(pageOut).catch(() => undefined);
    return result;
  } catch (e) {
    return {
      page: page.name,
      ok: false,
      wall_ms: Math.round(performance.now() - startedAt),
      error: `worker exited ${code}; ${String(e)}`,
      stdout,
      stderr,
    };
  }
}

async function comparePage(page) {
  const t0 = performance.now();
  const peakMemBefore = process.memoryUsage().rss;
  try {
    const { compareImages } = await import(pathToFileURL(SERVICE_ENTRY).href);
    const designBase64 = (await readFile(page.figma)).toString("base64");
    const screenshotBase64 = (await readFile(page.impl)).toString("base64");
    const result = await compareImages({
      designBase64,
      screenshotBase64,
      threshold: THRESHOLD,
    });
    const t1 = performance.now();
    const peakMemAfter = process.memoryUsage().rss;

    const diffImageSize = result.diffImageBase64?.length ?? 0;
    const { diffImageBase64, ...rest } = result;
    const worstGridCells = (rest.gridSummary?.cells ?? [])
      .filter((cell) => cell.diffPixels > 0)
      .sort((a, b) => b.diffPixels - a.diffPixels)
      .slice(0, 5)
      .map(({ row, col, x, y, width, height, matchRate, diffPixels }) => ({
        row,
        col,
        x,
        y,
        width,
        height,
        matchRate,
        diffPixels,
      }));

    return {
      page: page.name,
      ok: true,
      wall_ms: Math.round(t1 - t0),
      rss_delta_mb: Math.round((peakMemAfter - peakMemBefore) / 1024 / 1024),
      diff_image_base64_chars: diffImageSize,
      worst_grid_cells: worstGridCells,
      result: rest,
    };
  } catch (e) {
    const t1 = performance.now();
    return {
      page: page.name,
      ok: false,
      wall_ms: Math.round(t1 - t0),
      error: String(e),
    };
  }
}

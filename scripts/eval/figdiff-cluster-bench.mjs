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

import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MCP_BUILD_DIR = process.env.FIGDIFF_MCP_DIST ?? resolve(HERE, "../../app/mcp-server/dist");
const { compareImages } = await import(`${MCP_BUILD_DIR}/service/image-compare-service.js`);

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

const THRESHOLD = process.env.FIGDIFF_THRESHOLD ? Number(process.env.FIGDIFF_THRESHOLD) : 0.1;

const memStart = process.memoryUsage();
const startAll = performance.now();
const results = [];

for (const page of PAGES) {
  const t0 = performance.now();
  const peakMemBefore = process.memoryUsage().rss;
  try {
    const designBase64 = (await readFile(page.figma)).toString("base64");
    const screenshotBase64 = (await readFile(page.impl)).toString("base64");
    const result = await compareImages({
      designBase64,
      screenshotBase64,
      threshold: THRESHOLD,
    });
    const t1 = performance.now();
    const peakMemAfter = process.memoryUsage().rss;

    // Strip the heavy base64 diff image so JSON stays readable; keep size.
    const diffImageSize = result.diffImageBase64?.length ?? 0;
    const { diffImageBase64, ...rest } = result;

    results.push({
      page: page.name,
      ok: true,
      wall_ms: Math.round(t1 - t0),
      rss_delta_mb: Math.round((peakMemAfter - peakMemBefore) / 1024 / 1024),
      diff_image_base64_chars: diffImageSize,
      result: rest,
    });
    process.stdout.write(
      `✓ ${page.name}: match_rate=${rest.matchRate}% regions=${rest.diffRegions?.length ?? 0} t=${Math.round(t1 - t0)}ms\n`,
    );
  } catch (e) {
    const t1 = performance.now();
    results.push({
      page: page.name,
      ok: false,
      wall_ms: Math.round(t1 - t0),
      error: String(e),
    });
    process.stdout.write(`✗ ${page.name}: ${e}\n`);
  }
}

const endAll = performance.now();
const memEnd = process.memoryUsage();

const summary = {
  ran_at: new Date().toISOString(),
  threshold: THRESHOLD,
  pages: results.length,
  ok_count: results.filter((r) => r.ok).length,
  total_wall_ms: Math.round(endAll - startAll),
  rss_start_mb: Math.round(memStart.rss / 1024 / 1024),
  rss_end_mb: Math.round(memEnd.rss / 1024 / 1024),
  results,
};

const out = process.env.FIGDIFF_OUT ?? "/tmp/figdiff-eval-results.json";
await writeFile(out, JSON.stringify(summary, null, 2));
process.stdout.write(`\nResults: ${out}\n`);
process.stdout.write(
  `Total: ${summary.total_wall_ms}ms, RSS ${summary.rss_start_mb} → ${summary.rss_end_mb}MB\n`,
);

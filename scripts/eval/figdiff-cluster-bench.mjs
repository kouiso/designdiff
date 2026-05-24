#!/usr/bin/env node
/**
 * designdiff capability eval runner — vs sample-corporate.
 *
 * Invokes designdiff's compareImages() service directly (bypassing MCP protocol
 * overhead; tests the same core diff logic that compare_design tool wraps).
 *
 * Usage:
 *   # Run from anywhere; resolves the in-repo MCP server build relative to this script.
 *   FIGDIFF_SCREENSHOTS=/path/to/sample-corporate/test/screenshots \
 *     node scripts/eval/figdiff-cluster-bench.mjs
 *   FIGDIFF_MANIFEST=/path/to/figdiff-manifest.json \
 *     FIGDIFF_MD_OUT=/tmp/figdiff-eval.md \
 *     node scripts/eval/figdiff-cluster-bench.mjs
 *
 * Required env:
 *   FIGDIFF_SCREENSHOTS  — directory containing `figma/<page>.png` + `<implDir>/<page>.png` pairs
 *   or
 *   FIGDIFF_MANIFEST     — JSON file with `{ "pages": [{ "name", "figma", "impl" }] }`
 *
 * Optional env:
 *   FIGDIFF_MCP_DIST     — override path to @figdiff/mcp-server dist (default: ../../app/mcp-server/dist)
 *   FIGDIFF_THRESHOLD    — pixelmatch threshold (default 0.1)
 *   FIGDIFF_OUT          — output JSON path (default /tmp/figdiff-eval-results.json)
 *   FIGDIFF_MD_OUT       — output Markdown summary path
 *   FIGDIFF_IMPL_DIR     — implementation screenshot dir under FIGDIFF_SCREENSHOTS (default: astro)
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

const PAGES = await buildPages();

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
  source: process.env.FIGDIFF_MANIFEST
    ? { type: "manifest", path: resolve(process.env.FIGDIFF_MANIFEST) }
    : {
        type: "screenshots",
        path: process.env.FIGDIFF_SCREENSHOTS ? resolve(process.env.FIGDIFF_SCREENSHOTS) : null,
        impl_dir: process.env.FIGDIFF_IMPL_DIR ?? "astro",
      },
  pages: results.length,
  ok_count: results.filter((r) => r.ok).length,
  total_wall_ms: Math.round(endAll - startAll),
  rss_start_mb: Math.round(memStart.rss / 1024 / 1024),
  rss_end_mb: Math.round(memEnd.rss / 1024 / 1024),
  results,
};

const failedCount = summary.pages - summary.ok_count;
await writeFile(OUT, JSON.stringify(summary, null, 2));
if (process.env.FIGDIFF_MD_OUT) {
  await writeFile(process.env.FIGDIFF_MD_OUT, renderMarkdown(summary));
}
process.stdout.write(`\nResults: ${OUT}\n`);
if (process.env.FIGDIFF_MD_OUT) {
  process.stdout.write(`Markdown: ${process.env.FIGDIFF_MD_OUT}\n`);
}
process.stdout.write(
  `Total: ${summary.total_wall_ms}ms, RSS ${summary.rss_start_mb} → ${summary.rss_end_mb}MB\n`,
);
if (failedCount > 0) {
  // Fail-loud so CI / automation never reports a green run on a partially-broken
  // benchmark. ok_count is also in the JSON for programmatic callers.
  process.stderr.write(`${failedCount} of ${summary.pages} pages failed; exiting non-zero.\n`);
  process.exit(1);
}

async function buildPages() {
  if (process.env.FIGDIFF_MANIFEST) {
    return loadManifestPages(process.env.FIGDIFF_MANIFEST);
  }

  const base = process.env.FIGDIFF_SCREENSHOTS;
  if (!base) {
    console.error(
      "FIGDIFF_SCREENSHOTS or FIGDIFF_MANIFEST is required. " +
        "FIGDIFF_SCREENSHOTS should contain figma/ and an implementation screenshot dir.",
    );
    process.exit(2);
  }
  const implDir = process.env.FIGDIFF_IMPL_DIR ?? "astro";
  return [
    { name: "top-pc", figma: `${base}/figma/top-pc.png`, impl: `${base}/${implDir}/top-pc.png` },
    { name: "top-sp", figma: `${base}/figma/top-sp.png`, impl: `${base}/${implDir}/top-sp.png` },
    {
      name: "about-pc",
      figma: `${base}/figma/about-pc.png`,
      impl: `${base}/${implDir}/about-pc.png`,
    },
    {
      name: "about-sp",
      figma: `${base}/figma/about-sp.png`,
      impl: `${base}/${implDir}/about-sp.png`,
    },
    {
      name: "service-pc",
      figma: `${base}/figma/service-pc.png`,
      impl: `${base}/${implDir}/service-pc.png`,
    },
    {
      name: "service-sp",
      figma: `${base}/figma/service-sp.png`,
      impl: `${base}/${implDir}/service-sp.png`,
    },
    {
      name: "recruit-pc",
      figma: `${base}/figma/recruit-pc.png`,
      impl: `${base}/${implDir}/recruit-pc.png`,
    },
    {
      name: "recruit-sp",
      figma: `${base}/figma/recruit-sp.png`,
      impl: `${base}/${implDir}/recruit-sp.png`,
    },
    { name: "news-pc", figma: `${base}/figma/news-pc.png`, impl: `${base}/${implDir}/news-pc.png` },
    { name: "news-sp", figma: `${base}/figma/news-sp.png`, impl: `${base}/${implDir}/news-sp.png` },
    {
      name: "contact-pc",
      figma: `${base}/figma/contact-pc.png`,
      impl: `${base}/${implDir}/contact-pc.png`,
    },
    {
      name: "contact-sp",
      figma: `${base}/figma/contact-sp.png`,
      impl: `${base}/${implDir}/contact-sp.png`,
    },
  ];
}

async function loadManifestPages(manifestPath) {
  const manifestFile = resolve(manifestPath);
  const manifestDir = dirname(manifestFile);
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  if (!Array.isArray(manifest.pages) || manifest.pages.length === 0) {
    console.error("FIGDIFF_MANIFEST must contain a non-empty pages array.");
    process.exit(2);
  }
  return manifest.pages.map((page, index) => {
    if (!page.name || !page.figma || !page.impl) {
      console.error(
        `Invalid FIGDIFF_MANIFEST page at index ${index}: name, figma, and impl are required.`,
      );
      process.exit(2);
    }
    return {
      name: String(page.name),
      figma: resolve(manifestDir, page.figma),
      impl: resolve(manifestDir, page.impl),
      meta: page.meta ?? undefined,
    };
  });
}

function renderMarkdown(summary) {
  const failedCount = summary.pages - summary.ok_count;
  const lines = [
    "# designdiff eval summary",
    "",
    `- Ran at: ${summary.ran_at}`,
    `- Source: ${summary.source.type}${summary.source.path ? ` (${summary.source.path})` : ""}`,
    `- Threshold: ${summary.threshold}`,
    `- Pages: ${summary.ok_count}/${summary.pages} ok`,
    `- Total wall time: ${summary.total_wall_ms}ms`,
    `- Result: ${failedCount === 0 ? "PASS" : "FAIL"}`,
    "",
    "| Page | OK | Match | Regions | Diff pixels | Time | Worst cells |",
    "|---|---:|---:|---:|---:|---:|---|",
  ];

  for (const result of summary.results) {
    if (!result.ok) {
      lines.push(
        `| ${escapeTable(result.page)} | no | - | - | - | ${result.wall_ms}ms | ${escapeTable(result.error ?? "")} |`,
      );
      continue;
    }
    const worstCells = (result.worst_grid_cells ?? [])
      .slice(0, 3)
      .map((cell) => `r${cell.row}c${cell.col}:${cell.matchRate}%`)
      .join(", ");
    lines.push(
      `| ${escapeTable(result.page)} | yes | ${result.result.matchRate}% | ${result.result.diffRegions?.length ?? 0} | ${result.result.diffPixelCount} | ${result.wall_ms}ms | ${escapeTable(worstCells)} |`,
    );
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

function escapeTable(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

async function runPageWorker(page) {
  const safePageName = page.name.replaceAll(/[^a-zA-Z0-9._-]/g, "_");
  const pageOut = join(tmpdir(), `figdiff-eval-${process.pid}-${safePageName}.json`);
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

#!/usr/bin/env node
/**
 * Figma page manifest から frame PNG を取得し、designdiff eval manifest を生成する。
 *
 * 例:
 *   pnpm eval:ingest-figma -- \
 *     --figma-manifest /path/to/sample-project-lp-figma-pages.json \
 *     --out /tmp/sample-project-lp-figma \
 *     --impl-dir /tmp/sample-project-lp-capture/impl
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const options = parseArgs(process.argv.slice(2));
const PLACEHOLDER_PATTERN = /REPLACE_/u;
const figmaManifestPath = resolve(requiredOption(options, "figma-manifest"));
const outDir = resolve(options.out ? String(options.out) : join(process.cwd(), "figma-ingest"));
const figmaDir = resolve(outDir, "figma");
const implDir = options["impl-dir"] ? resolve(String(options["impl-dir"])) : null;
const tokenEnv = options["token-env"] ? String(options["token-env"]) : "FIGMA_TOKEN";
const token = options.token ? String(options.token) : process.env[tokenEnv];
const validateOnly = Boolean(options["validate-only"]);
const apiBase = stripTrailingSlash(
  options["api-base"] ? String(options["api-base"]) : "https://api.figma.com/v1",
);
const useRealFigmaApi = !validateOnly && apiBase === "https://api.figma.com/v1";
const scale = options.scale ? Number(options.scale) : 2;
const format = options.format ? String(options.format) : "png";
const manifestOut = resolve(
  options["manifest-out"] ? String(options["manifest-out"]) : join(outDir, "figdiff-manifest.json"),
);
const summaryOut = resolve(
  options.summary ? String(options.summary) : join(outDir, "figma-ingest-summary.md"),
);
const summaryJsonOut = resolve(
  options["summary-json"] ? String(options["summary-json"]) : deriveSummaryJsonOutPath(summaryOut),
);

if (!validateOnly && !token) {
  fail(`Figma token is required. Set ${tokenEnv} or pass --token.`);
}
if (!Number.isFinite(scale) || scale <= 0) {
  fail("--scale must be a positive number.");
}

const figmaManifest = JSON.parse(await readFile(figmaManifestPath, "utf8"));
if (!Array.isArray(figmaManifest.pages) || figmaManifest.pages.length === 0) {
  fail("--figma-manifest must contain a non-empty pages array.");
}

await mkdir(figmaDir, { recursive: true });
await mkdir(dirname(manifestOut), { recursive: true });
await mkdir(dirname(summaryOut), { recursive: true });
await mkdir(dirname(summaryJsonOut), { recursive: true });

const pages = figmaManifest.pages.map(normalizePage);
validateImplementationPairs(pages);
if (useRealFigmaApi) {
  validateRealFigmaPages(pages);
}
const placeholderPages = pages.filter(hasPlaceholderFigmaTarget);
if (!validateOnly && placeholderPages.length > 0) {
  fail(
    `Figma manifest contains placeholder values: ${placeholderPages.map((page) => page.name).join(", ")}. ` +
      "Replace REPLACE_* file keys/node IDs before running real ingest.",
  );
}

if (validateOnly) {
  const ingested = pages.map((page) => ({
    name: page.name,
    figma: "(validate-only)",
    impl: implDir ? join(implDir, `${page.name}.png`) : null,
    meta: {
      file_key: page.fileKey,
      node_id: page.nodeId,
      figma_url: page.figmaUrl,
      scale: page.scale,
      format,
      ...buildExpectedTextsMeta(page),
    },
  }));
  await mkdir(dirname(summaryOut), { recursive: true });
  await writeFile(
    summaryOut,
    renderSummary({
      figmaManifestPath,
      figmaDir,
      implDir,
      placeholderPages,
      ingested,
    }),
  );
  await writeJsonAtomic(
    summaryJsonOut,
    buildSummaryEvidence({ figmaManifestPath, figmaDir, implDir, ingested, placeholderPages }),
  );
  process.stdout.write(`Validated pages: ${pages.length}\n`);
  if (placeholderPages.length > 0) {
    process.stdout.write(`Placeholder pages: ${placeholderPages.length}\n`);
  }
  process.stdout.write(`Summary: ${summaryOut}\n`);
  process.stdout.write(`Summary JSON: ${summaryJsonOut}\n`);
  if (implDir) {
    const implFiles = await readdir(implDir).catch(() => []);
    const ingestedNames = new Set(ingested.map((p) => p.name));
    const unmatched = implFiles
      .filter((f) => f.endsWith(".png"))
      .map((f) => f.replace(/\.png$/u, ""))
      .filter((name) => !ingestedNames.has(name));
    if (unmatched.length > 0) {
      const warnMsg = `[ingest-figma-pages] WARN: impl screenshots with no manifest entry (skipped, not compared): ${unmatched.join(", ")}\n`;
      process.stderr.write(warnMsg);
      process.stdout.write(warnMsg);
    }
  }
  process.exit(0);
}

const groupedPages = groupByFileKeyAndScale(pages);
const ingested = [];

for (const filePages of groupedPages.values()) {
  const fileKey = filePages[0].fileKey;
  const imageUrls = await fetchFigmaImageUrls({ fileKey, pages: filePages });
  for (const page of filePages) {
    const imageUrl = imageUrls[page.nodeId];
    if (!imageUrl) {
      fail(`Figma image URL missing for ${page.name} (${fileKey}/${page.nodeId}).`);
    }
    const figmaPath = join(figmaDir, `${page.name}.${format}`);
    await downloadFile(imageUrl, figmaPath);
    const entry = {
      name: page.name,
      figma: figmaPath,
      impl: implDir ? join(implDir, `${page.name}.png`) : null,
      meta: {
        file_key: fileKey,
        node_id: page.nodeId,
        figma_url: page.figmaUrl,
        scale: page.scale,
        format,
        ...buildExpectedTextsMeta(page),
      },
    };
    ingested.push(entry);
  }
}

let unmatchedImpl = [];
if (implDir) {
  const implFiles = await readdir(implDir).catch(() => []);
  const ingestedNames = new Set(ingested.map((p) => p.name));
  unmatchedImpl = implFiles
    .filter((f) => f.endsWith(".png"))
    .map((f) => f.replace(/\.png$/u, ""))
    .filter((name) => !ingestedNames.has(name));
  if (unmatchedImpl.length > 0) {
    const warnMsg = `[ingest-figma-pages] WARN: impl screenshots with no manifest entry (skipped, not compared): ${unmatchedImpl.join(", ")}\n`;
    process.stderr.write(warnMsg);
    process.stdout.write(warnMsg);
  }
}

if (implDir) {
  await writeJsonAtomic(manifestOut, {
    meta: {
      source: figmaManifestPath,
      figma_dir: figmaDir,
      impl_dir: implDir,
      generated_at: new Date().toISOString(),
    },
    pages: ingested.map((page) => ({
      name: page.name,
      figma: page.figma,
      impl: page.impl,
      meta: page.meta,
    })),
  });
}

await writeFile(
  summaryOut,
  renderSummary({ figmaManifestPath, figmaDir, implDir, ingested, placeholderPages }),
);
await writeJsonAtomic(
  summaryJsonOut,
  buildSummaryEvidence({ figmaManifestPath, figmaDir, implDir, ingested, placeholderPages }),
);
process.stdout.write(`Figma screenshots: ${figmaDir}\n`);
process.stdout.write(`Pages: ${ingested.length}\n`);
if (implDir) {
  process.stdout.write(`Manifest: ${manifestOut}\n`);
  if (unmatchedImpl.length > 0) {
    process.stdout.write(
      `Skipped (no manifest entry): ${unmatchedImpl.length} — ${unmatchedImpl.join(", ")}\n`,
    );
  }
}
process.stdout.write(`Summary: ${summaryOut}\n`);
process.stdout.write(`Summary JSON: ${summaryJsonOut}\n`);

function parseArgs(args) {
  const parsed = {};
  const normalized = args[0] === "--" ? args.slice(1) : args;
  for (let index = 0; index < normalized.length; index += 1) {
    const arg = normalized[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const next = normalized[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function requiredOption(options, key) {
  if (!options[key] || options[key] === true) {
    fail(`--${key} is required`);
  }
  return String(options[key]);
}

function normalizePage(page, index) {
  if (!page || typeof page !== "object") {
    fail(`Invalid page at index ${index}.`);
  }
  const name = page.name ? String(page.name) : null;
  const figmaUrl = page.figma_url ? String(page.figma_url) : null;
  const parsed = figmaUrl ? parseFigmaUrl(figmaUrl) : {};
  const fileKey = page.file_key ? String(page.file_key) : parsed.fileKey;
  const nodeId = page.node_id ? String(page.node_id) : parsed.nodeId;
  if (!name || !fileKey || !nodeId) {
    fail(`Page at index ${index} requires name and either figma_url or file_key/node_id.`);
  }
  return {
    name,
    fileKey,
    nodeId: normalizeNodeId(nodeId),
    figmaUrl,
    scale: page.scale ? Number(page.scale) : scale,
    expectedTexts: normalizeExpectedTexts(page),
  };
}

function normalizeExpectedTexts(page) {
  const value = page.expected_texts ?? page.expectedTexts;
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry) => entry !== null && entry !== undefined)
    .map((entry) => String(entry))
    .filter(Boolean);
}

function buildExpectedTextsMeta(page) {
  return page.expectedTexts.length > 0 ? { expected_texts: page.expectedTexts } : {};
}

function parseFigmaUrl(value) {
  const url = new URL(value);
  const [, type, fileKey] = url.pathname.split("/");
  if (!["design", "file"].includes(type) || !fileKey) {
    fail(`Unsupported Figma URL: ${value}`);
  }
  const nodeId = url.searchParams.get("node-id");
  if (!nodeId) {
    fail(`Figma URL must include node-id: ${value}`);
  }
  return { fileKey, nodeId };
}

function normalizeNodeId(value) {
  return String(value).replace("-", ":");
}

function hasPlaceholderFigmaTarget(page) {
  return (
    PLACEHOLDER_PATTERN.test(page.fileKey) ||
    PLACEHOLDER_PATTERN.test(page.nodeId) ||
    (page.figmaUrl ? PLACEHOLDER_PATTERN.test(page.figmaUrl) : false)
  );
}

function groupByFileKeyAndScale(pages) {
  const groups = new Map();
  for (const page of pages) {
    const key = `${page.fileKey}:${page.scale}`;
    const group = groups.get(key) ?? [];
    group.push(page);
    groups.set(key, group);
  }
  return groups;
}

function validateImplementationPairs(pages) {
  if (!implDir) {
    return;
  }
  for (const page of pages) {
    const implPath = join(implDir, `${page.name}.png`);
    if (!existsSync(implPath)) {
      fail(`Implementation screenshot missing for ${page.name}: ${implPath}`);
    }
  }
}

function validateRealFigmaPages(pages) {
  const missingUrlPages = pages.filter((page) => !page.figmaUrl).map((page) => page.name);
  if (missingUrlPages.length > 0) {
    fail(
      `Real Figma ingest requires figma_url for every page. Missing figma_url: ${missingUrlPages.join(", ")}`,
    );
  }
}

async function fetchFigmaImageUrls({ fileKey, pages }) {
  const ids = pages.map((page) => page.nodeId).join(",");
  const pageScale = pages[0]?.scale ?? scale;
  const url = new URL(`${apiBase}/images/${fileKey}`);
  url.searchParams.set("ids", ids);
  url.searchParams.set("format", format);
  url.searchParams.set("scale", String(pageScale));
  url.searchParams.set("contents_only", "true");
  url.searchParams.set("use_absolute_bounds", "true");
  const response = await fetch(url, {
    headers: { "X-Figma-Token": token },
  });
  if (!response.ok) {
    fail(`Figma images API failed (${response.status}) for file ${fileKey}.`);
  }
  const payload = await response.json();
  if (payload.err) {
    fail(`Figma images API returned error for file ${fileKey}: ${payload.err}`);
  }
  if (!payload.images || typeof payload.images !== "object") {
    fail(`Figma images API response missing images for file ${fileKey}.`);
  }
  return payload.images;
}

async function downloadFile(url, outFile) {
  if (useRealFigmaApi) {
    const host = new URL(url).host;
    if (host !== "figma-alpha-api.s3.us-west-2.amazonaws.com") {
      fail(
        `Real Figma ingest expected Figma CDN URL, but received ${host}. This usually means mock/placeholder data was used.`,
      );
    }
  }
  const response = await fetch(url, {
    headers: url.startsWith(apiBase) ? { "X-Figma-Token": token } : {},
  });
  if (!response.ok) {
    fail(`Figma image download failed (${response.status}) for ${url}.`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const tempFile = `${outFile}.tmp-${process.pid}`;
  await writeFile(tempFile, Buffer.from(arrayBuffer));
  await rename(tempFile, outFile);
}

async function writeJsonAtomic(path, value) {
  const tempFile = `${path}.tmp-${process.pid}`;
  await writeFile(tempFile, `${JSON.stringify(value, null, 2)}\n`);
  JSON.parse(await readFile(tempFile, "utf8"));
  await rename(tempFile, path);
}

function renderSummary({ figmaManifestPath, figmaDir, implDir, ingested, placeholderPages = [] }) {
  const evidence = buildSummaryEvidence({
    figmaManifestPath,
    figmaDir,
    implDir,
    ingested,
    placeholderPages,
  });
  const expectedTextCounts = evidence.pages.map((page) => page.expected_text_count);
  const ingestMode = validateOnly
    ? "validate-only"
    : useRealFigmaApi
      ? "real-figma-api"
      : "custom-api-base";
  const lines = [
    "# Figma ingest summary",
    "",
    `- Source manifest: ${figmaManifestPath}`,
    `- Ingest mode: ${ingestMode}`,
    `- API base: ${apiBase}`,
    `- Figma screenshots: ${figmaDir}`,
    `- Implementation screenshots: ${implDir ?? "(not paired)"}`,
    `- Pages: ${ingested.length}`,
    `- Placeholder pages: ${placeholderPages.length}`,
    `- Expected text counts: ${expectedTextCounts.join(", ")}`,
    "",
    "| Page | Figma | Implementation | Node | Expected texts |",
    "|---|---|---|---|---:|",
  ];
  for (const page of ingested) {
    const expectedTextCount = page.meta.expected_texts?.length ?? 0;
    lines.push(
      `| ${page.name} | ${page.figma} | ${page.impl ?? ""} | ${page.meta.file_key}/${page.meta.node_id} | ${expectedTextCount} |`,
    );
  }
  lines.push("");
  return `${lines.join("\n")}`;
}

function buildSummaryEvidence({
  figmaManifestPath,
  figmaDir,
  implDir,
  ingested,
  placeholderPages = [],
}) {
  return {
    source_manifest: figmaManifestPath,
    ingest_mode: validateOnly
      ? "validate-only"
      : useRealFigmaApi
        ? "real-figma-api"
        : "custom-api-base",
    api_base: apiBase,
    figma_dir: figmaDir,
    impl_dir: implDir,
    page_count: ingested.length,
    placeholder_pages: placeholderPages.map((page) => page.name),
    pages: ingested.map((page) => ({
      name: page.name,
      figma: page.figma,
      impl: page.impl,
      file_key: page.meta.file_key,
      node_id: page.meta.node_id,
      expected_text_count: page.meta.expected_texts?.length ?? 0,
      expected_texts: page.meta.expected_texts ?? [],
    })),
  };
}

function deriveSummaryJsonOutPath(markdownOutPath) {
  return markdownOutPath.endsWith(".md")
    ? `${markdownOutPath.slice(0, -3)}.json`
    : `${markdownOutPath}.json`;
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/u, "");
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

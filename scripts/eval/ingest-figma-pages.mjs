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
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const options = parseArgs(process.argv.slice(2));
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
const scale = options.scale ? Number(options.scale) : 2;
const format = options.format ? String(options.format) : "png";
const manifestOut = resolve(
  options["manifest-out"] ? String(options["manifest-out"]) : join(outDir, "figdiff-manifest.json"),
);
const summaryOut = resolve(
  options.summary ? String(options.summary) : join(outDir, "figma-ingest-summary.md"),
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

const pages = figmaManifest.pages.map(normalizePage);
validateImplementationPairs(pages);

if (validateOnly) {
  await mkdir(dirname(summaryOut), { recursive: true });
  await writeFile(
    summaryOut,
    renderSummary({
      figmaManifestPath,
      figmaDir,
      implDir,
      ingested: pages.map((page) => ({
        name: page.name,
        figma: "(validate-only)",
        impl: implDir ? join(implDir, `${page.name}.png`) : null,
        meta: {
          file_key: page.fileKey,
          node_id: page.nodeId,
          figma_url: page.figmaUrl,
          scale: page.scale,
          format,
        },
      })),
    }),
  );
  process.stdout.write(`Validated pages: ${pages.length}\n`);
  process.stdout.write(`Summary: ${summaryOut}\n`);
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
      },
    };
    ingested.push(entry);
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

await writeFile(summaryOut, renderSummary({ figmaManifestPath, figmaDir, implDir, ingested }));
process.stdout.write(`Figma screenshots: ${figmaDir}\n`);
process.stdout.write(`Pages: ${ingested.length}\n`);
if (implDir) {
  process.stdout.write(`Manifest: ${manifestOut}\n`);
}
process.stdout.write(`Summary: ${summaryOut}\n`);

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
  };
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

async function fetchFigmaImageUrls({ fileKey, pages }) {
  const ids = pages.map((page) => page.nodeId).join(",");
  const pageScale = pages[0]?.scale ?? scale;
  const url = new URL(`${apiBase}/images/${fileKey}`);
  url.searchParams.set("ids", ids);
  url.searchParams.set("format", format);
  url.searchParams.set("scale", String(pageScale));
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

function renderSummary({ figmaManifestPath, figmaDir, implDir, ingested }) {
  const lines = [
    "# Figma ingest summary",
    "",
    `- Source manifest: ${figmaManifestPath}`,
    `- Figma screenshots: ${figmaDir}`,
    `- Implementation screenshots: ${implDir ?? "(not paired)"}`,
    `- Pages: ${ingested.length}`,
    "",
    "| Page | Figma | Implementation | Node |",
    "|---|---|---|---|",
  ];
  for (const page of ingested) {
    lines.push(
      `| ${page.name} | ${page.figma} | ${page.impl ?? ""} | ${page.meta.file_key}/${page.meta.node_id} |`,
    );
  }
  lines.push("");
  return `${lines.join("\n")}`;
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/u, "");
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

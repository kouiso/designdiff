#!/usr/bin/env node
/**
 * sample-corporate の実装スクリーンショットと real Figma node PNG を比較する。
 *
 * capture-lp-screenshots / ingest-figma-pages / @figdiff/shared の computeSsim をつなぐだけの
 * dogfood 用 runner。
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";

const ARG_PREFIX_LENGTH = 2;
const WARN_THRESHOLD = 0.95;
const BLOCK_THRESHOLD = 0.9;
const DEFAULT_PAGES =
  "top=/,about=/about,service=/service,recruit=/recruit,news=/news,contact=/contact";

function handleFatal(error) {
  process.stderr.write(`${formatError(error)}\n`);
  process.exit(2);
}

process.on("unhandledRejection", handleFatal);
process.on("uncaughtException", handleFatal);
const repoDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const options = parseArgs(process.argv.slice(ARG_PREFIX_LENGTH));
const siteRepo = resolve(requiredOption(options, "site-repo"));
const figmaManifest = resolve(
  optionalString(
    options,
    "figma-manifest",
    join(repoDir, "verification/fixture/sample-corporate-figma-pages.json"),
  ),
);
const outDir = resolve(
  optionalString(options, "out", join(tmpdir(), "sample-corporate-figma-compare")),
);
const captureOut = resolve(optionalString(options, "capture-out", join(outDir, "capture")));
const ingestOut = resolve(optionalString(options, "ingest-out", join(outDir, "figma")));
const implDir = resolve(optionalString(options, "impl-dir", join(captureOut, "impl")));
const figdiffManifest = resolve(
  optionalString(options, "manifest-out", join(ingestOut, "figdiff-manifest.json")),
);
const tokenEnv = optionalString(options, "token-env", "FIGMA_TOKEN");
const scale = optionalString(options, "scale", "2");
const skipCapture = Boolean(options["skip-capture"]);
const skipIngest = Boolean(options["skip-ingest"]);
const pages = optionalString(options, "pages", DEFAULT_PAGES);

loadDotEnvLocal(join(repoDir, ".env.local"));
loadDotEnvLocal(join(siteRepo, ".env.local"));

if (!process.env[tokenEnv]) {
  fail(`Figma token is required. Set ${tokenEnv} or add it to .env.local.`);
}
if (!existsSync(figmaManifest)) {
  fail(`Figma manifest not found: ${figmaManifest}`);
}
if (!existsSync(join(siteRepo, "package.json"))) {
  fail(`Site repo package.json not found: ${siteRepo}`);
}

await mkdir(outDir, { recursive: true });
await ensureSharedBuild();

if (!skipCapture) {
  await runCommand(
    process.execPath,
    [
      join(repoDir, "script/eval/capture-lp-screenshots.mjs"),
      "--repo",
      siteRepo,
      "--out",
      captureOut,
      "--pages",
      pages,
    ],
    { cwd: repoDir },
  );
}

if (!skipIngest) {
  await runCommand(
    process.execPath,
    [
      join(repoDir, "script/eval/ingest-figma-pages.mjs"),
      "--figma-manifest",
      figmaManifest,
      "--out",
      ingestOut,
      "--impl-dir",
      implDir,
      "--manifest-out",
      figdiffManifest,
      "--token-env",
      tokenEnv,
      "--scale",
      scale,
    ],
    { cwd: repoDir },
  );
}

const { computeSsim } = await import(pathToFileURL(join(repoDir, "package/shared/dist/index.js")));
const manifest = JSON.parse(await readFile(figdiffManifest, "utf8"));
if (!Array.isArray(manifest.pages) || manifest.pages.length === 0) {
  fail(`Compare manifest has no pages: ${figdiffManifest}`);
}

const rows = [];
for (const page of manifest.pages) {
  if (!page.figma || !page.impl) {
    fail(`Compare manifest page is missing figma/impl path: ${page.name ?? "(unnamed)"}`);
  }
  const pair = await loadComparablePixels(page.figma, page.impl);
  const score = computeSsim(pair.figmaPixels, pair.implPixels, pair.width, pair.height);
  rows.push({
    name: page.name,
    nodeId: page.meta?.node_id ?? "-",
    score,
    verdict: score < BLOCK_THRESHOLD ? "BLOCK" : score < WARN_THRESHOLD ? "WARN" : "PASS",
    width: pair.width,
    height: pair.height,
    figma: page.figma,
    impl: page.impl,
  });
}

printReport(rows);

if (rows.some((row) => row.verdict === "BLOCK")) {
  process.exit(1);
}
process.exit(0);

function parseArgs(args) {
  const parsed = {};
  const normalized = args[0] === "--" ? args.slice(1) : args;
  for (let index = 0; index < normalized.length; index += 1) {
    const arg = normalized[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(ARG_PREFIX_LENGTH);
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

function requiredOption(source, key) {
  if (!source[key] || source[key] === true) {
    fail(`--${key} is required`);
  }
  return String(source[key]);
}

function optionalString(source, key, fallback) {
  if (!source[key]) {
    return fallback;
  }
  if (source[key] === true) {
    fail(`--${key} requires a value`);
  }
  return String(source[key]);
}

function loadDotEnvLocal(path) {
  if (!existsSync(path)) {
    return;
  }
  const text = readFileSyncUtf8(path);
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(trimmed);
    if (!match || process.env[match[1]]) {
      continue;
    }
    process.env[match[1]] = unquoteEnvValue(match[2].trim());
  }
}

function readFileSyncUtf8(path) {
  return readFileSync(path, "utf8");
}

function unquoteEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

async function ensureSharedBuild() {
  const distIndex = join(repoDir, "package/shared/dist/index.js");
  if (existsSync(distIndex)) {
    return;
  }
  await runCommand("pnpm", ["--filter", "@figdiff/shared", "build"], { cwd: repoDir });
}

async function runCommand(command, args, options) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      ...options,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => process.stdout.write(chunk));
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
    });
  });
}

async function loadComparablePixels(figmaPath, implPath) {
  const figmaMeta = await sharp(figmaPath).metadata();
  const { width } = figmaMeta;
  const height = figmaMeta.height;
  const figmaRaw = await sharp(figmaPath).ensureAlpha().raw().toBuffer();
  const implResized = await sharp(implPath)
    .resize(width, height, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer();
  return {
    width,
    height,
    figmaPixels: Array.from(figmaRaw),
    implPixels: Array.from(implResized),
  };
}

function printReport(rows) {
  process.stdout.write("\nsample-corporate Figma structural SSIM\n");
  process.stdout.write(`warn < ${WARN_THRESHOLD} / block < ${BLOCK_THRESHOLD}\n`);
  process.stdout.write(`manifest: ${figdiffManifest}\n\n`);
  process.stdout.write("| Page | Figma node | Size | SSIM | Verdict |\n");
  process.stdout.write("|---|---|---:|---:|---|\n");
  for (const row of rows) {
    process.stdout.write(
      `| ${row.name} | ${row.nodeId} | ${row.width}x${row.height} | ${row.score.toFixed(4)} | ${row.verdict} |\n`,
    );
  }
  const pass = rows.filter((row) => row.verdict === "PASS").length;
  const warn = rows.filter((row) => row.verdict === "WARN").length;
  const block = rows.filter((row) => row.verdict === "BLOCK").length;
  process.stdout.write(
    `\nSummary: pass=${pass} warn=${warn} block=${block} total=${rows.length}\n`,
  );
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

#!/usr/bin/env node
/**
 * screenshot baseline 同士を designdiff eval 用 manifest に変換する。
 *
 * 例:
 *   pnpm eval:manifest -- \
 *     --screenshots /path/to/sample-corporate/test/screenshots \
 *     --from figma \
 *     --to actual \
 *     --out /tmp/figma-vs-actual.json
 */

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";

const options = parseArgs(process.argv.slice(2));
const screenshotsDir = resolve(requiredOption(options, "screenshots"));
const fromName = requiredOption(options, "from");
const toName = requiredOption(options, "to");
const outFile = resolve(requiredOption(options, "out"));
const fromDir = resolve(screenshotsDir, fromName);
const toDir = resolve(screenshotsDir, toName);
const requestedPages = parseList(options.pages);
const summaryFile = options.summary ? resolve(String(options.summary)) : null;

validateDirectory(screenshotsDir, "--screenshots");
validateDirectory(fromDir, `--from ${fromName}`);
validateDirectory(toDir, `--to ${toName}`);

const pages = await buildPages({ fromDir, toDir, requestedPages });
if (pages.length === 0) {
  fail("No comparable PNG screenshots found.");
}

await mkdir(dirname(outFile), { recursive: true });
await writeJsonAtomic(outFile, {
  meta: {
    source: screenshotsDir,
    from: fromName,
    to: toName,
    generated_at: new Date().toISOString(),
  },
  pages,
});

if (summaryFile) {
  await mkdir(dirname(summaryFile), { recursive: true });
  await writeFile(summaryFile, renderSummary({ screenshotsDir, fromName, toName, pages }));
}

process.stdout.write(`Manifest: ${outFile}\n`);
process.stdout.write(`Pages: ${pages.length}\n`);
if (summaryFile) {
  process.stdout.write(`Summary: ${summaryFile}\n`);
}

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

function parseList(value) {
  if (!value || value === true) {
    return null;
  }
  return new Set(
    String(value)
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => entry.replace(/\.png$/u, "")),
  );
}

function validateDirectory(path, label) {
  if (!existsSync(path)) {
    fail(`${label} directory does not exist: ${path}`);
  }
}

async function buildPages({ fromDir, toDir, requestedPages }) {
  const fromFiles = await listPngs(fromDir);
  const toFiles = await listPngs(toDir);
  const fromNames = new Set(fromFiles.map((file) => basename(file, ".png")));
  const toNames = new Set(toFiles.map((file) => basename(file, ".png")));
  const targetNames = requestedPages ?? fromNames;
  const missingFrom = [];
  const missingTo = [];
  const pages = [];

  for (const name of [...targetNames].sort()) {
    if (!fromNames.has(name)) {
      missingFrom.push(name);
      continue;
    }
    if (!toNames.has(name)) {
      missingTo.push(name);
      continue;
    }
    pages.push({
      name,
      figma: join(fromDir, `${name}.png`),
      impl: join(toDir, `${name}.png`),
      meta: {
        reference: fromName,
        candidate: toName,
      },
    });
  }

  if (missingFrom.length > 0 || missingTo.length > 0) {
    fail(
      [
        missingFrom.length > 0 ? `Missing in ${fromName}: ${missingFrom.join(", ")}` : null,
        missingTo.length > 0 ? `Missing in ${toName}: ${missingTo.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return pages;
}

async function listPngs(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".png"))
    .map((entry) => entry.name)
    .sort();
}

async function writeJsonAtomic(path, value) {
  const tempFile = `${path}.tmp-${process.pid}`;
  await writeFile(tempFile, `${JSON.stringify(value, null, 2)}\n`);
  JSON.parse(await readFile(tempFile, "utf8"));
  await rename(tempFile, path);
}

function renderSummary({ screenshotsDir, fromName, toName, pages }) {
  const lines = [
    "# screenshot manifest summary",
    "",
    `- Screenshots: ${screenshotsDir}`,
    `- From: ${fromName}`,
    `- To: ${toName}`,
    `- Pages: ${pages.length}`,
    "",
    "| Page | Reference | Candidate |",
    "|---|---|---|",
  ];
  for (const page of pages) {
    lines.push(`| ${page.name} | ${page.figma} | ${page.impl} |`);
  }
  lines.push("");
  return `${lines.join("\n")}`;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

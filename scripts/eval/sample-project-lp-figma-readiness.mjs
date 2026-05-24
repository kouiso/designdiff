#!/usr/bin/env node
/**
 * sample-project-lp の real Figma smoke 実行前に必要条件を監査する。
 *
 * build/capture/API は呼ばず、manifest / token / LP repo の準備状態だけを
 * fail-loud に確認する。
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ARG_PREFIX_LENGTH = 2;
const ERROR_EXIT_CODE = 2;
const PLACEHOLDER_PATTERN = /REPLACE_/u;
const repoDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const options = parseArgs(process.argv.slice(ARG_PREFIX_LENGTH));
const lpRepo = resolve(requiredOption(options, "lp-repo"));
const figmaManifest = resolve(
  optionalString(
    options,
    "figma-manifest",
    join(repoDir, "verification/fixtures/sample-project-lp-figma-pages.template.json"),
  ),
);
const tokenEnv = optionalString(options, "token-env", "FIGMA_TOKEN");
const out = resolve(optionalString(options, "out", "/tmp/sample-project-lp-figma-readiness.md"));

const checks = [];
const lpPackageJson = join(lpRepo, "package.json");
checks.push(check("LP repo package.json", existsSync(lpPackageJson), lpPackageJson));
checks.push(check("Figma manifest file", existsSync(figmaManifest), figmaManifest));
checks.push(check(`${tokenEnv} environment variable`, Boolean(process.env[tokenEnv]), tokenEnv));

let pages = [];
let manifestError = null;
if (existsSync(figmaManifest)) {
  try {
    const manifest = JSON.parse(await readFile(figmaManifest, "utf8"));
    pages = Array.isArray(manifest.pages) ? manifest.pages : [];
    checks.push(check("Manifest pages", pages.length > 0, `${pages.length} page(s)`));
  } catch (error) {
    manifestError = error;
    checks.push(check("Manifest JSON", false, error.message));
  }
}

const placeholderPages = pages.filter(hasPlaceholderFigmaTarget);
checks.push(
  check(
    "No REPLACE_* placeholders",
    placeholderPages.length === 0,
    placeholderPages.length === 0
      ? "ok"
      : placeholderPages.map((page) => page.name ?? "(unnamed)").join(", "),
  ),
);

const ready = checks.every((entry) => entry.ok) && !manifestError;
await writeReport({ ready, checks, placeholderPages });

if (ready) {
  process.stdout.write(`Ready: ${out}\n`);
  process.exit(0);
}

process.stderr.write(`Not ready: ${out}\n`);
process.exit(ERROR_EXIT_CODE);

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

function requiredOption(options, key) {
  if (!options[key] || options[key] === true) {
    fail(`--${key} is required`);
  }
  return String(options[key]);
}

function optionalString(options, key, fallback) {
  if (!options[key]) {
    return fallback;
  }
  if (options[key] === true) {
    fail(`--${key} requires a value`);
  }
  return String(options[key]);
}

function check(name, ok, detail) {
  return { name, ok, detail };
}

function hasPlaceholderFigmaTarget(page) {
  if (!page || typeof page !== "object") {
    return false;
  }
  return ["figma_url", "file_key", "node_id"].some((key) =>
    PLACEHOLDER_PATTERN.test(String(page[key] ?? "")),
  );
}

async function writeReport({ ready, checks, placeholderPages }) {
  const lines = [
    "# sample-project-lp Figma readiness",
    "",
    `- Ready: ${ready ? "yes" : "no"}`,
    `- LP repo: ${lpRepo}`,
    `- Figma manifest: ${figmaManifest}`,
    `- Token env: ${tokenEnv}`,
    "",
    "| Check | OK | Detail |",
    "|---|---:|---|",
  ];
  for (const entry of checks) {
    lines.push(`| ${entry.name} | ${entry.ok ? "yes" : "no"} | ${entry.detail} |`);
  }
  lines.push("", "## Next command", "");
  if (ready) {
    lines.push(
      "```bash",
      `pnpm eval:sample-project-lp-figma -- --lp-repo ${lpRepo} --figma-manifest ${figmaManifest} --out /tmp/sample-project-lp-figma-smoke --real --skip-install`,
      "```",
    );
  } else {
    lines.push("- Replace all `REPLACE_*` values in the Figma manifest.");
    lines.push(`- Export ${tokenEnv} without storing it in the repo.`);
    lines.push("- Re-run this readiness command before `--real` smoke.");
  }
  if (placeholderPages.length > 0) {
    lines.push("", "## Placeholder pages", "");
    for (const page of placeholderPages) {
      lines.push(`- ${page.name ?? "(unnamed)"}`);
    }
  }
  lines.push("");
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${lines.join("\n")}\n`);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(ERROR_EXIT_CODE);
}

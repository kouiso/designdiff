#!/usr/bin/env node
/**
 * sample-project-lp の real Figma smoke 実行前に必要条件を監査する。
 *
 * build/capture/API は呼ばず、manifest / token / LP repo の準備状態だけを
 * fail-loud に確認する。
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
const out = resolve(
  optionalString(options, "out", join(tmpdir(), "sample-project-lp-figma-readiness.md")),
);
const jsonOut = resolve(optionalString(options, "json-out", deriveJsonOutPath(out)));

const checks = [];
const lpPackageJson = join(lpRepo, "package.json");
checks.push(check("LP repo package.json", existsSync(lpPackageJson), lpPackageJson));
checks.push(check("Figma manifest file", existsSync(figmaManifest), figmaManifest));
checks.push(check(`${tokenEnv} environment variable`, Boolean(process.env[tokenEnv]), tokenEnv));

let pages = [];
let manifestError = null;
let manifestRaw = null;
if (existsSync(figmaManifest)) {
  try {
    manifestRaw = await readFile(figmaManifest, "utf8");
    const manifest = JSON.parse(manifestRaw);
    pages = Array.isArray(manifest.pages) ? manifest.pages : [];
    checks.push(check("Manifest pages", pages.length > 0, `${pages.length} page(s)`));
  } catch (error) {
    manifestError = error;
    checks.push(check("Manifest JSON", false, error.message));
  }
}

const placeholderPages = pages.filter(hasPlaceholderFigmaTarget);
const invalidPages = pages.filter((page) => !hasIngestiblePageShape(page));
checks.push(
  check(
    "Ingestible page schema",
    invalidPages.length === 0,
    invalidPages.length === 0 ? "ok" : invalidPages.map(pageName).join(", "),
  ),
);
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
const smokeCommand = buildSmokeCommand();
await writeReport({ ready, checks, placeholderPages, smokeCommand });
await writeJsonEvidence({
  ready,
  checks,
  placeholderPages,
  smokeCommand,
  manifestRaw,
  manifestPageCount: pages.length,
});

if (ready) {
  process.stdout.write(`Ready: ${out}\nEvidence JSON: ${jsonOut}\n`);
  process.exit(0);
}

process.stderr.write(`Not ready: ${out}\nEvidence JSON: ${jsonOut}\n`);
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
  return ["figma_url", "file_key", "node_id", "figmaUrl", "fileKey", "nodeId"].some((key) =>
    PLACEHOLDER_PATTERN.test(String(page[key] ?? "")),
  );
}
function hasIngestiblePageShape(page) {
  if (!page || typeof page !== "object" || !page.name) {
    return false;
  }
  if (page.figma_url) {
    return isSupportedFigmaUrl(page.figma_url);
  }
  return Boolean(page.file_key && page.node_id);
}
function pageName(page, index) {
  if (!page || typeof page !== "object") {
    return `index-${index}`;
  }
  return String(page.name ?? `index-${index}`);
}
function isSupportedFigmaUrl(value) {
  try {
    const url = new URL(String(value));
    const [, type, fileKey] = url.pathname.split("/");
    return ["design", "file"].includes(type) && Boolean(fileKey) && url.searchParams.has("node-id");
  } catch {
    return false;
  }
}
async function writeReport({ ready, checks, placeholderPages, smokeCommand }) {
  const lines = [
    "# sample-project-lp Figma readiness",
    "",
    `- Ready: ${ready ? "yes" : "no"}`,
    `- LP repo: ${lpRepo}`,
    `- Figma manifest: ${figmaManifest}`,
    `- Token env: ${tokenEnv}`,
    `- Evidence JSON: ${jsonOut}`,
    "",
    "| Check | OK | Detail |",
    "|---|---:|---|",
  ];
  for (const entry of checks) {
    lines.push(
      `| ${escapeTable(entry.name)} | ${entry.ok ? "yes" : "no"} | ${escapeTable(entry.detail)} |`,
    );
  }
  lines.push("", "## Next command", "");
  if (ready) {
    lines.push("```bash", smokeCommand, "```");
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
async function writeJsonEvidence({
  ready,
  checks,
  placeholderPages,
  smokeCommand,
  manifestRaw,
  manifestPageCount,
}) {
  const missingRequirements = checks.filter((entry) => !entry.ok).map((entry) => entry.name);
  const manifestSha256 = manifestRaw
    ? createHash("sha256").update(manifestRaw).digest("hex")
    : null;
  const expectedManifestMetadata = {
    manifestPageCount: manifestPageCount > 0,
    manifestSha256: true,
  };
  const actualManifestMetadata = {
    manifestPageCount,
    manifestSha256,
  };
  const evidence = {
    ready,
    missingRequirements,
    placeholderPageNames: placeholderPages.map((page) => page.name ?? "(unnamed)"),
    manifestPath: figmaManifest,
    lpRepoPath: lpRepo,
    realSmokeCommand: ready ? smokeCommand : null,
    expectedPaths: { lpRepoPackageJson: join(lpRepo, "package.json"), figmaManifest },
    expectedManifestMetadata,
    actualManifestMetadata,
    actualPaths: {
      lpRepoPackageJsonExists: existsSync(join(lpRepo, "package.json")),
      figmaManifestExists: existsSync(figmaManifest),
      markdownReport: out,
      jsonEvidence: jsonOut,
    },
    checks,
  };
  await mkdir(dirname(jsonOut), { recursive: true });
  await writeFile(jsonOut, `${JSON.stringify(evidence, null, 2)}\n`);
}
function buildSmokeCommand() {
  return `pnpm eval:sample-project-lp-figma -- --lp-repo ${shellQuote(lpRepo)} --figma-manifest ${shellQuote(figmaManifest)} --out ${shellQuote(join(tmpdir(), "sample-project-lp-figma-smoke"))} --real --token-env ${shellQuote(tokenEnv)}`;
}
function deriveJsonOutPath(markdownOutPath) {
  return markdownOutPath.endsWith(".md")
    ? `${markdownOutPath.slice(0, -3)}.json`
    : `${markdownOutPath}.json`;
}
function escapeTable(value) {
  return String(value).replaceAll("|", "\\|");
}
function shellQuote(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(ERROR_EXIT_CODE);
}

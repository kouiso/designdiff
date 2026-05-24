#!/usr/bin/env node
/**
 * sample-project-lp の capture -> Figma ingest -> eval を 1 コマンドで実行する。
 *
 * 実 Figma token / node mapping がない時は validate-only で実装 screenshot と
 * manifest の名前対応だけを検証する。
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ARG_PREFIX_LENGTH = 2;
const ERROR_EXIT_CODE = 2;
const SUCCESS_EXIT_CODE = 0;
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
const outDir = resolve(optionalString(options, "out", "/tmp/sample-project-lp-figma-smoke"));
const realRun = Boolean(options.real);
const skipInstall = Boolean(options["skip-install"]);
const skipBuild = Boolean(options["skip-build"]);
const tokenEnv = optionalString(options, "token-env", "FIGMA_TOKEN");
const captureDir = join(outDir, "capture");
const figmaDir = join(outDir, "figma");
const evalJson = join(outDir, "eval.json");
const evalMd = join(outDir, "eval.md");
const summaryPath = join(outDir, "summary.md");

validateDirectory(lpRepo, "--lp-repo");
validateFile(figmaManifest, "--figma-manifest");
if (realRun && !process.env[tokenEnv]) {
  fail(`--real requires ${tokenEnv}. Set ${tokenEnv} or pass --token-env.`);
}

await mkdir(outDir, { recursive: true });

const captureArgs = [
  join(repoDir, "scripts/eval/capture-lp-screenshots.mjs"),
  "--repo",
  lpRepo,
  "--out",
  captureDir,
];
if (skipInstall) {
  captureArgs.push("--skip-install");
}
await run("node", captureArgs);

const ingestArgs = [
  join(repoDir, "scripts/eval/ingest-figma-pages.mjs"),
  "--figma-manifest",
  figmaManifest,
  "--out",
  figmaDir,
  "--impl-dir",
  join(captureDir, "impl"),
  "--token-env",
  tokenEnv,
];
if (!realRun) {
  ingestArgs.push("--validate-only");
}
await run("node", ingestArgs);

if (realRun) {
  if (!skipBuild) {
    await run("pnpm", ["--filter", "@figdiff/mcp-server", "build"]);
  }
  await run("node", [join(repoDir, "scripts/eval/figdiff-cluster-bench.mjs")], {
    env: {
      ...process.env,
      FIGDIFF_MANIFEST: join(figmaDir, "figdiff-manifest.json"),
      FIGDIFF_OUT: evalJson,
      FIGDIFF_MD_OUT: evalMd,
    },
  });
}

await writeSummary();
process.stdout.write(`Summary: ${summaryPath}\n`);

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

function validateDirectory(path, label) {
  if (!existsSync(path)) {
    fail(`${label} directory not found: ${path}`);
  }
}

function validateFile(path, label) {
  if (!existsSync(path)) {
    fail(`${label} file not found: ${path}`);
  }
}

async function run(command, args, options = {}) {
  process.stdout.write(`$ ${[command, ...args].join(" ")}\n`);
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: repoDir,
      stdio: "inherit",
      shell: process.platform === "win32",
      ...options,
    });
    child.on("close", (code) => {
      if (code === SUCCESS_EXIT_CODE) {
        resolvePromise();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
    });
  });
}

async function writeSummary() {
  const lines = [
    "# sample-project-lp Figma smoke",
    "",
    `- lp repo: ${lpRepo}`,
    `- figma manifest: ${figmaManifest}`,
    `- mode: ${realRun ? "real" : "validate-only"}`,
    `- capture: ${captureDir}`,
    `- figma output: ${figmaDir}`,
  ];
  if (realRun) {
    lines.push(`- eval markdown: ${evalMd}`, `- eval json: ${evalJson}`);
  }
  lines.push("");
  await mkdir(dirname(summaryPath), { recursive: true });
  await writeFile(summaryPath, `${lines.join("\n")}\n`);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(ERROR_EXIT_CODE);
}

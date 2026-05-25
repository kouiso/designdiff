#!/usr/bin/env node
/**
 * sample-project-lp readiness を再監査し、証跡を out-dir 配下へ固定名で出力する。
 * 既存 readiness スクリプトをラップして、block 解除後の再実行コストを下げる。
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ARG_PREFIX_LENGTH = 2;
const ERROR_EXIT_CODE = 2;
const repoDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const options = parseArgs(process.argv.slice(ARG_PREFIX_LENGTH));

const outDir = resolve(requiredOption(options, "out-dir"));
const lpRepo = resolve(optionalString(options, "lp-repo", resolveDefaultLpRepo()));
const figmaManifest = resolve(
  optionalString(
    options,
    "figma-manifest",
    join(repoDir, "verification/fixtures/sample-project-lp-figma-pages.template.json"),
  ),
);
const tokenEnv = optionalString(options, "token-env", "FIGMA_TOKEN");

const markdownOut = join(outDir, "sample-project-lp-figma-readiness.md");
const jsonOut = join(outDir, "sample-project-lp-figma-readiness.json");

await mkdir(outDir, { recursive: true });

const args = [
  join(repoDir, "scripts/eval/sample-project-lp-figma-readiness.mjs"),
  "--lp-repo",
  lpRepo,
  "--figma-manifest",
  figmaManifest,
  "--token-env",
  tokenEnv,
  "--out",
  markdownOut,
  "--json-out",
  jsonOut,
];

try {
  await run("node", args);
  process.stdout.write(
    `Readiness status: ready\nEvidence markdown: ${markdownOut}\nEvidence json: ${jsonOut}\n`,
  );
  process.exit(0);
} catch (error) {
  if (error?.code !== ERROR_EXIT_CODE && error?.exitCode !== ERROR_EXIT_CODE) {
    throw error;
  }
  process.stderr.write(
    `Readiness status: blocked\nEvidence markdown: ${markdownOut}\nEvidence json: ${jsonOut}\n`,
  );
  process.exit(ERROR_EXIT_CODE);
}

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

function requiredOption(parsed, key) {
  if (!parsed[key] || parsed[key] === true) {
    fail(`--${key} is required`);
  }
  return String(parsed[key]);
}

function optionalString(parsed, key, fallback) {
  if (!parsed[key]) {
    return fallback;
  }
  if (parsed[key] === true) {
    fail(`--${key} requires a value`);
  }
  return String(parsed[key]);
}

function resolveDefaultLpRepo() {
  const candidates = [
    process.env.SAMPLE_PROJECT_LP_REPO,
    join(repoDir, "../sample-project-lp"),
    process.env.HOME ? join(process.env.HOME, "worktrees/sample-project-lp-audit") : null,
    process.env.HOME ? join(process.env.HOME, "ghq/github.com/example-org/sample-project-lp") : null,
  ].filter(Boolean);
  return (
    candidates.find((candidate) => existsSync(join(candidate, "package.json"))) ?? candidates[1]
  );
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(ERROR_EXIT_CODE);
}

function run(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: "inherit", cwd: repoDir, env: process.env });
    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(Object.assign(new Error(`${command} exited with code ${code}`), { code }));
    });
  });
}

#!/usr/bin/env node
/**
 * top-pc large-page diff smoke。
 *
 * 実装スクリーンショット取得 → compare-design相当ベンチ実行（timeout差分）→ レポート生成。
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { resolveTopPcImplPath } from "./top-pc-smoke-paths.mjs";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
if (isMain(import.meta.url)) {
  await main();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const lpRepo = resolve(required(options, "lp-repo"));
  const outDir = resolve(optional(options, "out", "/tmp/figdiff-top-pc-smoke"));
  const timeoutMs = Number(optional(options, "timeout-ms", "5000"));
  const baselineTimeoutMs = Number(optional(options, "baseline-timeout-ms", "60000"));
  const skipCapture = Boolean(options["skip-capture"]);
  const skipInstall = Boolean(options["skip-install"]);
  const expectDiff = Boolean(options["expect-diff"]);

  const captureDir = join(outDir, "capture");
  const evalDir = join(outDir, "eval");
  const diffDir = join(outDir, "diff");
  const baselineJson = join(evalDir, "baseline.json");
  const baselineMd = join(evalDir, "baseline.md");
  const actualJson = join(evalDir, "actual.json");
  const actualMd = join(evalDir, "actual.md");
  const benchManifest = join(evalDir, "manifest.json");
  const reportPath = join(outDir, "top-pc-large-page-smoke-report.md");

  if (!existsSync(lpRepo)) {
    fail(`--lp-repo not found: ${lpRepo}`);
  }
  await mkdir(outDir, { recursive: true });
  await mkdir(evalDir, { recursive: true });
  await mkdir(diffDir, { recursive: true });

  if (!skipCapture) {
    const captureArgs = [
      join(repoDir, "scripts/eval/capture-lp-screenshots.mjs"),
      "--repo",
      lpRepo,
      "--out",
      captureDir,
      "--pages",
      "top-pc",
    ];
    if (skipInstall) captureArgs.push("--skip-install");
    await run("node", captureArgs);
  }

  const implPath = resolveTopPcImplPath(captureDir);
  if (!existsSync(implPath)) {
    fail(`top-pc screenshot not found: ${implPath}`);
  }

  await writeFile(
    benchManifest,
    JSON.stringify(
      {
        pages: [
          {
            name: "top-pc",
            figma: join(captureDir, "figma", "top-pc.png"),
            impl: implPath,
          },
        ],
      },
      null,
      2,
    ),
  );

  await run("node", [join(repoDir, "scripts/eval/figdiff-cluster-bench.mjs")], {
    env: {
      ...process.env,
      FIGDIFF_MANIFEST: benchManifest,
      FIGDIFF_OUT: baselineJson,
      FIGDIFF_MD_OUT: baselineMd,
      FIGDIFF_PAGE_TIMEOUT_MS: String(baselineTimeoutMs),
      FIGDIFF_DIFF_DIR: diffDir,
    },
  });

  await run("node", [join(repoDir, "scripts/eval/figdiff-cluster-bench.mjs")], {
    env: {
      ...process.env,
      FIGDIFF_MANIFEST: benchManifest,
      FIGDIFF_OUT: actualJson,
      FIGDIFF_MD_OUT: actualMd,
      FIGDIFF_PAGE_TIMEOUT_MS: String(timeoutMs),
      FIGDIFF_DIFF_DIR: diffDir,
    },
  });

  const baseline = JSON.parse(await readFile(baselineJson, "utf8"));
  const actual = JSON.parse(await readFile(actualJson, "utf8"));
  const baseResult = baseline.results?.[0] ?? {};
  const actualResult = actual.results?.[0] ?? {};
  const diffRegionCount = getDiffRegionCount(actualResult);
  const expectedDiffRegionsLabel = buildDiffRegionsExpectation(expectDiff);

  if (expectDiff && diffRegionCount === 0) {
    fail("--expect-diff is set, but actual diffRegions is 0");
  }

  const report = [
    "# top-pc large-page diff smoke",
    "",
    `- 実行日時: ${new Date().toISOString()}`,
    `- 実装スクリーンショット: \`${implPath}\``,
    `- bench manifest: \`${benchManifest}\``,
    `- compare_design相当コマンド: \`node scripts/eval/figdiff-cluster-bench.mjs\``,
    `- baseline timeout: ${baselineTimeoutMs}ms`,
    `- target timeout: ${timeoutMs}ms`,
    "",
    "## Expected vs Actual (timing)",
    "",
    "| 項目 | Expected | Actual |",
    "|---|---:|---:|",
    `| baseline完走 | ok | ${baseResult.ok ? "ok" : "fail"} |`,
    `| baseline wall time | <= ${baselineTimeoutMs}ms | ${baseResult.wall_ms ?? "-"}ms |`,
    `| target完走 | ok | ${actualResult.ok ? "ok" : "fail"} |`,
    `| target wall time | <= ${timeoutMs}ms | ${actualResult.wall_ms ?? "-"}ms |`,
    "",
    "## Diff signal",
    "",
    "| 指標 | Expected | Actual |",
    "|---|---|---|",
    `| matchRate | 数値が返る | ${actualResult.result?.matchRate ?? "-"} |`,
    `| diffPixelCount | 数値が返る | ${actualResult.result?.diffPixelCount ?? "-"} |`,
    `| diffRegions | ${expectedDiffRegionsLabel} | ${diffRegionCount} |`,
    `| diffReport verdict | pass/fail/inconclusive | ${actualResult.result?.diffReport?.aggregateVerdict ?? "-"} |`,
    `| cluster fallback | 計測として記録される | ${actualResult.result?.clusterTelemetry?.fallbackUsed ?? "-"} (${actualResult.result?.clusterTelemetry?.fallbackReason ?? "-"}) |`,
    "",
    "## Artifacts",
    "",
    `- baseline json: \`${baselineJson}\``,
    `- target json: \`${actualJson}\``,
    `- baseline md: \`${baselineMd}\``,
    `- target md: \`${actualMd}\``,
    `- diff png: \`${actualResult.artifacts?.diff_image ?? "(not generated)"}\``,
    "",
  ].join("\n");

  await writeFile(reportPath, report);
  process.stdout.write(`Report: ${reportPath}\n`);
}

function isMain(moduleUrl) {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(moduleUrl);
}

export function getDiffRegionCount(actualResult) {
  const count = actualResult?.result?.diffRegions?.length;
  return typeof count === "number" ? count : "-";
}

export function buildDiffRegionsExpectation(expectDiff) {
  return expectDiff ? "1以上（差分ありケース）" : "0以上の数値（差分なし含む）";
}

function parseArgs(args) {
  const out = {};
  const normalized = args[0] === "--" ? args.slice(1) : args;
  for (let i = 0; i < normalized.length; i += 1) {
    const arg = normalized[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = normalized[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}
function required(options, key) {
  if (!options[key] || options[key] === true) fail(`--${key} is required`);
  return String(options[key]);
}
function optional(options, key, fallback) {
  if (!options[key]) return fallback;
  if (options[key] === true) fail(`--${key} requires value`);
  return String(options[key]);
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
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} ${args.join(" ")} failed (${code})`));
    });
  });
}
function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

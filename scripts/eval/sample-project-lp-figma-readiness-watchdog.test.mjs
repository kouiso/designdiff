import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoDir = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const script = join(repoDir, "scripts/eval/sample-project-lp-figma-readiness-watchdog.mjs");
const manifestPath = join(
  repoDir,
  "verification/fixtures/sample-project-lp-figma-pages.template.json",
);

test("watchdog は readiness 証跡を out-dir 配下へ markdown/json で出力し status と path を表示する", () => {
  const outDir = mkdtempSync(join(tmpdir(), "sample-project-watchdog-test-"));
  try {
    const result = spawnSync(
      "node",
      [script, "--out-dir", outDir, "--lp-repo", repoDir, "--figma-manifest", manifestPath],
      { cwd: repoDir, encoding: "utf8" },
    );

    assert.equal(result.status, 2);
    const mdPath = join(outDir, "sample-project-lp-figma-readiness.md");
    const jsonPath = join(outDir, "sample-project-lp-figma-readiness.json");
    const evidence = JSON.parse(readFileSync(jsonPath, "utf8"));
    const markdown = readFileSync(mdPath, "utf8");

    assert.match(result.stderr, /Readiness status: blocked/u);
    assert.match(result.stderr, /Blockers \([1-9][0-9]*\):/u);
    assert.match(result.stderr, /No REPLACE_\* placeholders/u);
    assert.match(result.stderr, new RegExp(`Evidence markdown: ${escapeRegExp(mdPath)}`, "u"));
    assert.match(result.stderr, new RegExp(`Evidence json: ${escapeRegExp(jsonPath)}`, "u"));

    assert.equal(evidence.actualPaths.markdownReport, mdPath);
    assert.equal(evidence.actualPaths.jsonEvidence, jsonPath);
    assert.equal(evidence.expectedPaths.figmaManifest, manifestPath);
    assert.match(markdown, /# sample-project-lp Figma readiness/u);
  } finally {
    rmSync(outDir, { force: true, recursive: true });
  }
});

test("watchdog は lp-repo 未指定時 SAMPLE_PROJECT_LP_REPO を既定値として使う", () => {
  const outDir = mkdtempSync(join(tmpdir(), "sample-project-watchdog-env-test-"));
  try {
    const result = spawnSync(
      "node",
      [script, "--out-dir", outDir, "--figma-manifest", manifestPath],
      {
        cwd: repoDir,
        encoding: "utf8",
        env: { ...process.env, SAMPLE_PROJECT_LP_REPO: repoDir },
      },
    );

    assert.equal(result.status, 2);
    const jsonPath = join(outDir, "sample-project-lp-figma-readiness.json");
    const evidence = JSON.parse(readFileSync(jsonPath, "utf8"));

    assert.equal(evidence.lpRepoPath, repoDir);
    assert.equal(evidence.actualPaths.lpRepoPackageJsonExists, true);
  } finally {
    rmSync(outDir, { force: true, recursive: true });
  }
});

test("watchdog は HOME なしでも既定 fallback path でクラッシュしない", () => {
  const outDir = mkdtempSync(join(tmpdir(), "sample-project-watchdog-no-home-test-"));
  try {
    const { HOME: _home, SAMPLE_PROJECT_LP_REPO: _lpRepo, ...env } = process.env;
    const result = spawnSync(
      "node",
      [script, "--out-dir", outDir, "--figma-manifest", manifestPath],
      {
        cwd: repoDir,
        encoding: "utf8",
        env,
      },
    );

    assert.equal(result.status, 2);
    assert.doesNotMatch(result.stderr, /path.*must be of type string/u);
    assert.match(result.stderr, /Readiness status: blocked/u);
    assert.match(result.stderr, /Blockers \([1-9][0-9]*\):/u);
  } finally {
    rmSync(outDir, { force: true, recursive: true });
  }
});

function escapeRegExp(value) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

test("watchdog は blocker 出力で token 値を露出しない", () => {
  const outDir = mkdtempSync(join(tmpdir(), "sample-project-watchdog-redact-test-"));
  try {
    const result = spawnSync(
      "node",
      [script, "--out-dir", outDir, "--lp-repo", repoDir, "--figma-manifest", manifestPath],
      {
        cwd: repoDir,
        encoding: "utf8",
        env: { ...process.env, FIGMA_TOKEN: "figd_super_secret_token_value" },
      },
    );

    assert.equal(result.status, 2);
    assert.doesNotMatch(result.stderr, /figd_super_secret_token_value/u);
  } finally {
    rmSync(outDir, { force: true, recursive: true });
  }
});

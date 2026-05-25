import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoDir = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const script = join(repoDir, "scripts/eval/sample-project-lp-figma-smoke.mjs");

function prepareFixture() {
  const root = mkdtempSync(join(tmpdir(), "sample-project-smoke-test-"));
  const lpRepo = join(root, "lp");
  mkdirSync(lpRepo, { recursive: true });
  writeFileSync(join(lpRepo, "package.json"), '{"name":"lp"}\n');
  const manifest = join(root, "manifest.json");
  writeFileSync(
    manifest,
    JSON.stringify({
      pages: [
        {
          name: "top",
          file_key: "abc123",
          node_id: "1:2",
          figma_url: "https://www.figma.com/design/abc123/Test?node-id=1-2",
        },
      ],
    }),
  );
  return { root, lpRepo, manifest };
}

test("モード未指定は fail-loud で終了し、暗黙 validate-only fallback しない", () => {
  const { root, lpRepo, manifest } = prepareFixture();
  try {
    const result = spawnSync("node", [script, "--lp-repo", lpRepo, "--figma-manifest", manifest], {
      cwd: repoDir,
      encoding: "utf8",
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /must specify exactly one mode/i);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("--real で readiness が block したとき summary に markdown/json の証跡 path と status を出す", () => {
  const { root, lpRepo } = prepareFixture();
  const manifest = join(root, "blocked-manifest.json");
  const outDir = join(root, "out");
  try {
    writeFileSync(
      manifest,
      JSON.stringify({
        pages: [{ name: "top", file_key: "REPLACE_FILE_KEY", node_id: "REPLACE_NODE_ID" }],
      }),
    );
    const result = spawnSync(
      "node",
      [
        script,
        "--lp-repo",
        lpRepo,
        "--figma-manifest",
        manifest,
        "--out",
        outDir,
        "--real",
        "--token-env",
        "FIGMA_TOKEN_FOR_TEST",
      ],
      {
        cwd: repoDir,
        encoding: "utf8",
        env: { ...process.env, FIGMA_TOKEN_FOR_TEST: "dummy-token" },
      },
    );

    assert.equal(result.status, 2);
    assert.match(result.stderr, /Readiness blocked real mode/i);

    const summaryPath = join(outDir, "summary.md");
    assert.equal(existsSync(summaryPath), true);
    const summary = readFileSync(summaryPath, "utf8");
    assert.match(summary, /- readiness markdown: .*readiness\.md/u);
    assert.match(summary, /- readiness json: .*readiness\.json/u);
    assert.match(summary, /- readiness status: blocked/u);

    const readinessJsonPath = join(outDir, "readiness.json");
    assert.equal(existsSync(readinessJsonPath), true);
    const readiness = JSON.parse(readFileSync(readinessJsonPath, "utf8"));
    assert.equal(readiness.ready, false);
    assert.equal(readiness.actualPaths.jsonEvidence, readinessJsonPath);
    assert.equal(Array.isArray(readiness.missingRequirements), true);
    assert.ok(readiness.missingRequirements.includes("No REPLACE_* placeholders"));
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

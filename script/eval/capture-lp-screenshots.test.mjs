import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoDir = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const script = join(repoDir, "script/eval/capture-lp-screenshots.mjs");

test("--repo 未指定は fail-loud で終了する", () => {
  const result = spawnSync("node", [script], { cwd: repoDir, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--repo is required/u);
});

test("package.json のないリポジトリは fail-loud で終了する", () => {
  const root = mkdtempSync(join(tmpdir(), "capture-lp-no-pkg-"));
  try {
    const result = spawnSync("node", [script, "--repo", root], {
      cwd: repoDir,
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /package\.json not found/u);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("--pages オプションで custom pages を指定できる (parse 検証)", () => {
  const root = mkdtempSync(join(tmpdir(), "capture-lp-pages-"));
  const fakeRepo = join(root, "lp");
  mkdirSync(fakeRepo);
  writeFileSync(join(fakeRepo, "package.json"), JSON.stringify({ name: "lp" }));
  try {
    // Script will fail at build step (no astro), but we only verify it passes validation
    const result = spawnSync(
      "node",
      [script, "--repo", fakeRepo, "--pages", "top=/,contact=/contact"],
      { cwd: repoDir, encoding: "utf8", timeout: 5000 },
    );
    // Should not fail with "--repo is required" or "package.json not found"
    assert.doesNotMatch(result.stderr ?? "", /--repo is required/u);
    assert.doesNotMatch(result.stderr ?? "", /package\.json not found/u);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoDir = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const script = join(repoDir, "script/eval/capture-lp-screenshots.mjs");

test("viewport width options fail loudly on invalid values", () => {
  const root = mkdtempSync(join(tmpdir(), "capture-lp-width-"));
  const fakeRepo = join(root, "lp");
  mkdirSync(fakeRepo);
  writeFileSync(join(fakeRepo, "package.json"), JSON.stringify({ name: "lp" }));
  try {
    const result = spawnSync("node", [script, "--repo", fakeRepo, "--pc-width", "0"], {
      cwd: repoDir,
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--pc-width must be a positive integer/u);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

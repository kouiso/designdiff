import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoDir = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const script = join(repoDir, "scripts/eval/pr-visual-evidence-readiness.mjs");

test("証跡なしの PR 本文は fail-loud で終了する", () => {
  const result = spawnSync("node", [script, "--text", "テストは通っています。"], {
    cwd: repoDir,
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[FAIL\]/u);
  assert.match(result.stderr, /expected vs actual/i);
});

test("Figma URL があれば readiness pass", () => {
  const body = "Figma: https://www.figma.com/design/abc123/My-UI?node-id=1-2";
  const result = spawnSync("node", [script, "--text", body], {
    cwd: repoDir,
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /\[PASS\]/u);
  assert.match(result.stdout, /figma_url/u);
});

test("evidence ファイル入力を読み取り、画像 URL を検出する", () => {
  const tmp = mkdtempSync(join(tmpdir(), "pr-evidence-"));
  const filePath = join(tmp, "evidence.md");
  writeFileSync(filePath, "![before](https://example.com/before.png)\n");
  const result = spawnSync("node", [script, "--file", filePath], {
    cwd: repoDir,
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /markdown_image/u);
  assert.match(result.stdout, /source:/u);
});

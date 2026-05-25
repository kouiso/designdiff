import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
  return { lpRepo, manifest };
}

test("モード未指定は fail-loud で終了し、暗黙 validate-only fallback しない", () => {
  const { lpRepo, manifest } = prepareFixture();
  const result = spawnSync("node", [script, "--lp-repo", lpRepo, "--figma-manifest", manifest], {
    cwd: repoDir,
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /must specify exactly one mode/i);
});

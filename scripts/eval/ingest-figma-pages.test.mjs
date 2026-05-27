import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoDir = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const script = join(repoDir, "scripts/eval/ingest-figma-pages.mjs");

test("validate-only summary preserves expected_texts as review traceability", () => {
  const root = mkdtempSync(join(tmpdir(), "figma-ingest-test-"));
  const manifestPath = join(root, "manifest.json");
  const outDir = join(root, "out");
  const implDir = join(root, "impl");
  mkdirSync(implDir, { recursive: true });
  writeFileSync(join(implDir, "sbi-consent-pc.png"), "not-a-real-png");
  writeFileSync(
    manifestPath,
    JSON.stringify({
      pages: [
        {
          name: "sbi-consent-pc",
          figma_url: "https://www.figma.com/design/file123/Sample-Project?node-id=1:2",
          expected_texts: [
            "利用規約とプライバシーポリシーに同意する",
            null,
            "",
            "同意する場合はチェックボックスを押してください",
          ],
        },
      ],
    }),
  );

  try {
    const result = spawnSync(
      process.execPath,
      [
        script,
        "--figma-manifest",
        manifestPath,
        "--out",
        outDir,
        "--impl-dir",
        implDir,
        "--summary-json",
        join(outDir, "summary.json"),
        "--validate-only",
      ],
      { cwd: repoDir, encoding: "utf8" },
    );

    assert.equal(result.status, 0);
    const summary = readFileSync(join(outDir, "figma-ingest-summary.md"), "utf8");
    const summaryJson = JSON.parse(readFileSync(join(outDir, "summary.json"), "utf8"));
    assert.match(summary, /Expected text counts: 2/u);
    assert.match(summary, /\| sbi-consent-pc \| \(validate-only\) \| .* \| file123\/1:2 \| 2 \|/u);
    assert.equal(summaryJson.ingest_mode, "validate-only");
    assert.deepEqual(summaryJson.pages[0].expected_texts, [
      "利用規約とプライバシーポリシーに同意する",
      "同意する場合はチェックボックスを押してください",
    ]);
    assert.equal(summaryJson.pages[0].expected_text_count, 2);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

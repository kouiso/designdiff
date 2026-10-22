import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { URL } from "node:url";

import { run } from "../issue-376-baseline/reproduce.mjs";

assert.equal(
  process.argv.length,
  5,
  "Usage: node inventory.mjs <repository> <fixtures> <output.json>",
);
const [repository, fixtures, output] = process.argv.slice(2).map((argument) => resolve(argument));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sourceFiles = [
  "package/shared/src/index.ts",
  "package/shared/src/signal/glyph-edge-raster.ts",
  "package/shared/src/signal/text-reflow.ts",
  "app/mcp-server/src/service/diff-report-builder.ts",
  "app/mcp-server/src/service/image-compare-service.ts",
];
const files = [
  ...sourceFiles,
  ...sourceFiles.map((file) => file.replace("/src/", "/dist/").replace(/\.ts$/, ".js")),
];
const snapshot = async () => ({
  baseCommit: execFileSync("git", ["-C", repository, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  productDiffSha256: hash(
    execFileSync("git", ["-C", repository, "diff", "--binary", "HEAD", "--", ...sourceFiles]),
  ),
  fileSha256: Object.fromEntries(
    await Promise.all(
      files.map(async (file) => [file, hash(await readFile(join(repository, file)))]),
    ),
  ),
});
const before = await snapshot();
await run([repository, fixtures, output]);
assert.deepEqual(await snapshot(), before, "Source, build or HEAD changed during inventory");
const document = JSON.parse(await readFile(output, "utf8"));
assert.equal(document.cases.length, 33);
const cases = document.cases.map(({ issues, ...entry }) => ({
  ...entry,
  issueCounts: Object.fromEntries(
    [...new Set(issues.map((issue) => `${issue.severity}/${issue.signal}`))].map((key) => [
      key,
      issues.filter((issue) => `${issue.severity}/${issue.signal}` === key).length,
    ]),
  ),
}));
const result = {
  ...before,
  sourceAndBuildStableDuringRun: true,
  scriptSha256AtExecution: hash(await readFile(new URL("./inventory.mjs", import.meta.url))),
  scope:
    "Actual built compareImages, unchanged SHA-checked PR375 inputs; no instrumentation, image writes or uploads. Historical PASS labels are declarations, not independently certified AA-only positives.",
  summary: {
    cases: cases.length,
    declaredPass: document.summary.expectedPass,
    declaredPassFailMismatches: document.summary.falseFail,
    falsePassAgainstDeclarations: document.summary.falsePass,
    inconclusive: document.summary.inconclusive,
  },
  classificationReference:
    "../issue-376-continuation/README.md: eleven cases contain proven nonfont layout/size/content differences; pair18 text layout/rendering cause is uncertified. No labels changed.",
  cases,
};
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result.summary)}\n`);

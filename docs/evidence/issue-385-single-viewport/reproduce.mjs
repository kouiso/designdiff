import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir, platform, arch, release } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const repository = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
const require = createRequire(join(repository, "app/mcp-server/package.json"));
const { Client } = await import(
  pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/index.js"))
);
const { StdioClientTransport } = await import(
  pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/stdio.js"))
);
const sharp = require("sharp");
await mkdir(output, { recursive: true });
const sandbox = await mkdtemp(join(tmpdir(), "figdiff-385-stdio-"));
const design = join(sandbox, "design.png");
const screenshot = join(sandbox, "viewport.png");
await sharp({ create: { width: 80, height: 100, channels: 3, background: "white" } })
  .composite([
    {
      input: { create: { width: 20, height: 20, channels: 3, background: "black" } },
      left: 10,
      top: 10,
    },
  ])
  .png()
  .toFile(design);
await sharp(design).extract({ left: 0, top: 0, width: 80, height: 80 }).png().toFile(screenshot);
const connect = async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(repository, "app/mcp-server/dist/index.js")],
    cwd: sandbox,
    env: { FIGDIFF_HOME: sandbox, FIGDIFF_ALLOWED_DIRS: sandbox },
    stderr: "pipe",
  });
  const client = new Client({ name: "issue-385-runtime-evidence", version: "1.0.0" });
  await client.connect(transport);
  return client;
};
const call = async (client, name, args) => {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content.find((item) => item.type === "text")?.text;
  assert.ok(!result.isError, text);
  return result.structuredContent ?? JSON.parse(text);
};
const cases = [];
for (const singleViewport of [true, false]) {
  let client = await connect();
  let baseline;
  try {
    baseline = await call(client, "compare_design", {
      design_source: design,
      screenshot,
      screenshot_single_viewport: singleViewport,
      campaign_id: `issue-385-${singleViewport}`,
    });
  } finally {
    await client.close();
  }
  client = await connect();
  try {
    const verified = await call(client, "verify_fix", {
      design_source: design,
      screenshot,
      prior_comparison_id: baseline.comparisonId,
      expected_target_node_id: "whole-frame",
    });
    assert.equal(verified.verdict, "unchanged");
    const session = JSON.parse(await readFile(join(sandbox, "active-session.json"), "utf8"));
    const stored = JSON.parse(
      await readFile(join(sandbox, "results", `${session.comparisonId}.json`), "utf8"),
    );
    assert.equal(stored.result.normalization.containResized, singleViewport);
    assert.equal(
      stored.result.normalization.screenshotBottomPaddingRows,
      singleViewport ? undefined : 20,
    );
    const missing = stored.result.diffReport.issues.some(
      (issue) => issue.regionId === "missing-bottom-rows",
    );
    assert.equal(missing, !singleViewport);
    cases.push({
      singleViewport,
      restarted: true,
      verification: verified,
      normalization: stored.result.normalization,
      missingBottomRows: missing,
    });
  } finally {
    await client.close();
  }
}
const inputHashes = {};
for (const name of ["design.png", "viewport.png"]) {
  const bytes = await readFile(join(sandbox, name));
  inputHashes[name] = createHash("sha256").update(bytes).digest("hex");
  await writeFile(join(output, name), bytes);
}
const evidence = {
  issue: 385,
  scope:
    "single-viewport capture replay only; not real Figma, AI source edits, Desktop or extension acceptance",
  environment: {
    node: process.version,
    os: platform(),
    architecture: arch(),
    release: release(),
    sharp: sharp.versions.sharp,
  },
  fixture: {
    design: { width: 80, height: 100 },
    screenshot: { width: 80, height: 80 },
    blackRectangle: { left: 10, top: 10, width: 20, height: 20 },
    inputHashes,
    font: "none; raw raster pixels",
    browser: "none; local PNG path",
    baselineAndCurrentBytesIdentical: true,
  },
  expected:
    "Identical captured pixels remain unchanged after server restart; single viewport has no invented bottom rows, full-page control detects exactly 20 missing rows.",
  cases,
};
await writeFile(join(output, "runtime.json"), `${JSON.stringify(evidence, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ cases: cases.length, passed: true, output })}\n`);

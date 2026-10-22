import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { arch, platform, release, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const repository = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
const require = createRequire(join(repository, "app/mcp-server/package.json"));
const { Client } = await import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/index.js")));
const { StdioClientTransport } = await import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/stdio.js")));
const sharp = require("sharp");
const sandbox = await mkdtemp(join(tmpdir(), "figdiff-385-mask-stdio-"));
await mkdir(output, { recursive: true });
const width = 100;
const height = 200;
const designPixels = Buffer.alloc(width * height * 4, 255);
const screenshotPixels = Buffer.from(designPixels);
for (let y = 0; y < 100; y++) {
  for (let x = 1; x < width; x += 2) {
    screenshotPixels.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
  }
}
for (const [name, pixels] of [["design.png", designPixels], ["screenshot.png", screenshotPixels]]) {
  await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toFile(join(sandbox, name));
}
await writeFile(join(sandbox, "expected.json"), JSON.stringify({
  figmaRootNode: {
    id: randomUUID(), name: "Synthetic two-section page", type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width, height },
    children: [0, 100].map((y) => ({
      id: randomUUID(), name: `section-${y}`, type: "FRAME",
      absoluteBoundingBox: { x: 0, y, width, height: 100 },
    })),
  },
}));
// 保存済み結果を別プロセスで読むことで、メモリ内だけの正しい見出しに依存しない。
const call = async (name, args) => {
  const transport = new StdioClientTransport({
    command: process.execPath, args: [join(repository, "app/mcp-server/dist/index.js")],
    cwd: sandbox, env: { FIGDIFF_HOME: sandbox, FIGDIFF_ALLOWED_DIRS: sandbox }, stderr: "pipe",
  });
  const client = new Client({ name: "issue-385-mask-evidence", version: "1.0.0" });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result.content));
    return result;
  } finally {
    await client.close();
  }
};
const args = { design_source: join(sandbox, "design.png"), ignore_regions: [{ x: 0, y: 0, width, height: 99 }] };
const baseline = (await call("compare_design", { ...args, screenshot: join(sandbox, "screenshot.png") })).structuredContent;
const c1 = (0.01 * 255) ** 2;
const c2 = (0.03 * 255) ** 2;
const rowSsim = ((2 * 255 * 127.5 + c1) * c2) / ((255 ** 2 + 127.5 ** 2 + c1) * (127.5 ** 2 + c2));
const expected = Math.round(((rowSsim * 100 + 10000) / 10100) * 10000) / 100;
assert.equal(baseline.comparisonHeadline.structureMatch, expected);
assert.equal(baseline.status, "FAIL");
const reportResponse = await call("generate_diff_report", { comparison_id: baseline.comparisonId, format: "json" });
const report = JSON.parse(reportResponse.content.find((item) => item.type === "text").text);
assert.equal(report.comparisonHeadline.structureMatch, expected);
const repaired = (await call("compare_design", { ...args, screenshot: join(sandbox, "design.png") })).structuredContent;
assert.equal(repaired.status, "PASS");
assert.equal(repaired.comparisonHeadline.structureMatch, 100);
const inputs = {};
for (const name of ["design.png", "screenshot.png", "expected.json"]) {
  const bytes = await readFile(join(sandbox, name));
  await writeFile(join(output, name), bytes);
  inputs[name] = createHash("sha256").update(bytes).digest("hex");
}
await writeFile(join(output, "runtime.json"), `${JSON.stringify({
  scope: "Synthetic local pixels over real built MCP stdio, new server process per call. No real Figma host/API or AI code edits claimed.",
  environment: { node: process.version, os: platform(), arch: arch(), release: release(), sharp: sharp.versions.sharp, width, height, pixelScale: 1, font: "none", browser: "none" },
  oracle: { remainingBadPixels: 50, badSectionScorableArea: 100, goodSectionScorableArea: 10000, rowSsim, expectedStructureMatch: expected, source: "Independent SSIM formula and constructed pixel counts; product status is the assertion target, not the oracle." },
  inputs,
  baseline: { status: baseline.status, headline: baseline.comparisonHeadline },
  persisted: { status: report.status, headline: report.comparisonHeadline },
  repaired: { status: repaired.status, headline: repaired.comparisonHeadline },
}, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ expected, persisted: true, residualStillFails: true, identicalPasses: true })}\n`);

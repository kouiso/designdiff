import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
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
const sandbox = await mkdtemp(join(tmpdir(), "figdiff-385-noise-stdio-"));
await mkdir(output, { recursive: true });
const width = 120;
const height = 120;
const paint = (pixels, x, y, count, value) => {
  for (let index = x; index < x + count; index++)
    pixels.fill(value, (y * width + index) * 4, (y * width + index) * 4 + 3);
};
const design = Buffer.alloc(width * height * 4, 255);
paint(design, 10, 40, 20, 51);
await sharp(design, { raw: { width, height, channels: 4 } })
  .png()
  .toFile(join(sandbox, "design.png"));
const sectionId = randomUUID();
const node = (id, y, sectionHeight) => ({
  id,
  name: `section-${y}`,
  type: "FRAME",
  absoluteBoundingBox: { x: 0, y, width, height: sectionHeight },
});
await writeFile(
  join(sandbox, "expected.json"),
  JSON.stringify({
    figmaRootNode: {
      ...node(randomUUID(), 0, height),
      children: [node(randomUUID(), 0, 40), node(sectionId, 40, 3), node(randomUUID(), 43, 77)],
    },
  }),
);
const call = async (name, args) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(repository, "app/mcp-server/dist/index.js")],
    cwd: sandbox,
    env: { FIGDIFF_HOME: sandbox, FIGDIFF_ALLOWED_DIRS: sandbox },
    stderr: "pipe",
  });
  const client = new Client({ name: "issue-385-noise-evidence", version: "1.0.0" });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result.content));
    return result;
  } finally {
    await client.close();
  }
};
const cases = [];
for (const [noise, excluded] of [
  [0, 0],
  [9, 0],
  [10, 0],
  [10, 1],
]) {
  const screenshot = Buffer.alloc(width * height * 4, 255);
  paint(screenshot, 10, 42, 20, 51);
  paint(screenshot, 100, 41, noise, 0);
  const name = `noise-${noise}-excluded-${excluded}.png`;
  await sharp(screenshot, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(join(sandbox, name));
  const actual = (
    await call("compare_design", {
      design_source: join(sandbox, "design.png"),
      screenshot: join(sandbox, name),
      rasterization_tolerance: true,
      ...(excluded ? { ignore_regions: [{ x: 100, y: 41, width: excluded, height: 1 }] } : {}),
    })
  ).structuredContent;
  const expected = noise - excluded < 10 ? "PASS" : "FAIL";
  assert.equal(actual.status, expected);
  const reportResponse = await call("generate_diff_report", {
    comparison_id: actual.comparisonId,
    format: "json",
  });
  const report = JSON.parse(reportResponse.content.find((item) => item.type === "text").text);
  const section = report.diffReport.regionScores.find((region) => region.regionId === sectionId);
  // 10画素は実パイプラインで独立クラスタになる。救済側の残差検証は9画素時に行う。
  if (noise - excluded < 10)
    assert.equal(section.diffClusterCoverage.unexplainedPerceptibleDiff, false);
  const bytes = await readFile(join(sandbox, name));
  await writeFile(join(output, name), bytes);
  cases.push({
    noise,
    excluded,
    expected,
    status: actual.status,
    coverage: section.diffClusterCoverage,
    inputSha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
for (const name of ["design.png", "expected.json"])
  await writeFile(join(output, name), await readFile(join(sandbox, name)));
await writeFile(
  join(output, "runtime.json"),
  `${JSON.stringify({ scope: "Real built MCP stdio, synthetic local sections/pixels, fresh server for each call. No Figma API or AI source edit.", oracle: "Explicit 10-pixel residual floor from existing frame contract: independently placed 0/9/10 black noise pixels outside two explained 20px translated lines; excluding one of ten leaves nine. Ten-pixel defect remains FAIL.", environment: { node: process.version, width, height, font: "none", browser: "none", pixelScale: 1 }, cases }, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify({ cases: cases.length, passed: true })}\n`);

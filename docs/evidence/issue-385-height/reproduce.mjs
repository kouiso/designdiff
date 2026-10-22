import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { arch, platform, release, tmpdir } from "node:os";
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
const sandbox = await mkdtemp(join(tmpdir(), "figdiff-385-height-stdio-"));
await mkdir(output, { recursive: true });
const design = join(sandbox, "design.png");
await sharp({ create: { width: 80, height: 200, channels: 3, background: "white" } })
  .composite([
    {
      input: { create: { width: 20, height: 20, channels: 3, background: "black" } },
      left: 10,
      top: 10,
    },
  ])
  .png()
  .toFile(design);
for (const height of [160, 199, 200]) {
  await sharp(design)
    .extract({ left: 0, top: 0, width: 80, height })
    .png()
    .toFile(join(sandbox, `height-${height}.png`));
}

// 各呼び出しを別プロセスにし、メモリ内キャッシュで履歴保存の欠落を隠さない。
const call = async (name, args) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(repository, "app/mcp-server/dist/index.js")],
    cwd: sandbox,
    env: { FIGDIFF_HOME: sandbox, FIGDIFF_ALLOWED_DIRS: sandbox },
    stderr: "pipe",
  });
  const client = new Client({ name: "issue-385-height-evidence", version: "1.0.0" });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result.content));
    return result.structuredContent;
  } finally {
    await client.close();
  }
};

const heightCases = [];
for (const [before, after, expected] of [
  [200, 160, "regressed"],
  [160, 200, "improved"],
  [200, 199, "regressed"],
  [199, 200, "improved"],
]) {
  const baseline = await call("compare_design", {
    design_source: design,
    screenshot: join(sandbox, `height-${before}.png`),
    campaign_id: `height-${before}-${after}`,
  });
  const verified = await call("verify_fix", {
    design_source: design,
    screenshot: join(sandbox, `height-${after}.png`),
    prior_comparison_id: baseline.comparisonId,
    expected_target_node_id: "whole-frame",
  });
  assert.equal(verified.verdict, expected);
  assert.ok(Math.abs(verified.structureDelta - (after - before) / 200) < 1e-8);
  heightCases.push({ before, after, expected, verified });
}

const residual = join(sandbox, "residual.png");
const shortResidual = join(sandbox, "short-residual.png");
await sharp(design)
  .composite([
    {
      input: { create: { width: 10, height: 10, channels: 3, background: "black" } },
      left: 50,
      top: 50,
    },
  ])
  .png()
  .toFile(residual);
await sharp(residual)
  .extract({ left: 0, top: 0, width: 80, height: 160 })
  .png()
  .toFile(shortResidual);
const iterations = [];
for (const screenshot of [shortResidual, residual, residual]) {
  const compared = await call("compare_design", {
    design_source: design,
    screenshot,
    campaign_id: "height-repair-residual",
  });
  assert.equal(compared.status, "FAIL");
  iterations.push(compared.loopGuard.step);
}
assert.deepEqual(iterations, [1, 2, 3]);

const inputs = {};
for (const name of [
  "design.png",
  "height-160.png",
  "height-199.png",
  "height-200.png",
  "residual.png",
  "short-residual.png",
]) {
  const bytes = await readFile(join(sandbox, name));
  await writeFile(join(output, name), bytes);
  inputs[name] = createHash("sha256").update(bytes).digest("hex");
}
await writeFile(
  join(output, "runtime.json"),
  `${JSON.stringify(
    {
      scope:
        "Synthetic local PNGs over real built MCP stdio; every call uses a new server process. No real Figma, AI source edit, Desktop or extension acceptance claimed.",
      environment: {
        node: process.version,
        os: platform(),
        architecture: arch(),
        release: release(),
        sharp: sharp.versions.sharp,
        font: "none",
        browser: "none",
        pixelScale: 1,
      },
      fixture: {
        width: 80,
        designHeight: 200,
        blackRectangle: { x: 10, y: 10, width: 20, height: 20 },
        residualRectangle: { x: 50, y: 50, width: 10, height: 10 },
        inputs,
      },
      expected:
        "Cropping/restoring known white bottom rows changes root coverage by the exact row fraction. A single critical missing row remains meaningful. Height repair with an independently inserted 100px defect keeps iteration history after restarts.",
      heightCases,
      iterations,
    },
    null,
    2,
  )}\n`,
);
process.stdout.write(
  `${JSON.stringify({ heightCases: heightCases.length, iterations, passed: true })}\n`,
);

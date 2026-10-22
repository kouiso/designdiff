import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { URL, pathToFileURL } from "node:url";

assert.ok(
  process.argv.length === 5 || process.argv.length === 6,
  "Usage: node reproduce.mjs <repository> <output.json> <red|green> [before.json]",
);
const repository = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
const mode = process.argv[4];
assert.ok(mode === "red" || mode === "green");
assert.equal(process.argv.length, mode === "green" ? 6 : 5);
const baseline =
  mode === "green" ? JSON.parse(await readFile(resolve(process.argv[5]), "utf8")) : undefined;
const require = createRequire(join(repository, "app/mcp-server/package.json"));
const sharp = require("sharp");
const { Client } = await import(
  pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/index.js"))
);
const { StdioClientTransport } = await import(
  pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/stdio.js"))
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (args) => execFileSync("git", ["-C", repository, ...args], { encoding: "utf8" });
const sourceFiles = [
  "package/shared/src/signal/glyph-edge-raster.ts",
  "package/shared/src/signal/text-reflow.ts",
  "app/mcp-server/src/service/diff-report-builder.ts",
  "app/mcp-server/src/service/image-compare-service.ts",
];
const distFiles = sourceFiles.map((file) =>
  file.replace("/src/", "/dist/").replace(/\.ts$/, ".js"),
);
const hashes = async (files) =>
  Object.fromEntries(
    await Promise.all(
      files.map(async (file) => [file, hash(await readFile(join(repository, file)))]),
    ),
  );
const initialDist = await hashes(distFiles);
const snapshot = async () => ({
  baseCommit: git(["rev-parse", "HEAD"]).trim(),
  trackedDiffSha256: hash(git(["diff", "--binary", "HEAD"])),
  sourceSha256: await hashes(sourceFiles),
});
const sourceBefore = await snapshot();
const synth = (size, centers, width) => {
  assert.ok(Number.isInteger(width) && width > 0 && width % 2 === 1);
  const pixels = Buffer.alloc(size * size * 4, 255);
  for (const center of centers)
    for (let y = 20; y < 37; y++)
      for (let dx = -(width - 1) / 2; dx <= (width - 1) / 2; dx++) {
        const x = center + dx;
        assert.ok(Number.isInteger(x) && x >= 0 && x < size && y < size);
        const index = (y * size + x) * 4;
        pixels.fill(51, index, index + 3);
      }
  let inkPixels = 0;
  for (let pixel = 0; pixel < size * size; pixel++) {
    const index = pixel * 4;
    assert.equal(pixels[index + 3], 255);
    assert.equal(pixels[index], pixels[index + 1]);
    assert.equal(pixels[index], pixels[index + 2]);
    assert.ok(pixels[index] === 51 || pixels[index] === 255);
    if (pixels[index] === 51) inkPixels++;
  }
  assert.equal(inkPixels, centers.length * 17 * width);
  return { pixels, inkPixels };
};
const section = (size) => {
  const node = (name, children = []) => ({
    id: hash(`${name}:${size}`),
    name,
    type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width: size, height: size },
    absoluteRenderBounds: null,
    fills: [],
    strokes: [],
    effects: [],
    children,
  });
  return node("Constructed frame", [node("Constructed section")]);
};
const extract = (result) => {
  assert.ok(result.diffReport && Array.isArray(result.diffReport.issues));
  return {
    status: result.status ?? result.diffReport.aggregateVerdict.toUpperCase(),
    aggregateVerdict: result.diffReport.aggregateVerdict,
    issues: result.diffReport.issues.map(({ kind, severity, bbox, evidence }) => ({
      kind,
      severity,
      bbox,
      signal: evidence.signal,
      value: evidence.value,
      expected: evidence.expected,
      actual: evidence.actual,
    })),
  };
};
const publicMcp = async (sandbox, paths) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(repository, "app/mcp-server/dist/index.js")],
    cwd: sandbox,
    env: { HOME: sandbox, FIGDIFF_HOME: sandbox, FIGDIFF_ALLOWED_DIRS: sandbox },
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const client = new Client({ name: "issue-376-stroke-guard", version: "1.0.0" });
  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: "compare_design",
      arguments: { design_source: paths[0], screenshot: paths[1], rasterization_tolerance: true },
    });
    assert.ok(!result.isError, JSON.stringify(result.content));
    assert.ok(result.structuredContent && typeof result.structuredContent === "object");
    const report = await client.callTool({
      name: "generate_diff_report",
      arguments: { comparison_id: result.structuredContent.comparisonId, format: "json" },
    });
    assert.ok(!report.isError, JSON.stringify(report.content));
    const block = report.content.find((entry) => entry.type === "text");
    assert.ok(block && typeof block.text === "string");
    const full = JSON.parse(block.text);
    assert.equal(full.status, result.structuredContent.status);
    return { ...extract(full), stderr };
  } finally {
    await client.close();
  }
};
const API_CHILD = `
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
const [modulePath, designPath, screenshotPath, sectionPath] = process.argv.slice(1);
const { compareImages } = await import(pathToFileURL(modulePath));
const result = await compareImages({ designBase64: (await readFile(designPath)).toString('base64'), screenshotBase64: (await readFile(screenshotPath)).toString('base64'), rasterizationTolerance: true }, JSON.parse(await readFile(sectionPath, 'utf8')));
process.stdout.write(JSON.stringify({ diffReport: result.diffReport }));
`;
const childSection = async (sandbox, paths, root) => {
  const path = join(sandbox, "synthetic-section.json");
  await writeFile(path, JSON.stringify(root));
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      API_CHILD,
      join(repository, "app/mcp-server/dist/service/image-compare-service.js"),
      ...paths,
      path,
    ],
    {
      cwd: sandbox,
      encoding: "utf8",
      timeout: 60_000,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: sandbox,
        FIGDIFF_HOME: sandbox,
        FIGDIFF_ALLOWED_DIRS: sandbox,
      },
    },
  );
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
  return { ...extract(JSON.parse(child.stdout)), stderr: child.stderr };
};
const cases = [];
for (const config of [
  { size: 64, centers: [20, 30, 40], widths: [5, 7] },
  { size: 80, centers: [20, 40, 60], widths: [7, 9] },
]) {
  for (const route of ["production-mcp-png", "fresh-child-built-api-section"]) {
    const sandbox = await mkdtemp(join(tmpdir(), "figdiff-376-opaque-stroke-"));
    try {
      assert.deepEqual(await hashes(distFiles), initialDist, "Dist changed before case");
      const design = synth(config.size, config.centers, config.widths[0]);
      const screenshot = synth(config.size, config.centers, config.widths[1]);
      let changedPixelCount = 0;
      for (let i = 0; i < config.size * config.size; i++)
        if (design.pixels[i * 4] !== screenshot.pixels[i * 4]) changedPixelCount++;
      assert.equal(changedPixelCount, 102);
      const inputs = [];
      for (const [name, fixture] of [
        ["design", design],
        ["screenshot", screenshot],
      ]) {
        const bytes = await sharp(fixture.pixels, {
          raw: { width: config.size, height: config.size, channels: 4 },
        })
          .png()
          .toBuffer();
        const path = join(sandbox, `${name}.png`);
        await writeFile(path, bytes);
        inputs.push({
          name,
          path,
          inkPixels: fixture.inkPixels,
          rawSha256: hash(fixture.pixels),
          pngSha256: hash(bytes),
        });
      }
      const root = section(config.size);
      const observed =
        route === "production-mcp-png"
          ? await publicMcp(
              sandbox,
              inputs.map((input) => input.path),
            )
          : await childSection(
              sandbox,
              inputs.map((input) => input.path),
              root,
            );
      const name = `${config.widths.join("-to-")}/${route}`;
      const inputEvidence = {
        size: config.size,
        centers: config.centers,
        widths: config.widths,
        section: route.endsWith("section") ? root : null,
        inputs: inputs.map(({ name: inputName, inkPixels, rawSha256, pngSha256 }) => ({
          name: inputName,
          inkPixels,
          rawSha256,
          pngSha256,
        })),
      };
      const critical = observed.issues.filter(
        (issue) => issue.severity === "critical" && issue.signal === "opaque_stroke_width_change",
      );
      if (mode === "green") {
        const prior = baseline.cases.find((entry) => entry.name === name);
        assert.ok(prior, `Missing RED case: ${name}`);
        assert.deepEqual(inputEvidence, prior.inputEvidence, "RED/GREEN inputs differ");
        assert.equal(observed.status, "FAIL", name);
        assert.ok(critical.length > 0, `${name} has no critical opaque_stroke_width_change`);
      }
      cases.push({
        name,
        route,
        freshProcess: true,
        inputEvidence,
        independentGeometry: {
          symmetricExpansionPerSidePx: 1,
          stemLengthPx: 17,
          stemCount: 3,
          changedPixelCount,
          expectedStatus: "FAIL",
        },
        actualStatus: observed.status,
        expectedStatus: "FAIL",
        criticalOpaqueStrokeIssueCount: critical.length,
        violatesExpectedStatus: observed.status !== "FAIL",
        issues: observed.issues,
        stderr: observed.stderr,
      });
      process.stdout.write(
        `${name}: ${observed.status}; critical opaque width issues=${critical.length}\n`,
      );
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  }
}
assert.equal(cases.length, 4);
assert.deepEqual(await hashes(distFiles), initialDist, "Dist changed during run");
const sourceAfter = await snapshot();
const evidence = {
  scope:
    "Original four intentional opaque centered-stem width changes, independently known areas and native coordinates. Two production MCP PNG comparisons retrieve full persisted reports; two synthetic sections execute compareImages in fresh child processes. Section API calls are explicitly not production MCP or live Figma.",
  mode,
  greenAssertionsEnabled: mode === "green",
  executionCommand: [process.execPath, ...process.argv.slice(1)],
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    fonts: "none",
    realImages: "none",
  },
  scriptSha256: hash(await readFile(new URL("./reproduce.mjs", import.meta.url))),
  sourceBefore,
  sourceAfter,
  distSha256: initialDist,
  distStableThroughoutRun: true,
  sourceExecutionWarning:
    mode === "red"
      ? "Source contains work in progress that is not built; only the frozen old dist was executed. Source before/after snapshots are recorded separately."
      : "Runtime claims refer to recorded dist bytes; source snapshots are separately recorded.",
  baselineEvidenceSha256: mode === "green" ? hash(await readFile(resolve(process.argv[5]))) : null,
  cases,
  summary: {
    cases: cases.length,
    expectedFail: 4,
    observedFail: cases.filter((entry) => entry.actualStatus === "FAIL").length,
    knownFalsePass: cases.filter((entry) => entry.actualStatus === "PASS").length,
    casesWithCriticalOpaqueStrokeIssue: cases.filter(
      (entry) => entry.criticalOpaqueStrokeIssueCount > 0,
    ).length,
  },
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(evidence.summary)}\n`);

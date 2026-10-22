import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { URL, pathToFileURL } from "node:url";

assert.equal(process.argv.length, 4, "Usage: node reproduce-reflow.mjs <repository> <output.json>");
const repository = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
const require = createRequire(join(repository, "app/mcp-server/package.json"));
const sharp = require("sharp");
const { Client } = await import(
  pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/index.js"))
);
const { StdioClientTransport } = await import(
  pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/stdio.js"))
);
const SIZE = 128;
const CORE = { x: 29, y: 30, w: 3, h: 6 };
const TEXT = { x: 29, y: 30, w: 15, h: 6 };
const AA = { x: 34, y: 30, w: 10, h: 6 };
const BORDER = { x: 20, y: 49, w: 50, h: 1 };
const PINK = [255, 210, 210];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (args) => execFileSync("git", ["-C", repository, ...args], { encoding: "utf8" });
const sourceFiles = [
  "app/mcp-server/src/service/diff-report-builder.ts",
  "package/shared/src/signal/glyph-edge-raster.ts",
  "package/shared/src/signal/text-reflow.ts",
];
const files = [
  ...sourceFiles,
  ...sourceFiles.map((file) => file.replace("/src/", "/dist/").replace(/\.ts$/, ".js")),
];
const fileHashes = async () =>
  Object.fromEntries(
    await Promise.all(
      files.map(async (file) => [file, hash(await readFile(join(repository, file)))]),
    ),
  );
const initialFileHashes = await fileHashes();
const baseCommit = git(["rev-parse", "HEAD"]).trim();
const diffArguments = ["diff", "--binary", "HEAD", "--", ...sourceFiles];
const initialDiffHash = hash(git(diffArguments));

const paint = (pixels, box, color) => {
  assert.equal(pixels.length, SIZE * SIZE * 4);
  assert.ok([box.x, box.y, box.w, box.h, ...color].every(Number.isInteger));
  assert.ok(box.x >= 0 && box.y >= 0 && box.w > 0 && box.h > 0);
  assert.ok(box.x + box.w <= SIZE && box.y + box.h <= SIZE);
  assert.ok(color.length === 3 && color.every((value) => value >= 0 && value <= 255));
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) pixels.set(color, (y * SIZE + x) * 4);
  }
};
const fixture = (screenshot, borderShift, mutation = "none") => {
  const pixels = Buffer.alloc(SIZE * SIZE * 4, 255);
  if (mutation !== "missing") {
    if (mutation === "heavy") paint(pixels, TEXT, [0, 0, 0]);
    else {
      paint(pixels, CORE, mutation === "token" ? [60, 0, 120] : [0, 0, 0]);
      const edge = screenshot ? 234 : 200;
      paint(pixels, AA, [edge, edge, edge]);
      if (screenshot && mutation === "none") {
        paint(pixels, { ...CORE, h: 1 }, [2, 2, 2]);
        paint(pixels, { x: 32, y: 30, w: 2, h: 1 }, [253, 253, 253]);
      }
    }
  }
  if (borderShift !== undefined) {
    paint(pixels, { ...BORDER, y: BORDER.y + (screenshot ? borderShift : 0) }, PINK);
  }
  return pixels;
};
const pixel = (pixels, x, y) => [...pixels.subarray((y * SIZE + x) * 4, (y * SIZE + x) * 4 + 3)];
const countColor = (pixels, color) => {
  let count = 0;
  for (let index = 0; index < SIZE * SIZE; index++) {
    const offset = index * 4;
    assert.equal(pixels[offset + 3], 255);
    if (color.every((value, channel) => pixels[offset + channel] === value)) count++;
  }
  return count;
};
const textInk = (pixels) => {
  let ink = 0;
  for (let y = TEXT.y; y < TEXT.y + TEXT.h; y++) {
    for (let x = TEXT.x; x < TEXT.x + TEXT.w; x++) {
      const color = pixel(pixels, x, y);
      assert.equal(color[0], color[1]);
      assert.equal(color[1], color[2]);
      ink += (255 - color[0]) / 255;
    }
  }
  return ink;
};
const validatePixels = (design, screenshot, borderShift, mutation) => {
  assert.equal(countColor(design, [0, 0, 0]), 18);
  assert.equal(countColor(design, [200, 200, 200]), 60);
  assert.equal(
    countColor(screenshot, [0, 0, 0]),
    mutation === "heavy" ? 90 : mutation === "none" ? 15 : 0,
  );
  assert.equal(
    countColor(screenshot, [234, 234, 234]),
    mutation === "missing" || mutation === "heavy" ? 0 : 60,
  );
  assert.equal(countColor(screenshot, [60, 0, 120]), mutation === "token" ? 18 : 0);
  if (mutation === "none") {
    assert.equal(countColor(screenshot, [2, 2, 2]), 3);
    assert.equal(countColor(screenshot, [253, 253, 253]), 2);
  }
  for (let y = CORE.y + 1; y < CORE.y + CORE.h; y++) {
    assert.deepEqual(pixel(design, CORE.x, y), [0, 0, 0]);
    assert.deepEqual(
      pixel(screenshot, CORE.x, y),
      mutation === "missing" ? [255, 255, 255] : mutation === "token" ? [60, 0, 120] : [0, 0, 0],
    );
  }
  const borderPixels = borderShift === undefined ? 0 : BORDER.w * BORDER.h;
  assert.equal(countColor(design, PINK), borderPixels);
  assert.equal(countColor(screenshot, PINK), borderPixels);
  if (borderShift !== undefined) {
    assert.deepEqual(pixel(design, BORDER.x, BORDER.y), PINK);
    assert.deepEqual(pixel(screenshot, BORDER.x, BORDER.y + borderShift), PINK);
    assert.deepEqual(pixel(screenshot, BORDER.x, BORDER.y), [255, 255, 255]);
  }
  const independent = {
    designCorePixels: 18,
    designAaPixels: 60,
    screenshotCorePixels: countColor(screenshot, [0, 0, 0]),
    screenshotTokenPixels: countColor(screenshot, [60, 0, 120]),
    borderPixelsPerImage: borderPixels,
    borderShift: borderShift ?? null,
  };
  if (mutation === "none") {
    const designInk = textInk(design);
    const screenshotInk = textInk(screenshot);
    const expectedDesign = 18 + 60 * (55 / 255);
    const expectedScreenshot = 18 - 6 / 255 + 4 / 255 + 60 * (21 / 255);
    assert.ok(Math.abs(designInk - expectedDesign) < 1e-12);
    assert.ok(Math.abs(screenshotInk - expectedScreenshot) < 1e-12);
    const delta = (designInk - screenshotInk) / designInk;
    assert.ok(delta > 0.25 && delta < 0.3);
    Object.assign(independent, { designInk, screenshotInk, textInkDelta: delta });
  }
  return independent;
};
const callMcp = async (sandbox, paths, rasterizationTolerance) => {
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
  const client = new Client({ name: "issue-376-reflow-runtime", version: "1.0.0" });
  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: "compare_design",
      arguments: {
        design_source: paths[0],
        screenshot: paths[1],
        threshold: 0,
        rasterization_tolerance: rasterizationTolerance,
      },
    });
    assert.ok(!result.isError, JSON.stringify(result.content));
    assert.ok(result.structuredContent && typeof result.structuredContent === "object");
    return { status: result.structuredContent.status, stderr };
  } finally {
    await client.close();
  }
};
const variants = [
  { name: "text-alone", mutation: "none", expected: "PASS" },
  { name: "colored-neighbor-1px", borderShift: 1, mutation: "none", expected: "PASS" },
  { name: "colored-neighbor-2px", borderShift: 2, mutation: "none", expected: "FAIL" },
  { name: "colored-neighbor-56px", borderShift: 56, mutation: "none", expected: "FAIL" },
  { name: "missing-text", borderShift: 1, mutation: "missing", expected: "FAIL" },
  { name: "heavy-text", borderShift: 1, mutation: "heavy", expected: "FAIL" },
  { name: "token-change", borderShift: 1, mutation: "token", expected: "FAIL" },
  {
    name: "opt-in-off",
    borderShift: 1,
    mutation: "none",
    rasterizationTolerance: false,
    expected: "FAIL",
  },
];
const cases = [];
for (const variant of variants) {
  const sandbox = await mkdtemp(join(tmpdir(), "figdiff-376-reflow-"));
  try {
    const design = fixture(false, variant.borderShift);
    const screenshot = fixture(true, variant.borderShift, variant.mutation);
    const independentPixels = validatePixels(
      design,
      screenshot,
      variant.borderShift,
      variant.mutation,
    );
    const inputs = [];
    for (const [name, pixels] of [
      ["design", design],
      ["screenshot", screenshot],
    ]) {
      const bytes = await sharp(pixels, { raw: { width: SIZE, height: SIZE, channels: 4 } })
        .png()
        .toBuffer();
      const path = join(sandbox, `${name}.png`);
      await writeFile(path, bytes);
      inputs.push({ name, path, rawSha256: hash(pixels), pngSha256: hash(bytes) });
    }
    const observed = await callMcp(
      sandbox,
      inputs.map((input) => input.path),
      variant.rasterizationTolerance !== false,
    );
    assert.equal(observed.status, variant.expected, `${variant.name}: ${JSON.stringify(observed)}`);
    cases.push({
      name: variant.name,
      mutation: variant.mutation,
      rasterizationTolerance: variant.rasterizationTolerance !== false,
      threshold: 0,
      independentPixels,
      expectedStatus: variant.expected,
      actualStatus: observed.status,
      freshMcpProcess: true,
      stderr: observed.stderr,
      inputs: inputs.map(({ name, rawSha256, pngSha256 }) => ({ name, rawSha256, pngSha256 })),
    });
    process.stdout.write(`${variant.name}: ${observed.status}\n`);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
}
assert.deepEqual(
  await fileHashes(),
  initialFileHashes,
  "Product sources/dist changed during evidence run",
);
assert.equal(git(["rev-parse", "HEAD"]).trim(), baseCommit);
assert.equal(hash(git(diffArguments)), initialDiffHash);
const evidence = {
  scope:
    "Known128x128 synthetic opaque pixels; independent rectangle areas/core coordinates and own-white-background ink math. Actual built MCP stdio, fresh temporary home per case. No real images copied/written/uploaded; no Figma/font/device acceptance claimed.",
  executionCommand: [process.execPath, ...process.argv.slice(1)],
  baseCommit,
  workingTreeDiffCommand: ["git", ...diffArguments],
  workingTreeDiffSha256: initialDiffHash,
  scriptSha256: hash(await readFile(new URL("./reproduce-reflow.mjs", import.meta.url))),
  fileSha256: initialFileHashes,
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    width: SIZE,
    height: SIZE,
    font: "none",
    scale: 1,
  },
  cases,
  summary: {
    cases: cases.length,
    passed: cases.filter((entry) => entry.actualStatus === entry.expectedStatus).length,
  },
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(evidence.summary)}\n`);

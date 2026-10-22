import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

assert.equal(process.argv.length, 4, "Usage: node reproduce-stroke.mjs <repository> <output.json>");
const repository = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
const require = createRequire(join(repository, "package.json"));
const sharp = require("sharp");
const { classifySameTokenRasterization, estimateContentOffset } = await import(
  pathToFileURL(join(repository, "package/shared/dist/signal/glyph-edge-raster.js"))
);
const { compareImages } = await import(
  pathToFileURL(join(repository, "app/mcp-server/dist/service/image-compare-service.js"))
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const files = [
  "package/shared/src/signal/glyph-edge-raster.ts",
  "package/shared/src/signal/text-reflow.ts",
  "app/mcp-server/src/service/diff-report-builder.ts",
  "app/mcp-server/src/service/image-compare-service.ts",
  "package/shared/dist/signal/glyph-edge-raster.js",
  "package/shared/dist/signal/text-reflow.js",
  "app/mcp-server/dist/service/diff-report-builder.js",
  "app/mcp-server/dist/service/image-compare-service.js",
];
const snapshot = async () => ({
  sourceCommit: execFileSync("git", ["-C", repository, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  productDiffFromHeadSha256: hash(
    execFileSync("git", ["-C", repository, "diff", "HEAD", "--", ...files]),
  ),
  fileSha256: Object.fromEntries(
    await Promise.all(
      files.map(async (file) => [file, hash(await readFile(join(repository, file)))]),
    ),
  ),
});
const before = await snapshot();
const paint = (pixels, size, x, y, value) => {
  assert.equal(pixels.length, size * size * 4);
  assert.ok([size, x, y, value].every(Number.isInteger));
  assert.ok(size > 0 && x >= 0 && x < size && y >= 0 && y < size && value >= 0 && value <= 255);
  pixels.fill(value, (y * size + x) * 4, (y * size + x) * 4 + 3);
};
const blank = (size, background) => {
  const pixels = new Uint8ClampedArray(size * size * 4).fill(background);
  for (let index = 0; index < size * size; index++) pixels[index * 4 + 3] = 255;
  return pixels;
};
const points = [
  [7, 6],
  [7, 7],
  [8, 7],
  [7, 8],
  [7, 9],
  [7, 10],
  [7, 11],
  [8, 12],
  [9, 12],
  [10, 12],
  [11, 12],
  [12, 12],
  [11, 7],
];
const offsetCases = [];
for (const solidPoints of [3, 8]) {
  const size = 24;
  const fixture = (background, edge, dx) => {
    const pixels = blank(size, background);
    for (const [index, [x, y]] of points.entries()) {
      paint(pixels, size, x + dx, y, index < solidPoints ? 51 : edge);
    }
    return pixels;
  };
  const design = fixture(255, 235, 0);
  const screenshot = fixture(251, 232, 2);
  const background = [255, 255, 255];
  const foreground = [51, 51, 51];
  const commonBackgroundOffset = estimateContentOffset(
    design,
    screenshot,
    size,
    { left: 0, top: 0, right: size, bottom: size },
    background,
    foreground,
    foreground,
  );
  const classified = classifySameTokenRasterization(
    design,
    screenshot,
    size,
    size,
    { x: 0, y: 0, w: size, h: size },
    0,
  );
  assert.ok(classified);
  // 既存alpha条件を使うべき淡い点は0.1未満であり、背景の共用だけで有効点へ昇格していた。
  const designEdgeAlpha = (255 - 235) / (255 - 51);
  const screenshotEdgeAlpha = (251 - 232) / (251 - 51);
  assert.ok(designEdgeAlpha < 0.1 && screenshotEdgeAlpha < 0.1);
  if (solidPoints === 3) {
    assert.ok(solidPoints * 2 < 8);
    assert.equal(classified.contentOffset, undefined);
  } else {
    assert.ok(classified.contentOffset);
    assert.ok(Math.abs(classified.contentOffset.dx - 2) < 0.01);
    assert.ok(classified.contentOffset.peak > 0.99);
  }
  offsetCases.push({
    solidPointsPerImage: solidPoints,
    independentKnownDisplacement: { dx: 2, dy: 0 },
    designEdgeAlpha,
    screenshotEdgeAlpha,
    commonBackgroundOffset: commonBackgroundOffset ?? null,
    correctedOffset: classified.contentOffset ?? null,
    expected:
      solidPoints === 3
        ? "unmeasurable: at most six informative pairs"
        : "measurable two-pixel offset",
    inputHashes: { design: hash(design), screenshot: hash(screenshot) },
  });
}

const weightCases = [];
for (const { size, centers, designWidth, screenshotWidth } of [
  { size: 64, centers: [20, 30, 40], designWidth: 5, screenshotWidth: 7 },
  { size: 80, centers: [20, 40, 60], designWidth: 7, screenshotWidth: 9 },
]) {
  const stems = (width) => {
    assert.ok(Number.isSafeInteger(width) && width > 0 && width % 2 === 1);
    const pixels = blank(size, 255);
    for (const center of centers) {
      for (let y = 20; y < 37; y++) {
        for (let dx = -(width - 1) / 2; dx <= (width - 1) / 2; dx++) {
          paint(pixels, size, center + dx, y, 51);
        }
      }
    }
    const inkPixels = Array.from({ length: size * size }, (_, index) => pixels[index * 4]).filter(
      (value) => value === 51,
    ).length;
    assert.equal(inkPixels, 3 * 17 * width);
    return { pixels, inkPixels };
  };
  const design = stems(designWidth);
  const screenshot = stems(screenshotWidth);
  const png = async (pixels) =>
    (
      await sharp(Buffer.from(pixels), { raw: { width: size, height: size, channels: 4 } })
        .png()
        .toBuffer()
    ).toString("base64");
  const designBase64 = await png(design.pixels);
  const screenshotBase64 = await png(screenshot.pixels);
  const node = (children = []) => ({
    id: randomUUID(),
    name: "Synthetic stroke section",
    type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width: size, height: size },
    absoluteRenderBounds: null,
    fills: [],
    strokes: [],
    effects: [],
    children,
  });
  for (const useSection of [false, true]) {
    const result = await compareImages(
      { designBase64, screenshotBase64, rasterizationTolerance: true },
      useSection ? node([node()]) : undefined,
    );
    // 既存仕様との矛盾を記録する観測。製品のPASSを正解として承認するテストではない。
    weightCases.push({
      route: useSection ? "section" : "PNG",
      construction: `Three centered opaque stems intentionally widened ${designWidth} to ${screenshotWidth} pixels; center and length unchanged`,
      designStrokeWidth: designWidth,
      screenshotStrokeWidth: screenshotWidth,
      designInkPixels: design.inkPixels,
      screenshotInkPixels: screenshot.inkPixels,
      independentlyExpectedVerdict: "fail",
      observedVerdict: result.diffReport?.aggregateVerdict,
      violatesExpectedVerdict: result.diffReport?.aggregateVerdict !== "fail",
      classifierEvidence: result.diffReport?.regionScores
        .filter((entry) => entry.sameTokenRasterization)
        .map((entry) => ({
          bbox: entry.bbox,
          inkDelta: entry.sameTokenRasterization.inkCoverageDelta,
          inkLimit: entry.sameTokenRasterization.inkLimit,
        })),
    });
  }
}
assert.deepEqual(
  await snapshot(),
  before,
  "Product source, build or HEAD changed during execution",
);
const evidence = {
  scope:
    "Constructed pixels and actual built APIs. Offset fix assertions are correctness controls; weight cases expose an unresolved policy conflict and are not passing acceptance results.",
  ...before,
  productFilesStableDuringRun: true,
  hasUncommittedChanges:
    execFileSync("git", ["-C", repository, "status", "--porcelain=v1"], { encoding: "utf8" })
      .length > 0,
  environment: { node: process.version, platform: process.platform, arch: process.arch },
  offsetCases,
  weightCases,
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
process.stdout.write(
  `${JSON.stringify({ offsetAssertionsPassed: offsetCases.length, unresolvedWeightCases: weightCases.filter((entry) => entry.violatesExpectedVerdict).length })}\n`,
);

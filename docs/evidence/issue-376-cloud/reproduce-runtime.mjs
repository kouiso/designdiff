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

if (process.argv.length !== 4) {
  throw new Error("Usage: node reproduce-runtime.mjs <repository> <output.json>");
}
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
const { classifyTextReflow } = await import(
  pathToFileURL(join(repository, "package/shared/dist/signal/text-reflow.js"))
);
const SIZE = 256;
const FOREGROUND = 51;
const BORDER = { x: 30, y: 90, w: 90, h: 2 };
const KEYBOARD = { firstX: 20, lastX: 230, step: 18, y: 170, w: 8, h: 15 };
const KNOWN_INK_PIXELS = 1620;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

const paint = (pixels, size, box, foreground) => {
  assert.equal(pixels.length, size * size * 4);
  assert.ok([box.x, box.y, box.w, box.h, foreground].every(Number.isInteger));
  assert.ok(box.x >= 0 && box.y >= 0 && box.w > 0 && box.h > 0);
  assert.ok(box.x + box.w <= size && box.y + box.h <= size);
  assert.ok(foreground >= 0 && foreground <= 255);
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) {
      const index = (y * size + x) * 4;
      pixels.fill(foreground, index, index + 3);
    }
  }
};
const blank = (background, size) => {
  assert.ok(Number.isInteger(background) && background >= 0 && background <= 255);
  const pixels = Buffer.alloc(size * size * 4, background);
  for (let pixel = 0; pixel < size * size; pixel++) pixels[pixel * 4 + 3] = 255;
  return pixels;
};
const fixture = ({ background, displacement = 0, strokeScale = 1, foreground = FOREGROUND }) => {
  const pixels = blank(background, SIZE);
  paint(
    pixels,
    SIZE,
    { ...BORDER, y: BORDER.y + displacement, h: BORDER.h * strokeScale },
    foreground,
  );
  for (let x = KEYBOARD.firstX; x < KEYBOARD.lastX; x += KEYBOARD.step) {
    paint(
      pixels,
      SIZE,
      { x, y: KEYBOARD.y, w: KEYBOARD.w * strokeScale, h: KEYBOARD.h },
      foreground,
    );
  }
  return pixels;
};
const countValue = (pixels, value) => {
  let count = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    assert.equal(pixels[offset], pixels[offset + 1]);
    assert.equal(pixels[offset], pixels[offset + 2]);
    assert.equal(pixels[offset + 3], 255);
    if (pixels[offset] === value) count++;
  }
  return count;
};
const pixelAt = (pixels, x, y) => pixels[(y * SIZE + x) * 4];
const variants = [
  { name: "same", displacement: 0, strokeScale: 1, foreground: FOREGROUND, expectedStatus: "PASS" },
  {
    name: "partial-2px",
    displacement: -2,
    strokeScale: 1,
    foreground: FOREGROUND,
    expectedStatus: "FAIL",
  },
  {
    name: "partial-56px",
    displacement: -56,
    strokeScale: 1,
    foreground: FOREGROUND,
    expectedStatus: "FAIL",
  },
  {
    name: "double-ink",
    displacement: 0,
    strokeScale: 2,
    foreground: FOREGROUND,
    expectedStatus: "FAIL",
  },
  {
    name: "foreground-91",
    displacement: 0,
    strokeScale: 1,
    foreground: 91,
    expectedStatus: "FAIL",
  },
];

const callMcp = async (sandbox, designPath, screenshotPath) => {
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
  const client = new Client({ name: "issue-376-cloud-runtime", version: "1.0.0" });
  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: "compare_design",
      arguments: {
        design_source: designPath,
        screenshot: screenshotPath,
        rasterization_tolerance: true,
      },
    });
    assert.ok(!result.isError, JSON.stringify(result.content));
    assert.ok(result.structuredContent && typeof result.structuredContent === "object");
    return { result: result.structuredContent, stderr };
  } finally {
    await client.close();
  }
};

const execute = async (background, variant) => {
  const sandbox = await mkdtemp(join(tmpdir(), "figdiff-376-cloud-runtime-"));
  try {
    const design = fixture({ background: background.designBackground });
    const screenshot = fixture({ background: background.screenshotBackground, ...variant });
    const designInkPixels = countValue(design, FOREGROUND);
    const screenshotInkPixels = countValue(screenshot, variant.foreground);
    // 既知の矩形面積と移動先を、製品の判定結果とは独立に検証する。
    assert.equal(designInkPixels, KNOWN_INK_PIXELS);
    assert.equal(screenshotInkPixels, KNOWN_INK_PIXELS * variant.strokeScale);
    assert.equal(
      pixelAt(screenshot, BORDER.x, BORDER.y + variant.displacement),
      variant.foreground,
    );
    assert.equal(pixelAt(screenshot, KEYBOARD.firstX, KEYBOARD.y), variant.foreground);
    if (variant.displacement < -1) {
      assert.equal(pixelAt(screenshot, BORDER.x, BORDER.y), background.screenshotBackground);
    }
    if (variant.displacement === -1) {
      assert.equal(
        pixelAt(screenshot, BORDER.x, BORDER.y + BORDER.h - 1),
        background.screenshotBackground,
      );
    }
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
      inputs.push({ name, path, pngSha256: hash(bytes), rawSha256: hash(pixels) });
    }
    const observed = await callMcp(sandbox, inputs[0].path, inputs[1].path);
    assert.equal(
      observed.result.status,
      variant.expectedStatus,
      `${variant.name}: ${JSON.stringify(observed)}`,
    );
    const name = `${background.designBackground}-${background.screenshotBackground}/${variant.name}`;
    process.stdout.write(`${name}: ${observed.result.status}\n`);
    return {
      name,
      ...background,
      displacement: variant.displacement,
      strokeScale: variant.strokeScale,
      foreground: variant.foreground,
      independentPixels: { designInkPixels, screenshotInkPixels, keyboardDisplacement: 0 },
      expectedStatus: variant.expectedStatus,
      actualStatus: observed.result.status,
      freshMcpProcess: true,
      stderr: observed.stderr,
      inputs: inputs.map(({ name: inputName, pngSha256, rawSha256 }) => ({
        name: inputName,
        pngSha256,
        rawSha256,
      })),
    };
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
};

const cases = [];
for (const background of [
  { designBackground: 253, screenshotBackground: 255 },
  { designBackground: 255, screenshotBackground: 253 },
]) {
  for (const variant of variants) cases.push(await execute(background, variant));
}
cases.push(
  await execute(
    { designBackground: 255, screenshotBackground: 255 },
    {
      name: "partial-1px-existing-tolerance",
      displacement: -1,
      strokeScale: 1,
      foreground: FOREGROUND,
      expectedStatus: "PASS",
    },
  ),
);

const reflowCases = [];
for (const [designBackground, screenshotBackground, designEdge, screenshotEdge] of [
  [253, 255, 126, 127],
  [255, 253, 127, 126],
]) {
  const size = 80;
  const make = (background, edge) => {
    const pixels = blank(background, size);
    paint(pixels, size, { x: 10, y: 20, w: 8, h: 12 }, 0);
    paint(pixels, size, { x: 40, y: 20, w: 8, h: 12 }, edge);
    assert.equal(countValue(pixels, 0), 96);
    assert.equal(countValue(pixels, edge), 96);
    return pixels;
  };
  const design = make(designBackground, designEdge);
  const screenshot = make(screenshotBackground, screenshotEdge);
  const result = classifyTextReflow(
    Uint8ClampedArray.from(design),
    Uint8ClampedArray.from(screenshot),
    size,
    size,
    { x: 0, y: 0, w: size, h: size },
  );
  assert.ok(result);
  assert.equal(result.classification, "text-block-reflow");
  assert.equal(result.designComponentCount, 2);
  assert.equal(result.screenshotComponentCount, 2);
  assert.equal(result.designLineCount, 1);
  assert.equal(result.screenshotLineCount, 1);
  assert.ok(result.inkCoverageDelta < 0.00002);
  reflowCases.push({
    designBackground,
    screenshotBackground,
    designEdge,
    screenshotEdge,
    independentPixels: { opaqueCorePixels: 96, halfCoveredPixels: 96, components: 2 },
    result,
  });
}

const sourceCommit = execFileSync("git", ["-C", repository, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const result = {
  scope:
    "Constructed opaque grayscale border and fixed keyboard; known raw geometry/area defines expected outcomes. Actual built MCP stdio uses a fresh temporary home for every case. No real fixture images or Figma/API acceptance claimed.",
  sourceCommit,
  scriptSha256: hash(await readFile(new URL("./reproduce-runtime.mjs", import.meta.url))),
  builderDistSha256: hash(
    await readFile(join(repository, "app/mcp-server/dist/service/diff-report-builder.js")),
  ),
  environment: {
    node: process.version,
    width: SIZE,
    height: SIZE,
    font: "none",
    browser: "none",
    scale: 1,
  },
  cases,
  reflowCases,
  summary: {
    mcpCases: cases.length,
    passedMcpCases: cases.filter((entry) => entry.actualStatus === entry.expectedStatus).length,
    reflowCases: reflowCases.length,
  },
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result.summary)}\n`);

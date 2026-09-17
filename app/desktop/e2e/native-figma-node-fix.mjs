import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, statfs, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

import { _electron as electron, expect } from "playwright/test";
import sharp from "sharp";

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, "../../..");
const require = createRequire(import.meta.url);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const collectFiles = async (root) => {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(path)));
    else files.push(path);
  }
  return files;
};
const buildRoots = [
  join(repository, "app/desktop/dist"),
  join(repository, "package/shared/dist"),
  join(repository, "package/credential-store/dist"),
];
const buildIdentityFiles = [
  join(repository, "pnpm-lock.yaml"),
  join(repository, "package.json"),
  join(repository, "app/desktop/package.json"),
  join(repository, "package/shared/package.json"),
  join(repository, "package/credential-store/package.json"),
];
const captureBuild = async () => {
  const paths = [
    ...(await Promise.all(buildRoots.map(collectFiles))).flat(),
    ...buildIdentityFiles,
  ].sort();
  const files = await Promise.all(
    paths.map(async (path) => ({
      path: path.slice(repository.length + 1),
      size: (await stat(path)).size,
      sha256: sha256(await readFile(path)),
    })),
  );
  return {
    roots: buildRoots.map((path) => path.slice(repository.length + 1)),
    identityFiles: buildIdentityFiles.map((path) => path.slice(repository.length + 1)),
    fileCount: files.length,
    sha256: sha256(
      Buffer.from(files.map((file) => `${file.path}\0${file.size}\0${file.sha256}`).join("\n")),
    ),
    files,
  };
};

const evidencePath = process.env.FIGDIFF_FIGMA_NODE_FIX_EVIDENCE;
if (!evidencePath) throw new Error("FIGDIFF_FIGMA_NODE_FIX_EVIDENCE is required");
const evidence = resolve(evidencePath);
await mkdir(evidence, { recursive: true });
const filesystem = await statfs(evidence);
if (filesystem.bavail * filesystem.bsize < 512 * 1024 * 1024) {
  throw new Error("Native verification requires at least 512 MiB free before launch");
}
const startedAt = new Date().toISOString();
const buildAtStart = await captureBuild();
const revision = execFileSync("/usr/bin/git", ["rev-parse", "HEAD"], {
  cwd: repository,
  encoding: "utf8",
}).trim();
const dirtyState = execFileSync("/usr/bin/git", ["status", "--porcelain=v1"], {
  cwd: repository,
  encoding: "utf8",
})
  .trimEnd()
  .split("\n")
  .filter(Boolean);

const fixture = {
  fileKey: "NODEFIX123",
  sourceVersion: "version-fixture-42",
  frameNodeId: "1:2",
  targetNodeId: "3:4",
  outsideTargetNodeId: "9:9",
  outsideFrameNodeId: "8:8",
  scale: 2,
  rootBox: { x: 100, y: 200, width: 100, height: 100 },
  targetBox: { x: 110, y: 210, width: 20, height: 20 },
  crop: { x: 10, y: 10, width: 180, height: 180 },
  mask: { id: "target-left-half", x: 10, y: 10, width: 20, height: 40 },
};
const sandbox = await mkdtemp(join(evidence, "native-figma-node-fix-"));
const isolatedHome = join(sandbox, "home");
const userData = join(sandbox, "user-data");
const projectDirectory = join(isolatedHome, ".figdiff/projects/figma-node-fix-fixture");
await Promise.all([
  mkdir(projectDirectory, { recursive: true }),
  mkdir(userData, { recursive: true }),
]);

const makePixels = ({ target, regressionGrid }) => {
  const width = 200;
  const height = 200;
  const pixels = Buffer.alloc(width * height * 4, 255);
  const paint = (startX, startY, size) => {
    for (let y = startY; y < startY + size; y += 1) {
      for (let x = startX; x < startX + size; x += 1) {
        pixels.set([0, 0, 0, 255], (y * width + x) * 4);
      }
    }
  };
  if (target) paint(20, 20, 40);
  if (regressionGrid) paint(120, 120, 40);
  return { pixels, width, height };
};
const writeRawPng = async (path, image) =>
  sharp(image.pixels, { raw: { width: image.width, height: image.height, channels: 4 } })
    .png()
    .toFile(path);
const inputPaths = {
  design: join(isolatedHome, "figma-version-pinned-design.png"),
  before: join(isolatedHome, "implementation-before.png"),
  after: join(isolatedHome, "implementation-after.png"),
};
await Promise.all([
  writeRawPng(inputPaths.design, makePixels({ target: true, regressionGrid: true })),
  writeRawPng(inputPaths.before, makePixels({ target: false, regressionGrid: true })),
  writeRawPng(inputPaths.after, makePixels({ target: true, regressionGrid: false })),
]);
await Promise.all(
  Object.values(inputPaths).map(async (path) => {
    await writeFile(join(evidence, basename(path)), await readFile(path));
  }),
);

const readCroppedPixels = async (path) => {
  const image = await sharp(path)
    .extract({
      left: fixture.crop.x,
      top: fixture.crop.y,
      width: fixture.crop.width,
      height: fixture.crop.height,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return image;
};
const independentDifference = async (implementationPath) => {
  const [design, implementation] = await Promise.all([
    readCroppedPixels(inputPaths.design),
    readCroppedPixels(implementationPath),
  ]);
  let targetDifference = 0;
  let regressionGridDifference = 0;
  let totalDifference = 0;
  for (let y = 0; y < design.info.height; y += 1) {
    for (let x = 0; x < design.info.width; x += 1) {
      const masked =
        x >= fixture.mask.x &&
        x < fixture.mask.x + fixture.mask.width &&
        y >= fixture.mask.y &&
        y < fixture.mask.y + fixture.mask.height;
      if (masked) continue;
      const offset = (y * design.info.width + x) * 4;
      if (
        design.data
          .subarray(offset, offset + 4)
          .equals(implementation.data.subarray(offset, offset + 4))
      ) {
        continue;
      }
      totalDifference += 1;
      if (x >= 10 && x < 50 && y >= 10 && y < 50) targetDifference += 1;
      if (x >= 110 && x < 150 && y >= 110 && y < 150) regressionGridDifference += 1;
    }
  }
  return { targetDifference, regressionGridDifference, totalDifference };
};
const pixelOracle = {
  before: await independentDifference(inputPaths.before),
  after: await independentDifference(inputPaths.after),
};
assert.deepEqual(pixelOracle.before, {
  targetDifference: 800,
  regressionGridDifference: 0,
  totalDifference: 800,
});
assert.deepEqual(pixelOracle.after, {
  targetDifference: 0,
  regressionGridDifference: 1_600,
  totalDifference: 1_600,
});
const inputHashes = Object.fromEntries(
  await Promise.all(
    Object.entries(inputPaths).map(async ([name, path]) => [name, sha256(await readFile(path))]),
  ),
);
const exportedImageMetadata = await sharp(inputPaths.design).metadata();
assert.equal(exportedImageMetadata.width, fixture.rootBox.width * fixture.scale);
assert.equal(exportedImageMetadata.height, fixture.rootBox.height * fixture.scale);

await writeFile(
  join(projectDirectory, "project.json"),
  JSON.stringify({
    id: "figma-node-fix-fixture",
    name: "Figma node fix fixture",
    implementationUrl: "http://localhost:3000",
    pages: [
      {
        id: "fixture-page",
        name: "Fixture page",
        path: "/",
        designSources: [
          {
            id: "fixture-figma",
            type: "figma",
            label: "Synthetic versioned Figma frame",
            figmaUrl: `https://www.figma.com/design/${fixture.fileKey}/Fixture`,
            fileKey: fixture.fileKey,
          },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  }),
);

const rootNode = {
  id: fixture.frameNodeId,
  name: "Verification frame",
  type: "FRAME",
  absoluteBoundingBox: fixture.rootBox,
  children: [
    {
      id: "2:3",
      name: "Deep container",
      type: "GROUP",
      absoluteBoundingBox: { x: 105, y: 205, width: 50, height: 50 },
      children: [
        {
          id: fixture.targetNodeId,
          name: "Deep target",
          type: "RECTANGLE",
          absoluteBoundingBox: fixture.targetBox,
          children: [],
        },
      ],
    },
    {
      id: "5:6",
      name: "Regression grid",
      type: "RECTANGLE",
      absoluteBoundingBox: { x: 160, y: 260, width: 20, height: 20 },
      children: [],
    },
  ],
};
const figmaFile = {
  name: "Synthetic node verification file",
  document: {
    id: "0:0",
    name: "Document",
    type: "DOCUMENT",
    children: [{ id: "0:1", name: "Page", type: "CANVAS", children: [rootNode] }],
  },
};
const requestLog = join(evidence, "figma-http-requests.jsonl");
const ipcLog = join(evidence, "native-ipc.jsonl");
const bootstrap = join(sandbox, "bootstrap.mjs");
await writeFile(
  bootstrap,
  `
import os from "node:os";
import { appendFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { app, ipcMain } from "electron";
os.homedir = () => ${JSON.stringify(isolatedHome)};
syncBuiltinESMExports();
app.setPath("home", ${JSON.stringify(isolatedHome)});
app.setPath("userData", ${JSON.stringify(userData)});
const requestLog = ${JSON.stringify(requestLog)};
const ipcLog = ${JSON.stringify(ipcLog)};
const fixture = ${JSON.stringify(fixture)};
const rootNode = ${JSON.stringify(rootNode)};
const figmaFile = ${JSON.stringify(figmaFile)};
const png = Buffer.from(${JSON.stringify((await readFile(inputPaths.design)).toString("base64"))}, "base64");
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => originalHandle(channel, async (event, ...args) => {
  if (!channel.startsWith("figma:") && !channel.startsWith("ignore-region:")) {
    return handler(event, ...args);
  }
  appendFileSync(ipcLog, JSON.stringify({ phase: "request", channel, args }) + "\\n");
  try {
    const result = await handler(event, ...args);
    const loggedResult = channel === "figma:get-node-verification-source"
      ? { ...result, imageBase64: "<base64:" + result.imageBase64.length + ">" }
      : result;
    appendFileSync(ipcLog, JSON.stringify({ phase: "response", channel, result: loggedResult }) + "\\n");
    return result;
  } catch (error) {
    appendFileSync(ipcLog, JSON.stringify({ phase: "error", channel, error: String(error) }) + "\\n");
    throw error;
  }
});
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  const method = init.method ?? (typeof input === "string" ? "GET" : input.method);
  appendFileSync(requestLog, JSON.stringify({ method, url }) + "\\n");
  if (method !== "GET") throw new Error("Synthetic Figma boundary only permits GET");
  const parsed = new URL(url);
  if (parsed.origin === "https://api.figma.com" && parsed.pathname === "/v1/files/" + fixture.fileKey) {
    return Response.json(figmaFile);
  }
  if (parsed.origin === "https://api.figma.com" && parsed.pathname === "/v1/files/" + fixture.fileKey + "/nodes") {
    const requestedId = parsed.searchParams.get("ids");
    const version = parsed.searchParams.get("version");
    if (![fixture.frameNodeId, fixture.outsideFrameNodeId].includes(requestedId)) {
      throw new Error("Unexpected synthetic node request: " + requestedId);
    }
    if (version !== null && version !== fixture.sourceVersion) {
      throw new Error("Unexpected synthetic version: " + version);
    }
    return Response.json({
      version: fixture.sourceVersion,
      nodes: { [requestedId]: { document: rootNode } },
    });
  }
  if (parsed.origin === "https://api.figma.com" && parsed.pathname === "/v1/images/" + fixture.fileKey) {
    const requestedId = parsed.searchParams.get("ids");
    if (requestedId !== fixture.frameNodeId) {
      throw new Error("Unexpected synthetic export node: " + requestedId);
    }
    const version = parsed.searchParams.get("version");
    const suffix = version === null ? "initial" : "pinned";
    return Response.json({ images: { [requestedId]: "https://figma-fixture.invalid/" + suffix + ".png" } });
  }
  if (parsed.origin === "https://figma-fixture.invalid") {
    return new Response(png, { status: 200, headers: { "content-type": "image/png" } });
  }
  throw new Error("Native node verification forbids unexpected network access: " + url);
};
const credentials = await import(${JSON.stringify(pathToFileURL(join(repository, "package/credential-store/dist/index.js")).href)});
credentials.selectFileCredentialBackend();
credentials.savePat("figd_artificial_native_node_fixture");
await import(${JSON.stringify(pathToFileURL(join(repository, "app/desktop/dist/main/main.js")).href)});
`,
);

const readJsonLines = async (path) => {
  try {
    return (await readFile(path, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
};
const environment = {
  ...process.env,
  FIGDIFF_HOME: join(isolatedHome, ".figdiff"),
  FIGDIFF_DISABLE_KEYCHAIN_READ: "1",
};
delete environment.ELECTRON_RUN_AS_NODE;
const pageErrors = [];
const rendererCrashes = [];
let application;
let page;

const loadScreenshot = async (path) => {
  const change = page.getByRole("button", { name: "変更", exact: true });
  if (await change.isVisible()) await change.click();
  await page.getByPlaceholder("URL またはファイルパス（例: http://localhost:3000）").fill(path);
  await page.getByRole("button", { name: "実装スクリーンショット", exact: true }).click();
};

try {
  application = await electron.launch({
    executablePath: process.env.FIGDIFF_ELECTRON_EXECUTABLE ?? require("electron"),
    args: [bootstrap, `--user-data-dir=${userData}`],
    env: environment,
    timeout: 30_000,
  });
  page = await application.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("crash", () => rendererCrashes.push("renderer crashed"));
  assert.equal(
    await page.evaluate(() => typeof globalThis.electronAPI?.figmaNodeVerification?.load),
    "function",
  );
  await expect(page.getByText("Figma node fix fixture", { exact: true }).first()).toBeVisible();
  await page.getByText("Figma node fix fixture", { exact: true }).first().click();
  await expect(page.getByText("Synthetic versioned Figma frame", { exact: true })).toBeVisible();
  await page
    .locator("article")
    .filter({ hasText: "Synthetic versioned Figma frame" })
    .getByRole("button", { name: "Compare", exact: true })
    .click();
  await expect(page.getByRole("button", { name: /Verification frame/ })).toBeVisible();
  await page.getByRole("button", { name: /Verification frame/ }).click();
  await expect(page.getByRole("button", { name: "比較を開始", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "比較を開始", exact: true }).click();
  await expect(page.getByText("デザインと実装を比較", { exact: true })).toBeVisible();
  await loadScreenshot(inputPaths.before);

  await page.getByRole("button", { name: "修正確認", exact: true }).click();
  await page.getByLabel("確認するFigmaノードID").fill(fixture.targetNodeId);
  await page.getByRole("button", { name: "版を固定してノードを読み込む", exact: true }).click();
  const fixTarget = page.getByTestId("fix-target-source");
  await expect(fixTarget).toContainText(`Deep target（${fixture.targetNodeId}）`);
  await expect(fixTarget).toContainText(`Figma版: ${fixture.sourceVersion}`);

  const rootMismatch = await page.evaluate(
    async (input) => {
      try {
        await globalThis.electronAPI.figmaNodeVerification.load(input);
        return null;
      } catch (error) {
        return String(error);
      }
    },
    {
      fileKey: fixture.fileKey,
      frameNodeId: fixture.outsideFrameNodeId,
      targetNodeId: fixture.targetNodeId,
      scale: fixture.scale,
    },
  );
  assert.match(rootMismatch ?? "", /does not match the selected frame/);
  const outsideTarget = await page.evaluate(
    async (input) => {
      try {
        await globalThis.electronAPI.figmaNodeVerification.load(input);
        return null;
      } catch (error) {
        return String(error);
      }
    },
    {
      fileKey: fixture.fileKey,
      frameNodeId: fixture.frameNodeId,
      targetNodeId: fixture.outsideTargetNodeId,
      scale: fixture.scale,
    },
  );
  assert.match(outsideTarget ?? "", /target geometry is missing/);

  const cropCanvas = page.getByRole("img", { name: "範囲選択キャンバス" });
  await expect(cropCanvas).toBeVisible();
  let canvasBox = await cropCanvas.boundingBox();
  assert.ok(canvasBox);
  await page.mouse.move(canvasBox.x + 1, canvasBox.y + 1);
  await page.mouse.down();
  await page.waitForTimeout(50);
  await page.mouse.move(canvasBox.x + 2, canvasBox.y + 2);
  await page.mouse.up();
  await expect.poll(() => cropCanvas.evaluate((canvas) => canvas.width)).toBe(200);
  canvasBox = await cropCanvas.boundingBox();
  assert.ok(canvasBox);
  await page.mouse.move(canvasBox.x + fixture.crop.x, canvasBox.y + fixture.crop.y);
  await page.mouse.down();
  await page.mouse.move(
    canvasBox.x + fixture.crop.x + fixture.crop.width,
    canvasBox.y + fixture.crop.y + fixture.crop.height,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect(page.getByText("x: 10, y: 10, w: 180, h: 180", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "差分を検出", exact: true }).click();
  await expect(page.getByTestId("compare-score-verdict-badge")).toBeVisible();
  await page.getByRole("button", { name: "除外", exact: true }).click();
  await page.getByLabel("id", { exact: true }).fill(fixture.mask.id);
  await page.getByLabel("label", { exact: true }).fill("Half of target");
  await page.getByLabel("x", { exact: true }).fill(String(fixture.mask.x));
  await page.getByLabel("y", { exact: true }).fill(String(fixture.mask.y));
  await page.getByLabel("width", { exact: true }).fill(String(fixture.mask.width));
  await page.getByLabel("height", { exact: true }).fill(String(fixture.mask.height));
  await page.getByRole("button", { name: "マスクを保存して再比較", exact: true }).click();
  await expect(page.getByText("この画像条件で確認済み", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "修正確認", exact: true }).click();
  await expect(
    page.getByText("Deep targetを1600画素中800画素で採点しました。", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "修正前として固定", exact: true }).click();
  await expect(page.getByText(`対象領域: ${fixture.targetNodeId}`, { exact: true })).toBeVisible();
  await page.screenshot({
    path: join(evidence, "version-pinned-masked-cropped-before.png"),
    animations: "disabled",
  });

  await loadScreenshot(inputPaths.after);
  await page.getByRole("button", { name: "差分を検出", exact: true }).click();
  await expect(page.getByTestId("compare-score-verdict-badge")).toBeVisible();
  await page.getByRole("button", { name: "修正を確認", exact: true }).click();
  const result = page.getByTestId("fix-verification-result");
  await expect(result.getByText(/対象領域の変化:/)).toContainText("IMPROVED");
  await expect(result.getByText(/現在比較全体:/)).toContainText("FAIL");
  await expect(result.getByText(/bottom-right:/)).toBeVisible();
  await result.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: join(evidence, "target-improved-grid-regressed.png"),
    animations: "disabled",
  });

  assert.deepEqual(pageErrors, []);
  assert.deepEqual(rendererCrashes, []);
  const requests = await readJsonLines(requestLog);
  assert.ok(requests.length >= 8);
  assert.ok(requests.every((entry) => entry.method === "GET"));
  const urls = requests.map((entry) => new URL(entry.url));
  const pinnedNodeRequests = urls.filter(
    (url) =>
      url.pathname === `/v1/files/${fixture.fileKey}/nodes` &&
      url.searchParams.get("ids") === fixture.frameNodeId &&
      url.searchParams.get("version") === fixture.sourceVersion,
  );
  assert.equal(pinnedNodeRequests.length, 2);
  const pinnedExports = urls.filter(
    (url) =>
      url.pathname === `/v1/images/${fixture.fileKey}` &&
      url.searchParams.get("version") === fixture.sourceVersion &&
      url.searchParams.get("scale") === String(fixture.scale) &&
      url.searchParams.get("use_absolute_bounds") === "true" &&
      !url.searchParams.has("contents_only"),
  );
  assert.equal(pinnedExports.length, 1);
  const outsideExports = urls.filter(
    (url) =>
      url.pathname === `/v1/images/${fixture.fileKey}` &&
      url.searchParams.get("ids") === fixture.outsideFrameNodeId,
  );
  assert.equal(outsideExports.length, 0);

  const ipc = await readJsonLines(ipcLog);
  const loadResponses = ipc.filter(
    (entry) => entry.phase === "response" && entry.channel === "figma:get-node-verification-source",
  );
  assert.equal(loadResponses.length, 1);
  assert.deepEqual(
    {
      sourceVersion: loadResponses[0].result.sourceVersion,
      frameNodeId: loadResponses[0].result.frameNodeId,
      targetNodeId: loadResponses[0].result.targetNodeId,
      requestedScale: loadResponses[0].result.requestedScale,
      rootBox: loadResponses[0].result.rootBox,
      targetBox: loadResponses[0].result.targetBox,
    },
    {
      sourceVersion: fixture.sourceVersion,
      frameNodeId: fixture.frameNodeId,
      targetNodeId: fixture.targetNodeId,
      requestedScale: fixture.scale,
      rootBox: fixture.rootBox,
      targetBox: fixture.targetBox,
    },
  );
  const rejectedLoads = ipc.filter(
    (entry) => entry.phase === "error" && entry.channel === "figma:get-node-verification-source",
  );
  assert.equal(rejectedLoads.length, 2);
  assert.ok(rejectedLoads.some((entry) => /does not match the selected frame/.test(entry.error)));
  assert.ok(rejectedLoads.some((entry) => /target geometry is missing/.test(entry.error)));
  const maskSaves = ipc.filter(
    (entry) => entry.phase === "request" && entry.channel === "ignore-region:save",
  );
  assert.equal(maskSaves.length, 1);
  assert.deepEqual(maskSaves[0].args[1].coordinate_context.crop_region, fixture.crop);
  assert.equal(maskSaves[0].args[1].coordinate_context.canvas_width, fixture.crop.width);
  assert.equal(maskSaves[0].args[1].coordinate_context.canvas_height, fixture.crop.height);

  const screenshots = [
    "version-pinned-masked-cropped-before.png",
    "target-improved-grid-regressed.png",
  ];
  const screenshotHashes = Object.fromEntries(
    await Promise.all(
      screenshots.map(async (name) => [name, sha256(await readFile(join(evidence, name)))]),
    ),
  );
  await writeFile(
    join(evidence, "native-figma-node-fix.json"),
    `${JSON.stringify(
      {
        native: true,
        preload: true,
        execution: { status: "passed", exitCode: 0 },
        fixture,
        independentPixelOracle: pixelOracle,
        exportedImageMetadata: {
          width: exportedImageMetadata.width,
          height: exportedImageMetadata.height,
        },
        inputHashes,
        screenshots: screenshotHashes,
        rootMismatch,
        outsideTarget,
        requestCount: requests.length,
        ipcCount: ipc.length,
        pageErrors,
        rendererCrashes,
      },
      null,
      2,
    )}\n`,
  );
  const buildAtEnd = await captureBuild();
  const buildUnchanged = buildAtEnd.sha256 === buildAtStart.sha256;
  const artifactPaths = (await readdir(evidence, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name !== "manifest.json")
    .map((entry) => join(evidence, entry.name))
    .sort();
  const artifacts = await Promise.all(
    artifactPaths.map(async (path) => ({
      path: path.slice(evidence.length + 1),
      size: (await stat(path)).size,
      sha256: sha256(await readFile(path)),
    })),
  );
  await writeFile(
    join(evidence, "manifest.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        startedAt,
        completedAt: new Date().toISOString(),
        revision,
        dirtyState,
        command:
          "FIGDIFF_FIGMA_NODE_FIX_EVIDENCE=<private-evidence> xvfb-run -a node app/desktop/e2e/native-figma-node-fix.mjs",
        build: buildAtStart,
        buildEndSha256: buildAtEnd.sha256,
        buildUnchanged,
        driver: {
          path: "app/desktop/e2e/native-figma-node-fix.mjs",
          sha256: sha256(await readFile(fileURLToPath(import.meta.url))),
        },
        mockedBoundary: {
          service: "Figma HTTP only",
          fixture: "synthetic version/root/deep descendant/PNG",
          requestLog: "figma-http-requests.jsonl",
          requests,
          unexpectedNetwork: "rejected",
          realFigmaUsed: false,
          externalWrites: false,
        },
        scope:
          "Synthetic native Electron Figma-node fix flow through real main/preload/IPC/renderer. Independent raw pixels assert masked cropped target improvement and another 3x3 grid regression; HTTP requests assert version-pinned node/export, scale, and root containment rejection.",
        artifacts,
      },
      null,
      2,
    )}\n`,
  );
  assert.ok(buildUnchanged, "desktop/shared build changed during native verification");
} catch (error) {
  if (page) {
    await page.screenshot({ path: join(evidence, "failure.png"), animations: "disabled" });
    await writeFile(join(evidence, "failure-dom.txt"), await page.locator("body").innerText());
  }
  throw error;
} finally {
  try {
    await application?.close();
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
}

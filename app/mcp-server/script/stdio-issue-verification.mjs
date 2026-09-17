import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const entry = join(root, "app/mcp-server/dist/index.js");
const evidenceDir = resolve(
  process.argv[2] ?? join(root, "docs/evidence/mcp-stdio-issue-verification"),
);
const sandbox = await mkdtemp(join(tmpdir(), "figdiff-issue-verify-"));
const home = join(sandbox, "home");
const store = join(sandbox, "store");
const work = join(sandbox, "work");
const resultDir = join(store, "results");

const width = 390;
const height = 844;
const knownDefect = { x: 90, y: 336, width: 13, height: 11 };
const browserViewportWidths = [];
const typographyHtml = (
  changed,
) => `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>
html,body{margin:0;width:100%;min-height:844px;background:#f5f5f5;font-family:sans-serif}main{box-sizing:border-box;width:350px;margin:20px;padding:24px;background:#fff}.difference{display:inline-block;width:13px;height:11px;overflow:hidden;font-size:13px;line-height:11px;color:${
  changed ? "#c22" : "#222"
}}button{margin-top:24px;width:160px;height:40px;border:0;border-radius:4px;background:#246dcc;color:#fff;font-size:14px}
</style></head><body><main><p id="japanese-copy">設定内容を確認してから保存してください。<span class="difference">確</span></p><button type="button">変更を保存</button></main></body></html>`;
const fixtureServer = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/observed") {
    const observedWidth = Number(url.searchParams.get("width"));
    if (Number.isFinite(observedWidth)) browserViewportWidths.push(observedWidth);
    response.writeHead(204).end();
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  if (url.pathname === "/typography-design" || url.pathname === "/typography-impl") {
    response.end(typographyHtml(url.pathname === "/typography-impl"));
    return;
  }
  response.end(
    `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;min-height:844px;background:#f5f5f5}main{box-sizing:border-box;width:330px;height:780px;margin:20px;background:#fff;border-top:12px solid #333}</style></head><body><main></main><script>fetch('/observed?width='+window.innerWidth)</script></body></html>`,
  );
});
await new Promise((resolveListen, rejectListen) => {
  fixtureServer.once("error", rejectListen);
  fixtureServer.listen(0, "127.0.0.1", resolveListen);
});
const fixtureAddress = fixtureServer.address();
assert.ok(fixtureAddress && typeof fixtureAddress !== "string");
const fixtureUrl = `http://127.0.0.1:${fixtureAddress.port}/`;

await Promise.all([
  mkdir(home),
  mkdir(join(store, "projects", "proj-verify"), { recursive: true }),
  mkdir(join(store, "cache"), { recursive: true }),
  mkdir(work),
  mkdir(evidenceDir, { recursive: true }),
]);

const fixturePaths = {
  design: join(evidenceDir, "input-design.png"),
  identical: join(evidenceDir, "input-identical.png"),
  shifted: join(evidenceDir, "input-shifted.png"),
  globalShiftDesign: join(evidenceDir, "input-global-shift-design.png"),
  globalShiftScreenshot: join(evidenceDir, "input-global-shift-screenshot.png"),
  localized: join(evidenceDir, "input-localized-defect.png"),
  modalDesign: join(evidenceDir, "input-modal-sheet-y313.png"),
  modalMismatch: join(evidenceDir, "input-modal-sheet-y1459.png"),
  modalShift1: join(evidenceDir, "input-modal-sheet-y314.png"),
  modalShift2: join(evidenceDir, "input-modal-sheet-y315.png"),
  typographyDesign: join(evidenceDir, "input-typography-design.png"),
  typographyImplOracle: join(evidenceDir, "input-typography-impl-oracle.png"),
  animationDesign0: join(evidenceDir, "input-animation-design-000ms.png"),
  animationDesign100: join(evidenceDir, "input-animation-design-100ms.png"),
  animationImpl0: join(evidenceDir, "input-animation-impl-000ms.png"),
  animationImpl100: join(evidenceDir, "input-animation-impl-100ms.png"),
};
const animationDiffEvidencePath = join(evidenceDir, "animation-diff-100ms.png");

const base = await sharp({
  create: {
    width,
    height,
    channels: 3,
    background: { r: 245, g: 245, b: 245 },
  },
})
  .png()
  .toBuffer();
const panelSvg = (panelX, defect = false) =>
  Buffer.from(
    `<svg width="${width}" height="${height}"><rect x="${panelX}" y="30" width="340" height="780" fill="#ffffff"/><rect x="${panelX + 20}" y="330" width="250" height="24" fill="#333333"/>${
      defect
        ? `<rect x="${knownDefect.x}" y="${knownDefect.y}" width="${knownDefect.width}" height="${knownDefect.height}" fill="#cc3333"/>`
        : ""
    }</svg>`,
  );
const createFixture = async (panelX, defect = false) =>
  await sharp(base)
    .composite([{ input: panelSvg(panelX, defect), top: 0, left: 0 }])
    .png()
    .toBuffer();
const createModalFixture = async (sheetY) => {
  const modalHeight = 1839;
  const background = await sharp({
    create: {
      width,
      height: modalHeight,
      channels: 3,
      background: { r: 28, g: 32, b: 40 },
    },
  })
    .png()
    .toBuffer();
  return await sharp(background)
    .composite([
      {
        input: Buffer.from(
          `<svg width="${width}" height="${modalHeight}"><rect x="5" y="${sheetY}" width="380" height="380" fill="#f8f8f8"/><rect x="20" y="20" width="350" height="12" fill="#4477cc"/><rect x="20" y="1800" width="350" height="12" fill="#cc7744"/></svg>`,
        ),
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toBuffer();
};
const createGlobalShiftFixture = async (offsetX) => {
  const background = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .png()
    .toBuffer();
  return await sharp(background)
    .composite([
      {
        input: Buffer.from(
          `<svg width="${width}" height="${height}"><rect x="${20 + offsetX}" y="20" width="330" height="780" fill="#ffffff"/><rect x="${45 + offsetX}" y="95" width="80" height="180" fill="#cc2244"/><rect x="${180 + offsetX}" y="430" width="130" height="260" fill="#2266cc"/></svg>`,
        ),
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toBuffer();
};

const designBytes = await createFixture(10);
const animationFrame = async (background) =>
  await sharp({ create: { width: 64, height: 64, channels: 3, background } })
    .png()
    .toBuffer();
const animationDesign0 = await animationFrame({ r: 180, g: 20, b: 40 });
const animationDesign100 = await animationFrame({ r: 30, g: 80, b: 210 });
const animationImpl100 = await animationFrame({ r: 30, g: 190, b: 80 });
await Promise.all([
  writeFile(fixturePaths.design, designBytes),
  writeFile(fixturePaths.identical, designBytes),
  writeFile(fixturePaths.shifted, await createFixture(40)),
  writeFile(fixturePaths.globalShiftDesign, await createGlobalShiftFixture(0)),
  writeFile(fixturePaths.globalShiftScreenshot, await createGlobalShiftFixture(30)),
  writeFile(fixturePaths.localized, await createFixture(10, true)),
  writeFile(fixturePaths.modalDesign, await createModalFixture(313)),
  writeFile(fixturePaths.modalMismatch, await createModalFixture(1459)),
  writeFile(fixturePaths.modalShift1, await createModalFixture(314)),
  writeFile(fixturePaths.modalShift2, await createModalFixture(315)),
  writeFile(fixturePaths.animationDesign0, animationDesign0),
  writeFile(fixturePaths.animationDesign100, animationDesign100),
  writeFile(fixturePaths.animationImpl0, animationDesign0),
  writeFile(fixturePaths.animationImpl100, animationImpl100),
]);

await writeFile(
  join(store, "projects", "proj-verify", "project.json"),
  JSON.stringify({
    id: "proj-verify",
    name: "Verification Project",
    implementationUrl: "http://127.0.0.1.invalid",
    pages: [
      {
        id: "page-1",
        name: "Top",
        path: "/top",
        designSources: [
          {
            type: "local_image",
            id: "source-local",
            label: "Synthetic local fixture",
            filePath: fixturePaths.design,
          },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-09-12T00:00:00.000Z",
    credentials: { accessToken: "SYNTHETIC-CREDENTIAL-MUST-NOT-LEAK" },
  }),
);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const biomeExecutable = createRequire(import.meta.url).resolve("@biomejs/biome/bin/biome");
const redactPublicPaths = (value) => {
  if (typeof value === "string") {
    return value
      .replaceAll(`${home}/`, "<home>/")
      .replaceAll(`${store}/`, "<store>/")
      .replaceAll(`${sandbox}/`, "<sandbox>/")
      .replaceAll(`${root}/`, "");
  }
  if (Array.isArray(value)) return value.map(redactPublicPaths);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, redactPublicPaths(child)]),
    );
  }
  return value;
};
const formatJsonBytes = (value, filePath) =>
  Buffer.from(
    execFileSync(biomeExecutable, ["format", "--stdin-file-path", filePath], {
      cwd: root,
      input: `${JSON.stringify(value, null, 2)}\n`,
      encoding: "utf8",
    }),
  );
const writeFormattedJson = async (filePath, value) => {
  const publicValue = redactPublicPaths(value);
  const bytes = formatJsonBytes(publicValue, filePath);
  await writeFile(filePath, bytes);
  return {
    path: relative(root, filePath),
    canonicalJsonSha256: sha256(Buffer.from(JSON.stringify(publicValue))),
    formattedArtifactSha256: sha256(bytes),
    publicPathRedacted: JSON.stringify(publicValue) !== JSON.stringify(value),
  };
};
const writeRawProductJson = async (filePath, rawText) => {
  assert.ok(!rawText.includes(`${root}/`), "raw product response contains the repository path");
  assert.ok(!rawText.includes(`${home}/`), "raw product response contains the test home path");
  const bytes = Buffer.from(rawText);
  await writeFile(filePath, bytes);
  const storedBytes = await readFile(filePath);
  assert.deepEqual(storedBytes, bytes, "raw product response changed while being persisted");
  return {
    path: relative(root, filePath),
    sha256: sha256(storedBytes),
    byteLength: storedBytes.length,
    mediaType: "application/json",
    representation: "exact UTF-8 MCP tool response bytes; intentionally not formatter-normalized",
  };
};

const inspectPixels = async (leftPath, rightPath) => {
  const [left, right] = await Promise.all([
    sharp(leftPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(rightPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  assert.deepEqual(left.info, right.info);
  const imageWidth = left.info.width;
  const imageHeight = left.info.height;
  let count = 0;
  let minX = imageWidth;
  let minY = imageHeight;
  let maxX = -1;
  let maxY = -1;
  for (let pixel = 0; pixel < imageWidth * imageHeight; pixel += 1) {
    const offset = pixel * left.info.channels;
    let differs = false;
    for (let channel = 0; channel < left.info.channels; channel += 1) {
      if (left.data[offset + channel] !== right.data[offset + channel]) differs = true;
    }
    if (!differs) continue;
    const x = pixel % imageWidth;
    const y = Math.floor(pixel / imageWidth);
    count += 1;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return {
    differingPixelCount: count,
    bounds:
      count === 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
  };
};

const captureTypographyFixtures = async () => {
  const desktopRequire = createRequire(join(root, "app/desktop/package.json"));
  const { chromium } = desktopRequire("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width, height: 1200 } });
    const page = await context.newPage();
    await page.goto(`${fixtureUrl}typography-design`, { waitUntil: "networkidle" });
    const designDifference = await page.locator(".difference").boundingBox();
    const designButton = await page.getByRole("button", { name: "変更を保存" }).boundingBox();
    const japaneseCopy = await page.locator("#japanese-copy").textContent();
    assert.ok(designDifference && designDifference.width === 13 && designDifference.height === 11);
    assert.ok(designButton && designButton.width === 160 && designButton.height === 40);
    assert.match(japaneseCopy ?? "", /設定内容を確認してから保存してください。確/);
    await page.screenshot({ path: fixturePaths.typographyDesign, fullPage: true });
    await page.goto(`${fixtureUrl}typography-impl`, { waitUntil: "networkidle" });
    const implementationDifference = await page.locator(".difference").boundingBox();
    const implementationButton = await page
      .getByRole("button", { name: "変更を保存" })
      .boundingBox();
    assert.deepEqual(implementationDifference, designDifference);
    assert.deepEqual(implementationButton, designButton);
    await page.screenshot({ path: fixturePaths.typographyImplOracle, fullPage: true });
    await context.close();
    return { designDifference, implementationDifference, designButton, implementationButton };
  } finally {
    await browser.close();
  }
};

const text = (result) =>
  result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
const data = (result) => {
  assert.equal(result.isError, undefined, text(result));
  if (result.structuredContent !== undefined) return result.structuredContent;
  const first = result.content.find((item) => item.type === "text");
  assert.ok(first, "tool response has no text content");
  return JSON.parse(first.text);
};

const clients = [];
const protocolErrors = [];
const startClient = async (name) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    cwd: work,
    env: {
      HOME: home,
      PATH: dirname(process.execPath),
      FIGDIFF_HOME: store,
      FIGDIFF_ALLOWED_DIRS: evidenceDir,
      PLAYWRIGHT_BROWSERS_PATH:
        process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(process.env.HOME, ".cache/ms-playwright"),
    },
    stderr: "pipe",
  });
  transport.stderr?.resume();
  const client = new Client({ name, version: "1.0.0" });
  client.onerror = (error) => protocolErrors.push(error.message);
  await client.connect(transport);
  clients.push(client);
  return client;
};
const call = async (client, name, args, timeout = 90_000) =>
  await client.callTool({ name, arguments: args }, undefined, { timeout });
const closeClient = async (client) => {
  await client.close();
  clients.splice(clients.indexOf(client), 1);
};

const collectFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entryName of entries) {
    const fullPath = join(directory, entryName.name);
    if (entryName.isDirectory()) files.push(...(await collectFiles(fullPath)));
    else files.push(fullPath);
  }
  return files;
};
const buildRoots = [
  join(root, "app/mcp-server/dist"),
  join(root, "package/shared/dist"),
  join(root, "package/credential-store/dist"),
];
const buildIdentityFiles = [
  join(root, "pnpm-lock.yaml"),
  join(root, "package.json"),
  join(root, "app/mcp-server/package.json"),
  join(root, "package/shared/package.json"),
  join(root, "package/credential-store/package.json"),
];
const captureBuildManifest = async () => {
  const buildFiles = [
    ...(await Promise.all(buildRoots.map(collectFiles))).flat(),
    ...buildIdentityFiles,
  ].sort();
  return await Promise.all(
    buildFiles.map(async (filePath) => ({
      path: relative(root, filePath),
      size: (await stat(filePath)).size,
      sha256: sha256(await readFile(filePath)),
    })),
  );
};
const digestBuildManifest = (manifest) =>
  sha256(
    Buffer.from(
      manifest.map(({ path, size, sha256: digest }) => `${path}\0${size}\0${digest}`).join("\n"),
    ),
  );
const buildManifest = await captureBuildManifest();
const buildDigest = digestBuildManifest(buildManifest);

const results = {};
const verificationFailures = [];
let client = await startClient("figdiff-issue-verification-first-process");
try {
  const listed = data(await call(client, "list_projects", {}));
  assert.equal(listed.projectCount, 1);
  assert.equal(listed.projects[0].pages.length, 1);
  assert.equal(listed.projects[0].pages[0].designSources.length, 1);
  assert.doesNotMatch(JSON.stringify(listed), /SYNTHETIC-CREDENTIAL-MUST-NOT-LEAK/);
  results.issue114_listProjectsProjection = {
    status: "PASS",
    expected: { projectCount: 1, pageCount: 1, designSourceCount: 1, secretPresent: false },
    actual: {
      projectCount: listed.projectCount,
      pageCount: listed.projects[0].pages.length,
      designSourceCount: listed.projects[0].pages[0].designSources.length,
      secretPresent: false,
    },
  };

  const identicalOracle = await inspectPixels(fixturePaths.design, fixturePaths.identical);
  assert.deepEqual(identicalOracle, { differingPixelCount: 0, bounds: null });
  const identical = data(
    await call(client, "compare_design", {
      design_source: fixturePaths.design,
      screenshot: fixturePaths.identical,
      campaign_id: "identical-oracle",
    }),
  );
  assert.equal(identical.diffPixelCount, identicalOracle.differingPixelCount);
  results.C01 = {
    status: "PASS",
    oracle: "raw RGBA byte comparison",
    expected: identicalOracle,
    actual: { diffPixelCount: identical.diffPixelCount, comparisonId: identical.comparisonId },
  };
  const legacy = data(
    await call(client, "compare_design", {
      design_source: fixturePaths.design,
      screenshot: fixturePaths.localized,
    }),
  );
  const legacyDisk = JSON.parse(
    await readFile(join(resultDir, `${legacy.comparisonId}.json`), "utf8"),
  );
  assert.equal(legacyDisk.sourceKey, `local:${fixturePaths.design}`);
  const emptyConditionKeys = [];
  for (const comparisonConditions of [{}, { design: {} }]) {
    const emptyConditionResult = data(
      await call(client, "compare_design", {
        design_source: fixturePaths.design,
        screenshot: fixturePaths.localized,
        comparison_conditions: comparisonConditions,
      }),
    );
    const emptyConditionDisk = JSON.parse(
      await readFile(join(resultDir, `${emptyConditionResult.comparisonId}.json`), "utf8"),
    );
    emptyConditionKeys.push(emptyConditionDisk.sourceKey);
  }
  assert.deepEqual(emptyConditionKeys, [legacyDisk.sourceKey, legacyDisk.sourceKey]);
  results.legacySourceKey = {
    status: "PASS",
    expected: {
      omitted: `local:${fixturePaths.design}`,
      emptyObject: `local:${fixturePaths.design}`,
      emptyDesign: `local:${fixturePaths.design}`,
    },
    actual: {
      omitted: legacyDisk.sourceKey,
      emptyObject: emptyConditionKeys[0],
      emptyDesign: emptyConditionKeys[1],
    },
  };

  const localizedOracle = await inspectPixels(fixturePaths.design, fixturePaths.localized);
  assert.deepEqual(localizedOracle, {
    differingPixelCount: knownDefect.width * knownDefect.height,
    bounds: knownDefect,
  });
  const localized = data(
    await call(client, "compare_design", {
      design_source: fixturePaths.design,
      screenshot: fixturePaths.localized,
      campaign_id: "localized-oracle",
    }),
  );
  assert.equal(localized.diffPixelCount, localizedOracle.differingPixelCount);
  assert.ok(localized.diffRegions.length > 0, "known localized defect produced no region");
  assert.ok(
    localized.diffRegions.some(
      ({ bounds }) =>
        bounds.x <= knownDefect.x &&
        bounds.y <= knownDefect.y &&
        bounds.x + bounds.width >= knownDefect.x + knownDefect.width &&
        bounds.y + bounds.height >= knownDefect.y + knownDefect.height,
    ),
    "no returned region contains the independently known defect rectangle",
  );
  const localizedReport = JSON.parse(
    text(
      await call(client, "generate_diff_report", {
        comparison_id: localized.comparisonId,
        format: "json",
      }),
    ),
  );
  const wholeImageArea = width * height;
  assert.ok(
    localizedReport.diffReport.issues.every(({ bbox }) => bbox.w * bbox.h < wholeImageArea / 2),
    "localized defect was reported as a whole-image issue",
  );
  results.C03_issue58_localized_geometry = {
    status: "PASS",
    oracle: "raw RGBA diff count and exact generated rectangle",
    expected: localizedOracle,
    actual: {
      diffPixelCount: localized.diffPixelCount,
      diffRegions: localized.diffRegions.map(({ bounds, diffPixelCount }) => ({
        bounds,
        diffPixelCount,
      })),
      reportIssues: localizedReport.diffReport.issues.map(({ bbox, severity }) => ({
        bbox,
        severity,
      })),
    },
  };

  const animationOracles = {
    at0: await inspectPixels(fixturePaths.animationDesign0, fixturePaths.animationImpl0),
    at100: await inspectPixels(fixturePaths.animationDesign100, fixturePaths.animationImpl100),
  };
  assert.deepEqual(animationOracles.at0, { differingPixelCount: 0, bounds: null });
  assert.deepEqual(animationOracles.at100, {
    differingPixelCount: 4096,
    bounds: { x: 0, y: 0, width: 64, height: 64 },
  });
  const animation = data(
    await call(client, "compare_animation", {
      design_source: fixturePaths.animationDesign0,
      design_frames: [
        { path: fixturePaths.animationDesign0, at_ms: 0 },
        { path: fixturePaths.animationDesign100, at_ms: 100 },
      ],
      screenshot_frames: [
        { path: fixturePaths.animationImpl0, at_ms: 0 },
        { path: fixturePaths.animationImpl100, at_ms: 100 },
      ],
      drift_window_ms: 10,
      drift_fail_ms: 10,
    }),
  );
  assert.equal(animation.frames.length, 2);
  assert.deepEqual(
    animation.alignments.map(({ designAtMs, matchedAtMs }) => ({ designAtMs, matchedAtMs })),
    [
      { designAtMs: 0, matchedAtMs: 0 },
      { designAtMs: 100, matchedAtMs: 100 },
    ],
  );
  const animationReports = await Promise.all(
    animation.frames.map(async ({ comparisonId }) =>
      JSON.parse(
        text(
          await call(client, "generate_diff_report", {
            comparison_id: comparisonId,
            format: "json",
          }),
        ),
      ),
    ),
  );
  assert.equal(animationReports[0].diffPixelCount, animationOracles.at0.differingPixelCount);
  assert.equal(animationReports[1].diffPixelCount, animationOracles.at100.differingPixelCount);
  const alignmentRatiosValid = animation.alignments.every(
    ({ mismatchRate }) => mismatchRate === null || (mismatchRate >= 0 && mismatchRate <= 1),
  );
  assert.notEqual(animation.frames[1].status, "PASS");
  assert.notEqual(animation.temporal.status, "PASS");
  const changedFrameDiffPath = animation.frames[1].diffImagePath;
  assert.ok(changedFrameDiffPath, "changed animation frame has no diff image");
  const changedFrameDiff = await readFile(changedFrameDiffPath);
  await writeFile(animationDiffEvidencePath, changedFrameDiff);
  results.M11_compareAnimation = {
    status: alignmentRatiosValid ? "PASS" : "FAIL",
    oracle: "known solid-color frame pixels and declared 0ms/100ms timestamps",
    expected: {
      pixelDifferences: animationOracles,
      matchedTimes: [0, 100],
      mismatchRateRange: { minimum: 0, maximum: 1 },
    },
    actual: {
      frames: animation.frames,
      alignments: animation.alignments,
      temporal: animation.temporal,
      reportDiffPixelCounts: animationReports.map(({ diffPixelCount }) => diffPixelCount),
      durableDiff: {
        path: relative(root, animationDiffEvidencePath),
        sha256: sha256(changedFrameDiff),
      },
    },
  };
  await writeFormattedJson(join(evidenceDir, "animation-verification.json"), {
    status: results.M11_compareAnimation.status,
    executedAt: new Date().toISOString(),
    revision: execFileSync("/usr/bin/git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
    dirtyState: execFileSync("/usr/bin/git", ["status", "--porcelain=v1"], {
      cwd: root,
      encoding: "utf8",
    })
      .trimEnd()
      .split("\n")
      .filter(Boolean),
    entrySha256: sha256(await readFile(entry)),
    build: {
      roots: buildRoots.map((directory) => relative(root, directory)),
      identityFiles: buildIdentityFiles.map((filePath) => relative(root, filePath)),
      fileCount: buildManifest.length,
      sha256: buildDigest,
      files: buildManifest,
    },
    fixtures: await Promise.all(
      [
        fixturePaths.animationDesign0,
        fixturePaths.animationDesign100,
        fixturePaths.animationImpl0,
        fixturePaths.animationImpl100,
      ].map(async (filePath) => ({
        path: relative(root, filePath),
        sha256: sha256(await readFile(filePath)),
      })),
    ),
    transport: "@modelcontextprotocol/sdk Client + StdioClientTransport",
    result: results.M11_compareAnimation,
    scope: "compare_animation known 0ms/100ms local PNG frames only",
    priorEvidenceNote:
      results.M11_compareAnimation.status === "PASS"
        ? null
        : "evidence.json predates this mismatchRate assertion and must not be treated as the latest animation result.",
  });
  assert.ok(
    alignmentRatiosValid,
    "animation alignment mismatchRate must remain within the documented 0..1 ratio",
  );
  const typographyDom = await captureTypographyFixtures();
  const typographyOracle = await inspectPixels(
    fixturePaths.typographyDesign,
    fixturePaths.typographyImplOracle,
  );
  assert.ok(typographyOracle.bounds && typographyOracle.differingPixelCount > 0);
  assert.ok(
    typographyOracle.bounds.x >= Math.floor(typographyDom.designDifference.x) &&
      typographyOracle.bounds.y >= Math.floor(typographyDom.designDifference.y) &&
      typographyOracle.bounds.x + typographyOracle.bounds.width <=
        Math.ceil(typographyDom.designDifference.x + typographyDom.designDifference.width) &&
      typographyOracle.bounds.y + typographyOracle.bounds.height <=
        Math.ceil(typographyDom.designDifference.y + typographyDom.designDifference.height),
    "raw typography difference escaped the independently measured DOM rectangle",
  );
  const typography = data(
    await call(client, "compare_design", {
      design_source: fixturePaths.typographyDesign,
      screenshot_url: `${fixtureUrl}typography-impl`,
      capture_width: width,
      campaign_id: "real-typography-oracle",
    }),
  );
  assert.ok(
    typography.diffPixelCount > 0 &&
      typography.diffPixelCount <= typographyOracle.differingPixelCount,
    "thresholded typography difference must remain non-zero and cannot exceed the raw RGBA oracle",
  );
  const overlaps = (left, right) =>
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y;
  assert.ok(
    typography.diffRegions.some(({ bounds }) => overlaps(bounds, typographyDom.designDifference)),
    "no reported region overlaps the independently measured changed Japanese glyph",
  );
  assert.ok(
    typography.diffRegions.every(({ bounds }) => !overlaps(bounds, typographyDom.designButton)),
    "unchanged Japanese button was included in the reported difference",
  );
  const typographyReportRaw = text(
    await call(client, "generate_diff_report", {
      comparison_id: typography.comparisonId,
      format: "json",
    }),
  );
  const typographyReport = JSON.parse(typographyReportRaw);
  const typographyReportPath = join(evidenceDir, "real-typography-report.json");
  const typographyReportRawPath = join(evidenceDir, "real-typography-report.raw.txt");
  const [typographyReportArtifact, typographyRawArtifact] = await Promise.all([
    writeFormattedJson(typographyReportPath, typographyReport),
    writeRawProductJson(typographyReportRawPath, typographyReportRaw),
  ]);
  assert.deepEqual(
    JSON.parse(await readFile(typographyReportPath, "utf8")),
    redactPublicPaths(JSON.parse(await readFile(typographyReportRawPath, "utf8"))),
  );
  assert.ok(typographyReport.diffReport.issues.length > 0);
  assert.ok(
    typographyReport.diffReport.issues.every(({ bbox }) => bbox.w * bbox.h < (width * 1200) / 2),
    "localized Japanese glyph color difference became a whole-image issue",
  );
  const typographySemanticsValid = typographyReport.diffReport.issues.every(
    ({ kind }) => kind === "color",
  );
  if (!typographySemanticsValid) {
    await writeFormattedJson(join(evidenceDir, "c10-semantic-failure.json"), {
      status: "FAIL",
      executedAt: new Date().toISOString(),
      revision: execFileSync("/usr/bin/git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      }).trim(),
      entrySha256: sha256(await readFile(entry)),
      oracle: {
        unchangedDomGeometry: typographyDom,
        rawDifference: typographyOracle,
        designSha256: sha256(await readFile(fixturePaths.typographyDesign)),
        implementationSha256: sha256(await readFile(fixturePaths.typographyImplOracle)),
      },
      actual: {
        diffPixelCount: typography.diffPixelCount,
        diffRegions: typography.diffRegions,
        reportIssues: typographyReport.diffReport.issues,
      },
      reason: "unchanged DOM geometry was classified as a position/size difference",
      priorEvidenceNote:
        "evidence.json predates this semantic assertion and must not be treated as the latest C10 result.",
    });
  }
  assert.ok(
    typographySemanticsValid,
    "unchanged DOM geometry was classified as a position/size difference",
  );
  results.C10_issue112_real_typography = {
    status: "PASS",
    oracle: "real Chromium DOMRect plus raw RGBA comparison of two real Chromium screenshots",
    expected: {
      differenceElement: typographyDom.designDifference,
      unchangedButton: typographyDom.designButton,
      rawDifference: typographyOracle,
      thresholdedDifference: {
        minimum: 1,
        maximum: typographyOracle.differingPixelCount,
        reason: "pixelmatch excludes anti-aliased edge pixels from the raw RGBA difference",
      },
    },
    actual: {
      diffPixelCount: typography.diffPixelCount,
      diffRegions: typography.diffRegions.map(({ bounds, diffPixelCount }) => ({
        bounds,
        diffPixelCount,
      })),
      reportIssues: typographyReport.diffReport.issues.map(({ bbox, kind, severity }) => ({
        bbox,
        kind,
        severity,
      })),
      implementationDifferenceElement: typographyDom.implementationDifference,
      implementationButton: typographyDom.implementationButton,
      durableReport: {
        ...typographyReportArtifact,
        rawProduct: typographyRawArtifact,
      },
    },
  };

  const shiftedOracle = await inspectPixels(fixturePaths.design, fixturePaths.shifted);
  const shifted = data(
    await call(client, "compare_design", {
      design_source: fixturePaths.design,
      screenshot: fixturePaths.shifted,
      campaign_id: "alignment-oracle",
    }),
  );
  const shiftedReport = JSON.parse(
    text(
      await call(client, "generate_diff_report", {
        comparison_id: shifted.comparisonId,
        format: "json",
      }),
    ),
  );
  assert.ok(shiftedOracle.differingPixelCount > 0);
  const globalShiftOracle = await inspectPixels(
    fixturePaths.globalShiftDesign,
    fixturePaths.globalShiftScreenshot,
  );
  const globalShift = data(
    await call(client, "compare_design", {
      design_source: fixturePaths.globalShiftDesign,
      screenshot: fixturePaths.globalShiftScreenshot,
      campaign_id: "global-alignment-oracle",
    }),
  );
  const globalShiftReport = JSON.parse(
    text(
      await call(client, "generate_diff_report", {
        comparison_id: globalShift.comparisonId,
        format: "json",
      }),
    ),
  );
  const expectedTranslation = { x: 30, y: 0 };
  const actualTranslation = globalShiftReport.diffReport.alignment.translation;
  const translationMatches =
    actualTranslation.x === expectedTranslation.x && actualTranslation.y === expectedTranslation.y;
  if (!translationMatches) {
    verificationFailures.push("C02/#137: known global +30px translation was not tracked");
  }
  results.C02_issue137_issue138 = {
    status: translationMatches ? "PASS" : "FAIL",
    oracle:
      "generated high-contrast multi-feature canvas translated exactly +30px; separate low-contrast local movement remains uncorrected by design",
    expected: { translation: expectedTranslation, rawPixelDifference: globalShiftOracle },
    actual: {
      globalAlignment: globalShiftReport.diffReport.alignment,
      localMovement: {
        rawPixelDifference: shiftedOracle,
        alignment: shiftedReport.diffReport.alignment,
        note: "The #f5f5f5/#ffffff local panel delta is below the alignment RGB threshold; the local dark feature remains a raw visual difference.",
      },
    },
  };

  const modalOracle = await inspectPixels(fixturePaths.modalDesign, fixturePaths.modalMismatch);
  assert.ok(modalOracle.differingPixelCount > 0);
  const withoutConditions = data(
    await call(client, "compare_design", {
      design_source: fixturePaths.modalDesign,
      screenshot: fixturePaths.modalMismatch,
      campaign_id: "modal-without-conditions",
    }),
  );
  const mismatchedConditions = {
    design: {
      viewport: { width: 390, height: 693 },
      pixelRatio: 1,
      origin: { x: 0, y: 0 },
    },
    screenshot: {
      viewport: { width: 390, height: 1839 },
      pixelRatio: 1,
      origin: { x: 0, y: 0 },
    },
  };
  const withMismatch = data(
    await call(client, "compare_design", {
      design_source: fixturePaths.modalDesign,
      screenshot: fixturePaths.modalMismatch,
      campaign_id: "modal-with-mismatched-conditions",
      comparison_conditions: mismatchedConditions,
    }),
  );
  assert.equal(withoutConditions.comparisonConditions.status, "unverified");
  assert.equal(withMismatch.comparisonConditions.status, "mismatch");
  assert.deepEqual(withMismatch.comparisonConditions.differences, ["viewport"]);
  assert.deepEqual(withMismatch.comparisonConditions.design.canvas, { width: 390, height: 1839 });
  assert.deepEqual(withMismatch.comparisonConditions.screenshot.canvas, {
    width: 390,
    height: 1839,
  });
  assert.deepEqual(withMismatch.comparisonConditions.design.declared, mismatchedConditions.design);
  assert.deepEqual(
    withMismatch.comparisonConditions.screenshot.declared,
    mismatchedConditions.screenshot,
  );
  assert.equal(withMismatch.status, "UNCERTAIN");
  assert.deepEqual(withMismatch.completionCriteria.conditionsReview, {
    required: 1,
    current: 0,
    status: "UNCERTAIN",
    blocking: true,
    note: withMismatch.comparisonConditions.message,
  });
  assert.match(withMismatch.nextAction, /CSS.*前|撮影.*確認|表示領域.*確認/);
  assert.equal(withMismatch.diffPixelCount, withoutConditions.diffPixelCount);
  assert.equal(withMismatch.diffPixelCount, modalOracle.differingPixelCount);

  const compatibleConditions = {
    design: {
      viewport: { width: 390, height: 1839 },
      pixelRatio: 1,
      origin: { x: 0, y: 0 },
    },
    screenshot: {
      viewport: { width: 390, height: 1839 },
      pixelRatio: 1,
      origin: { x: 0, y: 0 },
    },
  };
  const onePixelOracle = await inspectPixels(fixturePaths.modalDesign, fixturePaths.modalShift1);
  const twoPixelOracle = await inspectPixels(fixturePaths.modalDesign, fixturePaths.modalShift2);
  const onePixelShift = data(
    await call(client, "compare_design", {
      design_source: fixturePaths.modalDesign,
      screenshot: fixturePaths.modalShift1,
      campaign_id: "modal-one-pixel-shift",
      comparison_conditions: compatibleConditions,
    }),
  );
  const twoPixelShift = data(
    await call(client, "compare_design", {
      design_source: fixturePaths.modalDesign,
      screenshot: fixturePaths.modalShift2,
      campaign_id: "modal-two-pixel-shift",
      comparison_conditions: compatibleConditions,
    }),
  );
  assert.equal(onePixelShift.comparisonConditions.status, "compatible");
  assert.equal(twoPixelShift.comparisonConditions.status, "compatible");
  assert.equal(onePixelShift.diffPixelCount, onePixelOracle.differingPixelCount);
  assert.equal(twoPixelShift.diffPixelCount, twoPixelOracle.differingPixelCount);
  assert.ok(onePixelShift.diffPixelCount > 0);
  assert.ok(twoPixelShift.diffPixelCount > onePixelShift.diffPixelCount);
  const scopedFirst = data(
    await call(client, "compare_design", {
      design_source: fixturePaths.modalDesign,
      screenshot: fixturePaths.modalShift1,
      campaign_id: "condition-identity-scope",
      comparison_conditions: compatibleConditions,
    }),
  );
  const scopedSecond = data(
    await call(client, "compare_design", {
      design_source: fixturePaths.modalDesign,
      screenshot: fixturePaths.modalShift1,
      campaign_id: "condition-identity-scope",
      comparison_conditions: compatibleConditions,
    }),
  );
  const changedConditions = {
    design: { ...compatibleConditions.design, origin: { x: 1, y: 0 } },
    screenshot: { ...compatibleConditions.screenshot, origin: { x: 1, y: 0 } },
  };
  const changedScope = data(
    await call(client, "compare_design", {
      design_source: fixturePaths.modalDesign,
      screenshot: fixturePaths.modalShift1,
      campaign_id: "condition-identity-scope",
      comparison_conditions: changedConditions,
    }),
  );
  assert.equal(scopedFirst.loopGuard.step, 1);
  assert.equal(scopedSecond.loopGuard.step, 2);
  assert.equal(changedScope.loopGuard.step, 1);
  results.issue147_issue148_coordinate_conditions = {
    status: "PASS",
    oracle: "raw RGBA byte differences from generated 380px sheet positions",
    expected: {
      mismatch: modalOracle,
      onePixelShift: onePixelOracle,
      twoPixelShift: twoPixelOracle,
      metadataDoesNotTransformPixels: true,
      conditionScopedSteps: [1, 2, 1],
    },
    actual: {
      withoutConditions: {
        status: withoutConditions.comparisonConditions.status,
        diffPixelCount: withoutConditions.diffPixelCount,
      },
      mismatchedConditions: {
        status: withMismatch.comparisonConditions.status,
        conditions: withMismatch.comparisonConditions,
        resultStatus: withMismatch.status,
        nextAction: withMismatch.nextAction,
        diffPixelCount: withMismatch.diffPixelCount,
      },
      onePixelShift: {
        status: onePixelShift.comparisonConditions.status,
        diffPixelCount: onePixelShift.diffPixelCount,
      },
      twoPixelShift: {
        status: twoPixelShift.comparisonConditions.status,
        diffPixelCount: twoPixelShift.diffPixelCount,
      },
      conditionScopedSteps: [
        scopedFirst.loopGuard.step,
        scopedSecond.loopGuard.step,
        changedScope.loopGuard.step,
      ],
    },
  };

  const browserCaptures = [];
  for (let index = 0; index < 3; index += 1) {
    const captured = data(
      await call(client, "compare_design", {
        design_source: fixturePaths.design,
        screenshot_url: fixtureUrl,
        capture_width: width,
        campaign_id: "capture-width-browser",
      }),
    );
    const diskEntry = JSON.parse(
      await readFile(join(resultDir, `${captured.comparisonId}.json`), "utf8"),
    );
    browserCaptures.push({
      comparisonId: captured.comparisonId,
      responseWidth: captured.normalization.screenshotWidth,
      persistedWidth: diskEntry.captureWidth,
    });
  }
  assert.deepEqual(browserViewportWidths, [width, width, width]);
  assert.deepEqual(
    browserCaptures.map(({ responseWidth }) => responseWidth),
    [width, width, width],
  );
  assert.deepEqual(
    browserCaptures.map(({ persistedWidth }) => persistedWidth),
    [width, width, width],
  );
  results.M15_issue59 = {
    status: "PASS",
    oracle:
      "The page reports window.innerWidth to the independent local HTTP server for each real Playwright capture.",
    expected: { browserObservedWidths: [width, width, width] },
    actual: { browserObservedWidths: browserViewportWidths, captures: browserCaptures },
  };

  const oldComparisonIds = [];
  for (let index = 0; index < 7; index += 1) {
    const comparison = data(
      await call(client, "compare_design", {
        design_source: fixturePaths.design,
        screenshot: fixturePaths.localized,
        campaign_id: "retention-seven-comparisons",
      }),
    );
    oldComparisonIds.push(comparison.comparisonId);
  }
  const oldestId = oldComparisonIds[0];
  const oldestJsonPath = join(resultDir, `${oldestId}.json`);
  const oldestPngPath = join(resultDir, `diff-${oldestId}.png`);
  const beforeRestart = {
    jsonSha256: sha256(await readFile(oldestJsonPath)),
    pngSha256: sha256(await readFile(oldestPngPath)),
  };
  const onDiskNames = await readdir(resultDir);
  assert.equal(oldComparisonIds.filter((id) => onDiskNames.includes(`${id}.json`)).length, 7);
  await closeClient(client);
  client = await startClient("figdiff-issue-verification-restarted-process");
  const oldReportRaw = text(
    await call(client, "generate_diff_report", {
      comparison_id: oldestId,
      format: "json",
    }),
  );
  const oldReport = JSON.parse(oldReportRaw);
  assert.equal(oldReport.comparisonId, oldestId);
  assert.ok(oldReport.diffRegions.length > 0);
  const oldestPngBytes = await readFile(oldestPngPath);
  const durableOldReportPath = join(evidenceDir, "retained-oldest-report.json");
  const durableOldReportRawPath = join(evidenceDir, "retained-oldest-report.raw.txt");
  const durableOldPngPath = join(evidenceDir, "retained-oldest-diff.png");
  const [durableOldReportArtifact, durableOldReportRawArtifact] = await Promise.all([
    writeFormattedJson(durableOldReportPath, oldReport),
    writeRawProductJson(durableOldReportRawPath, oldReportRaw),
    writeFile(durableOldPngPath, oldestPngBytes),
  ]);
  assert.deepEqual(
    JSON.parse(await readFile(durableOldReportPath, "utf8")),
    redactPublicPaths(JSON.parse(await readFile(durableOldReportRawPath, "utf8"))),
  );
  const afterRestart = {
    jsonSha256: sha256(await readFile(oldestJsonPath)),
    pngSha256: sha256(oldestPngBytes),
  };
  assert.deepEqual(afterRestart, beforeRestart);
  const restartedModalJson = JSON.parse(
    text(
      await call(client, "generate_diff_report", {
        comparison_id: withMismatch.comparisonId,
        format: "json",
      }),
    ),
  );
  const restartedModalMarkdown = text(
    await call(client, "generate_diff_report", {
      comparison_id: withMismatch.comparisonId,
      format: "markdown",
    }),
  );
  assert.deepEqual(restartedModalJson.comparisonConditions, withMismatch.comparisonConditions);
  assert.match(restartedModalMarkdown, /撮影条件|表示領域/);
  results.issue147_issue148_coordinate_conditions.actual.restartPersistence = {
    jsonStatus: restartedModalJson.comparisonConditions.status,
    markdownIncludesConditions: /撮影条件|表示領域/.test(restartedModalMarkdown),
  };
  results.M09_issue109 = {
    status: "PASS",
    expected: { retainedComparisonCount: 7, oldestReadableAfterRestart: true },
    actual: {
      retainedComparisonCount: oldComparisonIds.length,
      oldestId,
      reportComparisonId: oldReport.comparisonId,
      reportRegionCount: oldReport.diffRegions.length,
      artifacts: afterRestart,
      durableArtifacts: [
        {
          ...durableOldReportArtifact,
          rawProduct: durableOldReportRawArtifact,
        },
        { path: relative(root, durableOldPngPath), sha256: sha256(oldestPngBytes) },
      ],
    },
  };

  const firstCampaignA = data(
    await call(client, "compare_design", {
      design_source: fixturePaths.design,
      screenshot: fixturePaths.shifted,
      campaign_id: "campaign-a",
    }),
  );
  const secondCampaignA = data(
    await call(client, "compare_design", {
      design_source: fixturePaths.design,
      screenshot: fixturePaths.shifted,
      campaign_id: "campaign-a",
    }),
  );
  const firstCampaignB = data(
    await call(client, "compare_design", {
      design_source: fixturePaths.design,
      screenshot: fixturePaths.shifted,
      campaign_id: "campaign-b",
    }),
  );
  assert.equal(firstCampaignA.loopGuard.step, 1);
  assert.equal(secondCampaignA.loopGuard.step, 2);
  assert.equal(firstCampaignB.loopGuard.step, 1);
  await closeClient(client);
  client = await startClient("figdiff-issue-verification-campaign-resume");
  const resumedCampaignA = data(
    await call(client, "compare_design", {
      design_source: fixturePaths.design,
      screenshot: fixturePaths.shifted,
      campaign_id: "campaign-a",
    }),
  );
  assert.equal(resumedCampaignA.loopGuard.step, 3);
  assert.equal(resumedCampaignA.loopGuard.stop, true);
  const campaignDiskEntries = await Promise.all(
    [firstCampaignA.comparisonId, firstCampaignB.comparisonId].map(async (id) =>
      JSON.parse(await readFile(join(resultDir, `${id}.json`), "utf8")),
    ),
  );
  assert.notEqual(campaignDiskEntries[0].sourceKey, campaignDiskEntries[1].sourceKey);
  results.M14_issue131 = {
    status: "PASS",
    expected: {
      campaignASteps: [1, 2, 3],
      campaignBFirstStep: 1,
      distinctStoredSourceKeys: true,
      resumedAfterRestart: true,
    },
    actual: {
      campaignASteps: [
        firstCampaignA.loopGuard.step,
        secondCampaignA.loopGuard.step,
        resumedCampaignA.loopGuard.step,
      ],
      campaignBFirstStep: firstCampaignB.loopGuard.step,
      distinctStoredSourceKeys:
        campaignDiskEntries[0].sourceKey !== campaignDiskEntries[1].sourceKey,
      resumedStopReason: resumedCampaignA.loopGuard.reason,
    },
  };

  assert.deepEqual(protocolErrors, []);
} finally {
  await Promise.all(clients.map(async (openClient) => await openClient.close()));
  await new Promise((resolveClose, rejectClose) => {
    fixtureServer.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
}

const fixtureManifest = await Promise.all(
  Object.entries(fixturePaths).map(async ([name, filePath]) => ({
    name,
    path: relative(root, filePath),
    sha256: sha256(await readFile(filePath)),
  })),
);
const postBuildManifest = await captureBuildManifest();
const postBuildDigest = digestBuildManifest(postBuildManifest);
const buildUnchanged = postBuildDigest === buildDigest;

const evidence = {
  schemaVersion: 1,
  revision: execFileSync("/usr/bin/git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  dirtyState: execFileSync("/usr/bin/git", ["status", "--porcelain=v1"], {
    cwd: root,
    encoding: "utf8",
  })
    .trimEnd()
    .split("\n")
    .filter(Boolean),
  build: {
    roots: buildRoots.map((directory) => relative(root, directory)),
    identityFiles: buildIdentityFiles.map((filePath) => relative(root, filePath)),
    fileCount: buildManifest.length,
    sha256: buildDigest,
    files: buildManifest,
    postRun: {
      fileCount: postBuildManifest.length,
      sha256: postBuildDigest,
      files: postBuildManifest,
    },
    unchangedDuringRun: buildUnchanged,
  },
  environment: { platform: process.platform, arch: process.arch, node: process.version },
  executedAt: new Date().toISOString(),
  transport: "@modelcontextprotocol/sdk Client + StdioClientTransport",
  protocolErrors,
  verificationFailures,
  fixtures: fixtureManifest,
  results,
  scope: {
    verifiedAssertions: [
      "C01",
      "C02 global x-axis translation",
      "C03 exact localized rectangle",
      "C10/#112 real Chromium Japanese typography localization",
      "#147/#148 coordinate-condition contract",
      "#114 list_projects projection and secret stripping",
      "M09/#109",
      "M11 compare_animation known real image frame output",
      "M14/#131",
      "M15/#59 real browser capture width",
    ],
    notRun: ["external Figma API routes", "external network web capture routes"],
    oracle:
      "Synthetic geometry, real Chromium DOM rectangles, and raw RGBA byte comparisons are independent of FigDiff. Product status and matchRate are recorded nowhere as acceptance oracles.",
  },
};
const evidencePath = join(evidenceDir, "evidence.json");
await writeFormattedJson(evidencePath, evidence);
process.stdout.write(`${evidencePath}\n`);
assert.deepEqual(postBuildManifest, buildManifest, "build files changed during stdio verification");
if (verificationFailures.length > 0) process.exitCode = 1;

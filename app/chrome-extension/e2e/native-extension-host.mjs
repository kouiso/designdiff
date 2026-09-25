import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, "../../..");
const extension = resolve(directory, "../dist");
const requireFromDesktop = createRequire(join(repository, "app/desktop/package.json"));
const { chromium } = requireFromDesktop("playwright");
const sharp = requireFromDesktop("sharp");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const evidencePath = process.env.FIGDIFF_EXTENSION_HOST_EVIDENCE;
if (!evidencePath) throw new Error("FIGDIFF_EXTENSION_HOST_EVIDENCE is required");
const evidence = resolve(evidencePath);
await mkdir(evidence, { recursive: true });
const clickHelperSource = join(evidence, "x11-click.c");
const clickHelper = join(evidence, "x11-click");
await writeFile(
  clickHelperSource,
  `#include <X11/Xlib.h>
#include <X11/extensions/XTest.h>
#include <stdlib.h>
#include <unistd.h>
int main(int argc, char **argv) {
  if (argc != 3) return 2;
  Display *display = XOpenDisplay(NULL);
  if (!display) return 3;
  XTestFakeMotionEvent(display, -1, atoi(argv[1]), atoi(argv[2]), CurrentTime);
  XFlush(display);
  usleep(100000);
  XTestFakeButtonEvent(display, 1, True, CurrentTime);
  XTestFakeButtonEvent(display, 1, False, CurrentTime);
  XFlush(display);
  XCloseDisplay(display);
  return 0;
}
`,
);
execFileSync("/usr/bin/gcc", [clickHelperSource, "-o", clickHelper, "-lX11", "-lXtst"]);

const collectFiles = async (root) => {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(path)));
    else files.push(path);
  }
  return files;
};

const captureBuild = async () => {
  const paths = [
    ...(await collectFiles(extension)),
    join(repository, "app/chrome-extension/package.json"),
    join(repository, "app/chrome-extension/build.mjs"),
    join(repository, "app/chrome-extension/public/manifest.json"),
    join(repository, "package/shared/package.json"),
    join(repository, "pnpm-lock.yaml"),
  ].sort();
  const files = await Promise.all(
    paths.map(async (path) => ({
      path: path.slice(repository.length + 1),
      size: (await stat(path)).size,
      sha256: sha256(await readFile(path)),
    })),
  );
  return {
    fileCount: files.length,
    sha256: sha256(
      Buffer.from(files.map((file) => `${file.path}\0${file.size}\0${file.sha256}`).join("\n")),
    ),
    files,
  };
};

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

const fixtureHtml = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>FigDiff extension fixture</title>
    <style>
      * { box-sizing: border-box; }
      html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: rgb(245, 247, 250); }
      #target { position: absolute; left: 100px; top: 100px; width: 120px; height: 80px; background: rgb(20, 90, 220); }
      body.changed #target { left: 140px; background: rgb(220, 50, 45); }
      #anchor { position: absolute; left: 24px; top: 24px; font: 20px sans-serif; color: rgb(20, 25, 30); }
    </style>
  </head>
  <body><div id="anchor">controlled fixture</div><div id="target"></div></body>
</html>`;
const requests = [];
const server = createServer((request, response) => {
  requests.push({ method: request.method ?? "GET", url: request.url ?? "/" });
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(fixtureHtml);
});
await new Promise((resolvePromise, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolvePromise);
});
const address = server.address();
assert(address && typeof address === "object");
const fixtureUrl = `http://127.0.0.1:${address.port}/fixture`;

const sandbox = await mkdtemp(join(evidence, "profile-"));
const profile = join(sandbox, "chromium-profile");
const expectedExtensionId = [...createHash("sha256").update(extension).digest("hex").slice(0, 32)]
  .map((nibble) => String.fromCharCode(97 + Number.parseInt(nibble, 16)))
  .join("");
await mkdir(join(profile, "Default"), { recursive: true });
await writeFile(
  join(profile, "Default/Preferences"),
  JSON.stringify({ extensions: { pinned_extensions: [expectedExtensionId] } }),
);
const pageErrors = [];
const consoleErrors = [];
const browserRequests = [];
let context;
let popupSurface = "unavailable";
let extensionId = "";
let activeTabBeforeShow;
let activeTabBeforeCapture;
let overlayStateAfterShow;
let overlayStateAfterControls;
let compareObservation;
let independentOracle;
let backgroundCaptureOracle;
let captureAndCompareOracle;
const startedAt = new Date().toISOString();

const attachPageDiagnostics = (page) => {
  page.on("pageerror", (error) => pageErrors.push({ url: page.url(), message: error.message }));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push({ url: page.url(), text: message.text() });
  });
};

try {
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: false,
    viewport: { width: 640, height: 480 },
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      "--window-position=10,10",
      "--window-size=658,622",
    ],
  });
  context.on("page", attachPageDiagnostics);
  context.on("request", (request) => {
    browserRequests.push({
      method: request.method(),
      resourceType: request.resourceType(),
      url: request.url(),
    });
  });
  for (const page of context.pages()) attachPageDiagnostics(page);

  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15_000 });
  worker.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push({ url: worker.url(), text: message.text() });
  });
  extensionId = new URL(worker.url()).host;
  assert.match(extensionId, /^[a-p]{32}$/);
  assert.equal(extensionId, expectedExtensionId);

  const fixture = context.pages()[0] ?? (await context.newPage());
  await fixture.goto(fixtureUrl, { waitUntil: "networkidle" });
  await fixture.bringToFront();
  await fixture.waitForFunction(() => document.readyState === "complete");

  const getActiveTab = () =>
    worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return { id: tab?.id ?? null, url: tab?.url ?? null };
    });
  const getContentState = (tabId) =>
    worker.evaluate(async (id) => chrome.tabs.sendMessage(id, { type: "get-state" }), tabId);

  const initialPath = join(evidence, "fixture-design.png");
  const implementationPath = join(evidence, "fixture-implementation.png");
  await fixture.screenshot({ path: initialPath });
  await fixture.evaluate(() => document.body.classList.add("changed"));
  await fixture.screenshot({ path: implementationPath });

  const [design, implementation] = await Promise.all([
    sharp(initialPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(implementationPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  assert.equal(design.info.width, implementation.info.width);
  assert.equal(design.info.height, implementation.info.height);
  let count = 0;
  let minX = design.info.width;
  let minY = design.info.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < design.info.height; y += 1) {
    for (let x = 0; x < design.info.width; x += 1) {
      const offset = (y * design.info.width + x) * 4;
      if (
        design.data
          .subarray(offset, offset + 4)
          .equals(implementation.data.subarray(offset, offset + 4))
      ) {
        continue;
      }
      count += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  independentOracle = {
    differentPixels: count,
    totalPixels: design.info.width * design.info.height,
    bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
  };
  assert(independentOracle.differentPixels >= 12_000);
  assert(
    independentOracle.bounds.x <= 100 &&
      independentOracle.bounds.x + independentOracle.bounds.width >= 260,
  );
  execFileSync("/usr/bin/import", ["-window", "root", join(evidence, "browser-toolbar.png")]);

  let popup;
  const popupEvent = context.waitForEvent("page", {
    predicate: (page) => page.url().startsWith(`chrome-extension://${extensionId}/popup.html`),
    timeout: 2_000,
  });
  // private profileへ固定した唯一の拡張actionを、固定window上でX11ユーザークリックする。
  execFileSync(clickHelper, ["509", "72"]);
  try {
    popup = await popupEvent;
    popupSurface = "X11 user-clicked toolbar popup";
  } catch (error) {
    popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    popupSurface = `X11 toolbar action click with extension-origin tab UI fallback: ${error instanceof Error ? error.message : String(error)}`;
  }
  attachPageDiagnostics(popup);
  await popup.waitForLoadState("domcontentloaded");
  await popup.getByRole("button", { name: "Upload" }).click();
  await popup.locator('input[type="file"]').setInputFiles(initialPath);
  await popup.getByText("Design loaded").waitFor();

  await fixture.bringToFront();
  activeTabBeforeShow = await getActiveTab();
  assert.equal(activeTabBeforeShow.url, fixtureUrl);
  assert.notEqual(activeTabBeforeShow.id, null);
  await popup.getByRole("button", { name: "Show Overlay" }).evaluate((button) => button.click());
  await fixture.locator("#figdiff-overlay").waitFor();
  await fixture.locator("#figdiff-controls").waitFor();
  overlayStateAfterShow = await getContentState(activeTabBeforeShow.id);
  assert.deepEqual(overlayStateAfterShow, {
    active: true,
    mode: "transparent_overlay",
    opacity: 0.5,
  });
  await fixture.screenshot({ path: join(evidence, "host-overlay-transparent.png") });

  const slider = fixture.locator('#figdiff-controls input[type="range"]');
  await slider.evaluate((input) => {
    input.value = "80";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await fixture.getByTitle("Blended Diff").click();
  const blendMode = await fixture
    .locator("#figdiff-overlay")
    .evaluate((element) => element.style.mixBlendMode);
  assert.equal(blendMode, "difference");
  await fixture.getByTitle("Transparent Overlay").click();
  const opacity = await fixture
    .locator("#figdiff-overlay")
    .evaluate((element) => element.style.opacity);
  assert.equal(opacity, "0.8");
  overlayStateAfterControls = await getContentState(activeTabBeforeShow.id);
  assert.deepEqual(overlayStateAfterControls, {
    active: true,
    mode: "transparent_overlay",
    opacity: 0.8,
  });
  await fixture.screenshot({ path: join(evidence, "host-overlay-controls.png") });

  activeTabBeforeCapture = await getActiveTab();
  assert.deepEqual(activeTabBeforeCapture, activeTabBeforeShow);
  const actionUserSettings = await worker.evaluate(async () => chrome.action.getUserSettings());
  await writeFile(
    join(evidence, "progress.json"),
    `${JSON.stringify(
      {
        extensionId,
        popupSurface,
        actionUserSettings,
        activeTabBeforeShow,
        activeTabBeforeCapture,
      },
      null,
      2,
    )}\n`,
  );
  await worker.evaluate(
    async (id) => chrome.tabs.sendMessage(id, { type: "hide-overlay" }),
    activeTabBeforeCapture.id,
  );
  await fixture.locator("#figdiff-overlay").waitFor({ state: "detached" });
  const captureProbe = await popup.evaluate(async () =>
    chrome.runtime.sendMessage({ type: "capture-screenshot" }),
  );
  if (typeof captureProbe.dataUrl !== "string") {
    throw new Error(`Background capture failed: ${JSON.stringify(captureProbe)}`);
  }
  const backgroundCapture = Buffer.from(captureProbe.dataUrl.split(",")[1], "base64");
  await writeFile(join(evidence, "background-capture.png"), backgroundCapture);
  backgroundCaptureOracle = {
    capturedSha256: sha256(backgroundCapture),
    expectedImplementationSha256: sha256(await readFile(implementationPath)),
  };
  assert.equal(
    backgroundCaptureOracle.capturedSha256,
    backgroundCaptureOracle.expectedImplementationSha256,
  );
  await worker.evaluate(
    async ({ id, imageBase64 }) =>
      chrome.tabs.sendMessage(id, {
        type: "show-overlay",
        imageBase64,
        mode: "transparent_overlay",
        opacity: 0.5,
        frameWidth: 640,
        frameHeight: 480,
      }),
    {
      id: activeTabBeforeCapture.id,
      imageBase64: (await readFile(initialPath)).toString("base64"),
    },
  );
  await fixture.locator("#figdiff-overlay").waitFor();
  await worker.evaluate(() => {
    const captureVisibleTab = chrome.tabs.captureVisibleTab.bind(chrome.tabs);
    globalThis.__figdiffOriginalCaptureVisibleTab = chrome.tabs.captureVisibleTab;
    globalThis.__figdiffCaptureAndCompareDataUrl = null;
    chrome.tabs.captureVisibleTab = (options, callback) => {
      captureVisibleTab(options, (dataUrl) => {
        globalThis.__figdiffCaptureAndCompareDataUrl = dataUrl;
        callback(dataUrl);
      });
    };
  });
  await popup
    .getByRole("button", { name: "Capture & Compare" })
    .evaluate((button) => button.click());
  await popup.locator(".match-rate, .error").waitFor({ timeout: 15_000 });
  const matchRate = popup.locator(".match-rate");
  const error = popup.locator(".error");
  const statsText = await popup.locator(".stats").allTextContents();
  const pixelStats = /^([\d,]+) diff px \/ ([\d,]+) total$/.exec(statsText[0] ?? "");
  const regionStats = /^([\d,]+) diff region\(s\)$/.exec(statsText[1] ?? "");
  assert(pixelStats, `Unexpected pixel stats: ${JSON.stringify(statsText)}`);
  assert(regionStats, `Unexpected region stats: ${JSON.stringify(statsText)}`);
  const captureAndCompareDataUrl = await worker.evaluate(() => {
    const dataUrl = globalThis.__figdiffCaptureAndCompareDataUrl;
    chrome.tabs.captureVisibleTab = globalThis.__figdiffOriginalCaptureVisibleTab;
    delete globalThis.__figdiffOriginalCaptureVisibleTab;
    delete globalThis.__figdiffCaptureAndCompareDataUrl;
    return dataUrl;
  });
  assert.equal(typeof captureAndCompareDataUrl, "string");
  const captureAndComparePng = Buffer.from(captureAndCompareDataUrl.split(",")[1], "base64");
  await writeFile(join(evidence, "capture-and-compare.png"), captureAndComparePng);
  captureAndCompareOracle = {
    capturedSha256: sha256(captureAndComparePng),
    expectedImplementationSha256: sha256(await readFile(implementationPath)),
  };
  compareObservation = {
    matchRateText: (await matchRate.count()) > 0 ? await matchRate.textContent() : null,
    statsText,
    diffPixelCount: Number.parseInt(pixelStats[1].replaceAll(",", ""), 10),
    totalPixelCount: Number.parseInt(pixelStats[2].replaceAll(",", ""), 10),
    diffRegionCount: Number.parseInt(regionStats[1].replaceAll(",", ""), 10),
    errorText: (await error.count()) > 0 ? await error.textContent() : null,
    activeTabAfterCapture: await getActiveTab(),
  };
  await popup.screenshot({ path: join(evidence, "popup-after-compare-attempt.png") });
  assert.equal(compareObservation.errorText, null);
  assert.match(compareObservation.matchRateText ?? "", /^\d+(?:\.\d+)?%$/);
  assert.equal(compareObservation.diffPixelCount, independentOracle.differentPixels);
  assert.equal(compareObservation.totalPixelCount, independentOracle.totalPixels);
  assert(compareObservation.diffRegionCount > 0);
  assert.deepEqual(compareObservation.activeTabAfterCapture, activeTabBeforeCapture);
  assert.equal(
    captureAndCompareOracle.capturedSha256,
    captureAndCompareOracle.expectedImplementationSha256,
  );
  await popup.screenshot({ path: join(evidence, "popup-compare-result.png") });
  await fixture.screenshot({ path: join(evidence, "host-after-compare.png") });

  await fixture.getByTitle("Close").click();
  await fixture.locator("#figdiff-overlay").waitFor({ state: "detached" });
  await fixture.locator("#figdiff-controls").waitFor({ state: "detached" });
  assert.deepEqual(await getContentState(activeTabBeforeShow.id), {
    active: false,
    mode: "transparent_overlay",
    opacity: 0.5,
  });

  const buildAtEnd = await captureBuild();
  assert.deepEqual(buildAtEnd, buildAtStart);
  assert.equal(pageErrors.length, 0);
  assert.equal(consoleErrors.length, 0);

  const artifacts = {};
  for (const path of (await collectFiles(evidence)).filter(
    (path) => !path.includes(`${basename(sandbox)}/`),
  )) {
    if (path.endsWith("manifest.json")) continue;
    artifacts[basename(path)] = {
      size: (await stat(path)).size,
      sha256: sha256(await readFile(path)),
    };
  }
  await writeFile(
    join(evidence, "manifest.json"),
    `${JSON.stringify(
      {
        classification:
          "Synthetic local-fixture Chrome extension host proof; not real Figma or whole-campaign evidence",
        startedAt,
        completedAt: new Date().toISOString(),
        revision,
        dirtyState,
        extensionId,
        popupSurface,
        fixture: {
          url: fixtureUrl,
          serverRequests: requests,
          independentRawPixelOracle: independentOracle,
        },
        activeTabBeforeShow,
        activeTabBeforeCapture,
        overlayStateAfterShow,
        overlayStateAfterControls,
        backgroundCaptureOracle,
        captureAndCompareOracle,
        compareObservation,
        browserRequests,
        pageErrors,
        consoleErrors,
        buildAtStart,
        buildAtEnd,
        artifacts,
        exclusions: [
          "No Figma endpoint, credential, user browser profile, or external POST was used.",
          "The product match percentage was observed but was not used as the correctness oracle.",
          "The controlled before/after browser screenshots were compared independently as raw RGBA pixels.",
        ],
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(
    `${JSON.stringify({ ok: true, evidence, extensionId, popupSurface, independentOracle, compareObservation })}\n`,
  );
} finally {
  await context?.close();
  await new Promise((resolvePromise) => server.close(resolvePromise));
  await rm(sandbox, { recursive: true, force: true });
}

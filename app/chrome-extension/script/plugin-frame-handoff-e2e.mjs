// Chrome extension と Figma plugin UI bundle の実ブラウザ間 handoff。
// Figma の main/plugin host は synthetic、拡張機能・service worker・content script は実物。
// 第1引数: evidence directory。実行には X server または xvfb-run が必要。

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const desktopRequire = createRequire(join(root, "app/desktop/package.json"));
const { chromium } = desktopRequire("playwright/test");
const sharp = desktopRequire("sharp");
const extensionDir = join(root, "app/chrome-extension/dist");
const pluginHtml = await readFile(join(root, "app/figma-plugin/dist/ui.html"), "utf8");
const evidenceDir = process.argv[2] ? resolve(process.argv[2]) : undefined;
if (!evidenceDir) throw new Error("evidence directory argument is required");
await mkdir(evidenceDir, { recursive: true });

const PAGE = `<!doctype html><html><head><title>Implementation target</title></head>
<body style="margin:0;background:#fff">
<div style="position:absolute;left:100px;top:120px;width:120px;height:80px;background:#fff"></div>
</body></html>`;
const server = createServer((_request, response) => {
  response.setHeader("content-type", "text/html");
  response.end(PAGE);
});
await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const port = server.address().port;

const FRAME_PNG = await sharp({
  create: {
    width: 640,
    height: 400,
    channels: 4,
    background: { r: 255, g: 255, b: 255, alpha: 1 },
  },
})
  .composite([
    {
      input: Buffer.from(
        '<svg width="640" height="400"><rect x="100" y="120" width="120" height="80" fill="#ff00ff"/></svg>',
      ),
      top: 0,
      left: 0,
    },
  ])
  .png()
  .toBuffer();
const frameBase64 = FRAME_PNG.toString("base64");
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

const report = {
  schemaVersion: 1,
  host: "synthetic Figma origin; plugin host is not the live Figma service",
  extension: "built manifest and service worker",
  plugin: "built UI bundle inside opaque-origin iframe",
  checks: {},
};
const profileDir = await mkdtemp(join(tmpdir(), "figdiff-plugin-bridge-"));
const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  viewport: { width: 640, height: 400 },
  recordVideo: { dir: evidenceDir, size: { width: 640, height: 400 } },
  args: [
    "--disable-gpu",
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
    "--no-first-run",
    "--no-default-browser-check",
  ],
});
context.on("close", () => {
  report.checks.browserContextClosed = true;
});
const videos = [];
let figmaPage;
let implementationPage;
const pageErrors = [];
const consoleErrors = [];

try {
  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent("serviceworker", { timeout: 15_000 });
  }
  const extensionId = new URL(serviceWorker.url()).host;
  report.checks.extensionServiceWorker = { running: true, extensionId };

  implementationPage = await context.newPage();
  videos.push({
    originalPath: await implementationPage.video().path(),
    file: "implementation-handoff.webm",
  });
  implementationPage.on("close", () => {
    report.checks.implementationPageClosed = true;
  });
  implementationPage.on("crash", () => {
    report.checks.implementationPageCrashed = true;
  });
  await implementationPage.goto(`http://127.0.0.1:${port}/implementation`);
  await implementationPage.waitForLoadState("load");
  implementationPage.on("pageerror", (error) => pageErrors.push(String(error)));
  implementationPage.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.waitForSelector("text=Figma");
  await implementationPage.bringToFront();
  const targetResponse = await popup.evaluate(
    () =>
      new Promise((resolveResponse) => {
        chrome.runtime.sendMessage({ type: "plugin:target:set" }, resolveResponse);
      }),
  );
  assert.equal(targetResponse.target?.url, `http://127.0.0.1:${port}/implementation`);
  report.checks.targetTabSaved = {
    title: targetResponse.target.title,
    url: targetResponse.target.url,
  };

  figmaPage = await context.newPage();
  videos.push({
    originalPath: await figmaPage.video().path(),
    file: "plugin-extension-handoff.webm",
  });
  figmaPage.on("pageerror", (error) => pageErrors.push(String(error)));
  figmaPage.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await figmaPage.route("https://www.figma.com/**", (route) => {
    if (new URL(route.request().url()).pathname === "/synthetic-ui") {
      return route.fulfill({ status: 200, contentType: "text/html", body: pluginHtml });
    }
    return route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html><head><title>Synthetic Figma host</title></head>
<body style="margin:0;background:#eef2f6">
<script>
const iframe = document.createElement("iframe");
iframe.id = "plugin";
iframe.setAttribute("sandbox", "allow-scripts");
iframe.src = "/synthetic-ui";
iframe.style.cssText = "width:420px;height:620px;border:0;background:white";
document.body.appendChild(iframe);
window.addEventListener("message", (event) => {
  if (event.source !== iframe.contentWindow) return;
  const pluginMessage = event.data?.pluginMessage;
  if (pluginMessage?.type === "export-frame") {
    iframe.contentWindow.postMessage({
      pluginMessage: {
        type: "export-result",
        requestId: pluginMessage.requestId,
        base64: ${JSON.stringify(frameBase64)}
      }
    }, "*");
  }
});
</script></body></html>`,
    });
  });
  await figmaPage.goto("https://www.figma.com/design/synthetic/plugin-host");
  const pluginFrame = figmaPage.frameLocator("#plugin");
  await pluginFrame.locator("#app").waitFor();
  await figmaPage.evaluate(() => {
    const frame = document.querySelector("#plugin");
    frame.contentWindow.postMessage(
      {
        pluginMessage: {
          type: "selection",
          nodes: [{ id: "synthetic:1", name: "Checkout", type: "FRAME", width: 640, height: 400 }],
        },
      },
      "*",
    );
  });
  await pluginFrame.getByText("Checkout (640x400)").waitFor();
  report.checks.pluginSelectionDisplayed = true;
  // 操作動画で送信前の選択と送信後の表示を読める長さにする。
  await figmaPage.waitForTimeout(1_500);

  await pluginFrame.getByRole("button", { name: "Send frame to Chrome extension" }).click();
  await implementationPage.waitForSelector("#figdiff-overlay img", { timeout: 15_000 });
  await pluginFrame.getByText("Frame sent to Implementation target.").waitFor({ timeout: 15_000 });
  await implementationPage.waitForTimeout(1_500);

  const overlayImage = await implementationPage.$eval("#figdiff-overlay img", (image) => ({
    blobUrl: image.src.startsWith("blob:"),
    complete: image.complete,
    width: image.naturalWidth,
    height: image.naturalHeight,
  }));
  assert.deepEqual(overlayImage, { blobUrl: true, complete: true, width: 640, height: 400 });
  report.checks.frameExportedAndOverlayShown = overlayImage;

  const overlayState = await popup.evaluate(
    () =>
      new Promise((resolveResponse) => {
        chrome.tabs.query({ url: "http://127.0.0.1/*" }, (tabs) => {
          const target = tabs.find((tab) => tab.title === "Implementation target");
          if (!target?.id) {
            resolveResponse(null);
            return;
          }
          chrome.tabs.sendMessage(target.id, { type: "get-state" }, resolveResponse);
        });
      }),
  );
  assert.deepEqual(overlayState, {
    active: true,
    mode: "transparent_overlay",
    opacity: 0.5,
  });
  report.checks.overlayStateConfirmed = overlayState;

  const screenshotPath = join(evidenceDir, "implementation-with-plugin-frame.png");
  const screenshot = await implementationPage.screenshot({ path: screenshotPath });
  const raw = await sharp(screenshot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const readPixel = (x, y) => {
    const offset = (y * raw.info.width + x) * raw.info.channels;
    return [raw.data[offset], raw.data[offset + 1], raw.data[offset + 2]];
  };
  const inside = readPixel(150, 150);
  const outside = readPixel(20, 20);
  assert.ok(
    Math.abs(inside[0] - 255) <= 2 &&
      Math.abs(inside[1] - 127) <= 3 &&
      Math.abs(inside[2] - 255) <= 2,
    `overlay pixel inside frame differs from independent alpha-composite oracle: ${inside}`,
  );
  assert.deepEqual(outside, [255, 255, 255]);
  report.checks.independentPixelOracle = {
    insideFrame: inside,
    outsideFrame: outside,
    expectedInside: [255, 127, 255],
  };

  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  report.checks.runtimeErrors = { page: pageErrors, console: consoleErrors };
  report.artifacts = {
    screenshot: {
      file: "implementation-with-plugin-frame.png",
      sha256: sha256(await readFile(screenshotPath)),
    },
    inputFrame: { sha256: sha256(FRAME_PNG), width: 640, height: 400 },
  };
} catch (error) {
  report.error = error instanceof Error ? error.stack : String(error);
  throw error;
} finally {
  await context.close().catch((error) => {
    report.cleanupError = error instanceof Error ? error.message : String(error);
  });
  for (const video of videos) {
    const videoPath = join(evidenceDir, video.file);
    try {
      await copyFile(video.originalPath, videoPath);
      report.artifacts ??= {};
      report.artifacts[video.file] = {
        file: video.file,
        sha256: sha256(await readFile(videoPath)),
      };
    } catch (error) {
      report.artifacts ??= {};
      report.artifacts[video.file] = {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  await writeFile(join(evidenceDir, "evidence.json"), `${JSON.stringify(report, null, 2)}\n`);
  await new Promise((resolveClose) => server.close(resolveClose));
}

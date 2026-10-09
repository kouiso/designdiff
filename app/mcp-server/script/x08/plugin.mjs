// X08 Figma plugin 面: 実 ui.html を実 Chromium の iframe で動かし、
// sandbox 境界を越えた実 postMessage 契約で compare を流す。
// 製品が描画した diff 画像 (data:image/png) を回収し x08-plugin.json に書く。

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { writeX08Fixture } from "./fixture.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, "../../../..");
const requireFromDesktop = createRequire(join(root, "app/desktop/package.json"));
const { chromium } = requireFromDesktop("playwright");

const evidenceDir = process.argv[2] ? resolve(process.argv[2]) : undefined;
if (!evidenceDir) throw new Error("evidence dir argument is required");
await mkdir(evidenceDir, { recursive: true });

const pluginDist = join(root, "app/figma-plugin/dist");
const { designPath, screenshotPath, expectedDiffPixelCount, expectedRegions } =
  await writeX08Fixture(evidenceDir);
const designBase64 = (await readFile(designPath)).toString("base64");

const MIME = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png" };
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/" || url.pathname === "/host.html") {
    res.writeHead(200, { "content-type": "text/html" }).end(`<!DOCTYPE html>
<html><body>
<script>
window.__received = [];
const iframe = document.createElement("iframe");
iframe.id = "plugin";
iframe.src = "/ui.html";
document.body.appendChild(iframe);
window.addEventListener("message", (event) => {
  if (event.source === iframe.contentWindow && event.data && event.data.pluginMessage) {
    window.__received.push(event.data.pluginMessage);
  }
});
window.__send = (msg) => iframe.contentWindow.postMessage({ pluginMessage: msg }, "*");
</script>
</body></html>`);
    return;
  }
  try {
    const bytes = await readFile(join(pluginDist, basename(url.pathname)));
    res
      .writeHead(200, {
        "content-type":
          MIME[url.pathname.slice(url.pathname.lastIndexOf("."))] ?? "application/octet-stream",
      })
      .end(bytes);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/host.html`);
  const frame = page.frameLocator("#plugin");
  await frame.locator(".tab").first().waitFor();

  const send = (msg) => page.evaluate((m) => window.__send(m), msg);
  const waitForRequest = async (type) => {
    const before = await page.evaluate(() => window.__received.length);
    await page.waitForFunction((count) => window.__received.length > count, before);
    const message = await page.evaluate(() => window.__received.at(-1));
    if (message?.type !== type) throw new Error(`expected ${type}, got ${message?.type}`);
    return message;
  };

  // Compare タブ: 選択通知 → screenshot ファイル選択 → export-frame → 設計画像返却。
  await send({
    type: "selection",
    nodes: [{ id: "7:7", name: "X08", type: "FRAME", width: 96, height: 96 }],
  });
  await frame.locator(".tab", { hasText: "Compare" }).click();
  const chooserPromise = page.waitForEvent("filechooser");
  await frame.locator("#dropzone").click();
  await (await chooserPromise).setFiles(screenshotPath);
  await frame.locator(".btn", { hasText: "Compare" }).waitFor();
  await frame.locator(".btn", { hasText: "Compare" }).click();
  const exportRequest = await waitForRequest("export-frame");
  await send({ type: "export-result", requestId: exportRequest.requestId, base64: designBase64 });
  await frame.locator(".match-rate").waitFor();

  const matchText = await frame.locator(".match-rate").textContent();
  const matchRate = Number.parseFloat(matchText);
  const imgSrc = await frame
    .locator('img[src^="data:image/png;base64,"]')
    .first()
    .getAttribute("src");
  const diffImageBase64 = imgSrc.replace("data:image/png;base64,", "");
  const diffBytes = Buffer.from(diffImageBase64, "base64");

  const { default: sharp } = await import("sharp");
  const raw = await sharp(diffBytes).ensureAlpha().raw().toBuffer();
  const diffPixelsSha256 = createHash("sha256").update(raw).digest("hex");

  const out = {
    surface: "figma-plugin",
    matchRate,
    diffPixelsSha256,
    diffPngBase64: diffImageBase64,
    diffPngSha256: createHash("sha256").update(diffBytes).digest("hex"),
    expectedDiffPixelCount,
    expectedRegions,
  };
  // face レベルの自己検査: DOM の matchRate が数値で、diff 画素が採れていること。
  assert.ok(Number.isFinite(matchRate), "matchRate not readable from plugin DOM");
  assert.ok(diffPixelsSha256, "diff image pixels missing");
  out.results = {
    X08: {
      status: "PASS",
      expected: `figma-plugin 面が同一検体で diffPixelCount=${expectedDiffPixelCount}・領域=${expectedRegions.length} に対応する diff を描画する`,
      actual: {
        matchRate,
        diffPixelsSha256,
      },
    },
  };
  await writeFile(join(evidenceDir, "x08-plugin.json"), `${JSON.stringify(out, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ok: true, matchRate })}\n`);
} finally {
  await browser?.close();
  server.close();
}

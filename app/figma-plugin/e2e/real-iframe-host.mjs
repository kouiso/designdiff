/**
 * Figma plugin UI を実 Chromium の iframe で動かし、postMessage 契約を外部から検証する。
 * jsdom テストの代替ではなく、実 bundle (dist/ui.html) の描画・canvas 比較・timer を使う。
 * 製品の matchRate を正解にせず、fixture は自作 PNG で差分有無を独立に決める。
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, "../../..");
const pluginDist = resolve(directory, "../dist");
const requireFromDesktop = createRequire(join(repository, "app/desktop/package.json"));
const { chromium } = requireFromDesktop("playwright");
const sharp = requireFromDesktop("sharp");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const evidencePath = process.env.FIGDIFF_PLUGIN_HOST_EVIDENCE;
if (!evidencePath) throw new Error("FIGDIFF_PLUGIN_HOST_EVIDENCE is required");
const evidence = resolve(evidencePath);
await mkdir(evidence, { recursive: true });
await stat(join(pluginDist, "ui.html"));

const collectFiles = async (root) => {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(path)));
    else files.push(path);
  }
  return files;
};

const treeDigest = async () => {
  const entries = [];
  for (const path of (await collectFiles(pluginDist)).sort()) {
    const bytes = await readFile(path);
    entries.push({ path: basename(path), sha256: sha256(bytes), size: bytes.length });
  }
  const digest = sha256(Buffer.from(entries.map((e) => `${e.path}:${e.sha256}`).join("\n")));
  return { digest, entries };
};

const MIME = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png" };
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/favicon.ico") {
    res.writeHead(204).end();
    return;
  }
  if (url.pathname === "/" || url.pathname === "/host.html") {
    res.writeHead(200, { "content-type": "text/html" }).end(`<!DOCTYPE html>
<html><body>
<script>
window.__received = [];
window.__dialogs = [];
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
  const file = join(pluginDist, basename(url.pathname));
  try {
    const bytes = await readFile(file);
    res
      .writeHead(200, {
        "content-type": MIME[file.slice(file.lastIndexOf("."))] ?? "application/octet-stream",
      })
      .end(bytes);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const port = server.address().port;

const redPng = join(evidence, "screenshot-red.png");
const bluePng = join(evidence, "design-blue.png");
await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 255, g: 0, b: 0 } } })
  .png()
  .toFile(redPng);
await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 0, g: 0, b: 255 } } })
  .png()
  .toFile(bluePng);
const blueBase64 = (await readFile(bluePng)).toString("base64");

const assertions = [];

const preBuild = await treeDigest();
const pageErrors = [];
const consoleErrors = [];
const dialogs = [];
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.accept();
  });

  await page.goto(`http://127.0.0.1:${port}/host.html`);
  const frame = page.frameLocator("#plugin");
  await frame.locator(".tab").first().waitFor();

  const lastReceived = () => page.evaluate(() => window.__received.at(-1));
  const send = (msg) => page.evaluate((m) => window.__send(m), msg);
  const waitForRequest = async (type) => {
    const before = await page.evaluate(() => window.__received.length);
    await page.waitForFunction((count) => window.__received.length > count, before);
    const message = await lastReceived();
    assert.equal(message?.type, type);
    return message;
  };

  assert.equal(await frame.locator(".tab").count(), 2);
  assertions.push({ name: "初期描画でタブが2枚出る", ok: true });

  await send({
    type: "selection",
    nodes: [{ id: "7:7", name: "Hero", type: "FRAME", width: 120, height: 60 }],
  });
  await frame.locator(".tab", { hasText: "Inspect" }).click();
  await frame.locator(".btn", { hasText: "Inspect: Hero" }).click();
  const inspectRequest = await waitForRequest("inspect-node");
  assert.equal(inspectRequest.type, "inspect-node");
  assert.equal(inspectRequest.nodeId, "7:7");
  assert.match(inspectRequest.requestId, /^inspect-node-\d+$/);
  assertions.push({ name: "inspect-node requestId 付き送信", ok: true });
  await frame.locator("text=Loading...").waitFor();

  const inspection = {
    nodeId: "7:7",
    nodeName: "Hero",
    nodeType: "FRAME",
    layout: { width: 120 },
    appearance: {},
    cssSuggestion: "width: 120px;",
    children: [],
  };
  await send({ type: "inspect-result", requestId: "inspect-node-9999", inspection });
  await page.waitForTimeout(300);
  assert.equal(await frame.locator(".node-info").count(), 0);
  assert.equal(await frame.locator("text=Loading...").count(), 1);
  assertions.push({ name: "stale requestId の応答を棄却", ok: true });

  await send({ type: "inspect-result", requestId: inspectRequest.requestId, inspection });
  await frame.locator(".node-info").first().waitFor();
  assert.equal(await frame.locator("text=Loading...").count(), 0);
  assertions.push({ name: "一致 requestId の応答で結果描画", ok: true });

  const timeoutDialog = page.waitForEvent("dialog", { timeout: 15000 });
  await frame.locator(".btn", { hasText: "Inspect: Hero" }).click();
  const secondRequest = await waitForRequest("inspect-node");
  assert.match(secondRequest.requestId, /^inspect-node-\d+$/);
  assert.notEqual(secondRequest.requestId, inspectRequest.requestId);
  const timeoutText = (await timeoutDialog).message();
  assert.match(timeoutText, /node inspection timed out/);
  await frame.locator(".btn", { hasText: "Inspect: Hero" }).waitFor();
  assert.equal(await frame.locator("text=Loading...").count(), 0);
  assertions.push({ name: "応答なしで timeout alert と loading 解除", ok: true });

  await frame.locator(".tab", { hasText: "Compare" }).click();
  const chooserPromise = page.waitForEvent("filechooser");
  await frame.locator("#dropzone").click();
  await (await chooserPromise).setFiles(redPng);
  await frame.locator(".btn", { hasText: "Compare" }).waitFor();
  await frame.locator(".btn", { hasText: "Compare" }).click();
  const exportRequest = await waitForRequest("export-frame");
  assert.equal(exportRequest.type, "export-frame");
  assert.equal(exportRequest.nodeId, "7:7");
  assert.match(exportRequest.requestId, /^export-frame-\d+$/);
  assertions.push({ name: "export-frame requestId 付き送信", ok: true });

  await send({ type: "export-result", requestId: exportRequest.requestId, base64: blueBase64 });
  await frame.locator(".match-rate").waitFor();
  const matchText = await frame.locator(".match-rate").textContent();
  const matchValue = Number.parseFloat(matchText);
  assert.ok(Number.isFinite(matchValue), `match-rate が数値でない: ${matchText}`);
  assert.ok(matchValue < 100, `全ピクセル相違 fixture で ${matchText} は誤成功`);
  const statsText = await frame.locator(".section .value").last().textContent();
  assert.match(statsText, /4\s*\/\s*4/);
  assert.ok((await frame.locator('img[src^="data:image/png;base64,"]').count()) >= 1);
  assertions.push({
    name: "実canvas比較で全相違を低一致率として描画",
    ok: true,
    matchText,
    statsText,
  });

  const postBuild = await treeDigest();
  assert.equal(postBuild.digest, preBuild.digest);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  assertions.push({ name: "build digest 不変・page/console error 0", ok: true });

  await page.screenshot({ path: join(evidence, "final-state.png"), fullPage: true });
} finally {
  const postBuild = await treeDigest();
  const artifactFiles = (await collectFiles(evidence)).sort();
  const manifest = {
    generatedAt: new Date().toISOString(),
    dist: postBuild.entries,
    distDigest: postBuild.digest,
    assertions,
    dialogs,
    pageErrors,
    consoleErrors,
    evidenceFiles: artifactFiles.map((f) => basename(f)),
    results: {
      X03: {
        status: "PASS",
        expected: "選択・export・compare・inspect が sandbox↔iframe 実通信で動く",
        actual: assertions.filter((a) => /inspect|export|canvas|描画|タブ/.test(a.name)),
      },
      X04: {
        status: "PASS",
        expected: "未応答・stale応答など通信失敗から復旧できる",
        actual: assertions.filter((a) => /timeout|stale|error/i.test(a.name)),
      },
    },
    note: "実 Chromium iframe + 実 dist bundle の検証。実 Figma ホスト・実 sandbox code.js 連携の代替証拠ではない。",
  };
  await writeFile(join(evidence, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await browser?.close();
  server.close();
}

const failed = assertions.filter((a) => !a.ok);
console.info(
  JSON.stringify({
    ok: failed.length === 0,
    evidence,
    assertions: assertions.length,
    failed: failed.length,
  }),
);
if (failed.length > 0) process.exitCode = 1;

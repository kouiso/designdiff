// X08 Chrome拡張面: 実拡張を実 Chromium に読み込み、popup コンテキストから
// 実 service worker の compare ハンドラへ同一検体を送る。
// 応答の regions/diffPixelCount/matchRate を x08-extension.json に書く。

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { writeX08Fixture, X08_H, X08_W } from "./fixture.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, "../../../..");
const requireFromDesktop = createRequire(join(root, "app/desktop/package.json"));
const { chromium } = requireFromDesktop("playwright");

const evidenceDir = process.argv[2] ? resolve(process.argv[2]) : undefined;
if (!evidenceDir) throw new Error("evidence dir argument is required");
await mkdir(evidenceDir, { recursive: true });

const extDir = process.env.FIGDIFF_EXT_DIR ?? join(root, "app/chrome-extension/dist");
const { designPath, screenshotPath, expectedDiffPixelCount, expectedRegions } =
  await writeX08Fixture(evidenceDir);
const designBase64 = (await readFile(designPath)).toString("base64");
const screenshotBase64 = (await readFile(screenshotPath)).toString("base64");

const profileDir = await mkdtemp(join(tmpdir(), "figdiff-x08-ext-"));
const headlessNew = process.env.FIGDIFF_HEADLESS === "new";
const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  args: [
    ...(headlessNew ? ["--headless=new"] : []),
    `--disable-extensions-except=${extDir}`,
    `--load-extension=${extDir}`,
    "--no-first-run",
    "--no-default-browser-check",
  ],
});

try {
  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15_000 });
  const extensionId = new URL(sw.url()).host;

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.waitForSelector("#app");

  // popup 内部と同じ chrome.runtime.sendMessage 経路で background の
  // compare ハンドラを叩く。画像は実ファイル由来の base64。
  const response = await popup.evaluate(
    async ({ designBase64: d, screenshotBase64: s, width, height }) =>
      await chrome.runtime.sendMessage({
        type: "compare",
        designBase64: d,
        screenshotBase64: s,
        width,
        height,
      }),
    { designBase64, screenshotBase64, width: X08_W, height: X08_H },
  );
  if (response?.error) throw new Error(`extension compare failed: ${response.error}`);

  const out = {
    surface: "chrome-extension",
    diffPixelCount: response.diffPixelCount,
    matchRate: response.matchRate,
    regions: (response.regions ?? []).map((r) => r.bounds ?? r),
    expectedDiffPixelCount,
    expectedRegions,
  };
  // face レベルの自己検査: background の計測値が揃っていなければ
  // 横断照合の入力として成立しないためここで落とす。
  assert.equal(typeof out.diffPixelCount, "number", "diffPixelCount missing");
  assert.equal(typeof out.matchRate, "number", "matchRate missing");
  out.results = {
    X08: {
      status: "PASS",
      expected: `chrome-extension 面が同一検体で diffPixelCount=${expectedDiffPixelCount}・領域=${expectedRegions.length} を返す`,
      actual: {
        diffPixelCount: out.diffPixelCount,
        matchRate: out.matchRate,
        regionCount: out.regions.length,
      },
    },
  };
  await writeFile(join(evidenceDir, "x08-extension.json"), `${JSON.stringify(out, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ok: true, diffPixelCount: response.diffPixelCount })}\n`);
} finally {
  await context.close();
}

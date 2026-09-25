// 実Chrome拡張 E2E 検証 (X01/X02)。
// dist/ を実 Chromium へ読み込み、popup → background(service worker) →
// content script の実通信で overlay を出し、移動・スクロール追従・透明度・
// ページ遷移・閉じた後の操作性を確認する。再現DOM注入はしない。
//
// 判定はページ上の実DOM・実スタイルで行い、拡張自身の状態表示は使わない。
// 第1引数: 証跡ディレクトリ (必須)。実行には X server か xvfb-run が要る。

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
// playwright/sharp は chrome-extension の依存ではないため、desktop の
// package.json を起点に解決する (pnpm は依存を巻き上げない)。
const desktopRequire = createRequire(join(root, "app/desktop/package.json"));
const { chromium } = desktopRequire("playwright/test");
const sharp = desktopRequire("sharp");
// 既定は出荷物そのままの dist。FIGDIFF_EXT_DIR を渡すと権限だけを拡げた
// 検証用複製を使える (activeTab は自動化では付与されんため)。
const extDir = process.env.FIGDIFF_EXT_DIR
  ? resolve(process.env.FIGDIFF_EXT_DIR)
  : join(root, "app/chrome-extension/dist");
// compare は captureVisibleTab を要し、activeTab 未付与の自動化では失敗する。
// 権限拡張済み複製で走らせる時だけ FIGDIFF_EXPECT_COMPARE=1 を立てる。
const expectCompare = process.env.FIGDIFF_EXPECT_COMPARE === "1";
const evidenceDir = process.argv[2] ? resolve(process.argv[2]) : undefined;
if (!evidenceDir) throw new Error("evidence dir argument is required");
await mkdir(evidenceDir, { recursive: true });

const evidence = { schemaVersion: 1, results: {}, errors: [] };
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
// 検証対象の manifest を証跡に残し、権限拡張版との区別を後から追えるようにする
evidence.results.extUnderTest = {
  dir: extDir.replace(root, "<repo>"),
  manifest: JSON.parse(await readFile(join(extDir, "manifest.json"), "utf8")),
};

// --- 検体ページ: 既知要素 + 縦長コンテンツ + クリック計測用マーカー ---
const PAGE_A = `<!doctype html><html><body style="margin:0">
<div id="marker" style="position:absolute;left:100px;top:120px;width:80px;height:40px;background:#18A957"></div>
<button id="hit" style="position:absolute;left:300px;top:400px;width:120px;height:40px">hit-me</button>
<div style="height:3000px;background:linear-gradient(#fff,#000)"></div>
<script>window.__hits=0;document.getElementById('hit').addEventListener('click',()=>window.__hits++);</script>
</body></html>`;
const PAGE_B = `<!doctype html><html><body style="background:#222;color:#eee">page-b</body></html>`;

const server = createServer((req, res) => {
  res.setHeader("content-type", "text/html");
  res.end(req.url === "/b" ? PAGE_B : PAGE_A);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

// --- 検体画像: ページ要素と同位置の矩形 (overlay 内容の実在確認用) ---
const designPath = join(evidenceDir, "input-design.png");
await sharp({
  create: {
    width: 800,
    height: 600,
    channels: 4,
    background: { r: 255, g: 255, b: 255, alpha: 1 },
  },
})
  .composite([
    {
      input: Buffer.from(
        `<svg width="800" height="600"><rect x="100" y="120" width="80" height="40" fill="#18A957"/></svg>`,
      ),
      top: 0,
      left: 0,
    },
  ])
  .png()
  .toFile(designPath);

const profileDir = await mkdtemp(join(tmpdir(), "figdiff-ext-profile-"));
// ディスプレイ無し環境(SSHのmacOS等)は FIGDIFF_HEADLESS=new で新headlessに
// 切替える。拡張読み込みは新headlessでも動くが、captureVisibleTab の可否は
// 環境依存なので evidence の outcome で判定する。
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
  // service worker 起動 = background.js が実登録された証拠
  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15_000 });
  const extensionId = new URL(sw.url()).host;
  evidence.results.X01_service_worker = { url: sw.url(), extensionId };
  assert.ok(extensionId.length > 0);

  const pageA = await context.newPage();
  await pageA.goto(`http://127.0.0.1:${port}/a`);
  await pageA.waitForSelector("#marker");

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.waitForSelector("text=Figma");
  evidence.results.X01_popup_rendered = {
    tabs: await popup.$$eval("#app button", (bs) => bs.map((b) => b.textContent)),
  };

  // Upload タブ → 検体画像を載せる
  await popup.evaluate(() => {
    [...document.querySelectorAll("#app button")].find((b) => b.textContent === "Upload").click();
  });
  await popup.setInputFiles('#app input[type="file"]', designPath);
  await popup.waitForSelector("text=Design loaded", { timeout: 10_000 });
  evidence.results.X01_upload_loaded = true;

  // 対象ページを前面にしてから popup の Show Overlay を DOM click する。
  // popup の sendToActiveTab は active tab を引くため、先に pageA を activate する。
  await pageA.bringToFront();
  await popup.evaluate(() => {
    [...document.querySelectorAll("#app button")]
      .find((b) => b.textContent === "Show Overlay")
      .click();
  });
  await pageA.waitForSelector("#figdiff-overlay", { timeout: 10_000 });
  const overlayBox = await pageA.locator("#figdiff-overlay").boundingBox();
  assert.ok(overlayBox, "overlay element must exist on the real page");
  evidence.results.X01_overlay_shown = { box: overlayBox };

  // overlay画像が実際に描画されているか (src が blob: で生成済み)
  const imgSrc = await pageA.$eval("#figdiff-overlay img", (img) => img.src);
  assert.ok(imgSrc.startsWith("blob:"), "overlay img must be a real blob URL");
  evidence.results.X01_overlay_img = { blobUrl: true };

  // X02-透明度: 初期mode (transparent_overlay) の slider を動かし実変化する
  await popup.evaluate(() => {
    const slider = document.querySelector("#app input[type=range]");
    slider.value = "25";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await pageA.waitForFunction(
    () => document.querySelector("#figdiff-overlay")?.style.opacity === "0.25",
    undefined,
    { timeout: 10_000 },
  );
  evidence.results.X02_opacity = { applied: 0.25 };

  // X02-移動: Draggable Overlay モードへ切替 → 実マウスドラッグで translate が変わる
  await popup.evaluate(() => {
    [...document.querySelectorAll("#app button")]
      .find((b) => b.textContent?.includes("Draggable Overlay"))
      .click();
  });
  await pageA.waitForFunction(
    () => document.querySelector("#figdiff-overlay")?.style.cursor === "move",
    undefined,
    { timeout: 10_000 },
  );
  const before = await pageA.$eval("#figdiff-overlay", (el) => getComputedStyle(el).transform);
  await pageA.mouse.move(400, 300);
  await pageA.mouse.down();
  await pageA.mouse.move(480, 360, { steps: 5 });
  await pageA.mouse.up();
  const after = await pageA.$eval("#figdiff-overlay", (el) => el.style.transform);
  evidence.results.X02_drag = { before, after };
  assert.match(after, /translate\(80px, 60px\)/, `drag must move overlay by (80,60), got ${after}`);

  // X02-スクロール追従: fixed配置なので viewport 座標は変わらない
  const preScroll = await pageA.locator("#figdiff-overlay").boundingBox();
  await pageA.evaluate(() => window.scrollTo(0, 1500));
  await pageA.waitForTimeout(150);
  const postScroll = await pageA.locator("#figdiff-overlay").boundingBox();
  evidence.results.X02_scroll = {
    preScroll,
    postScroll,
    scrollY: await pageA.evaluate(() => scrollY),
  };
  assert.deepEqual(
    { x: postScroll.x, y: postScroll.y },
    { x: preScroll.x, y: preScroll.y },
    "overlay must stay viewport-fixed across scroll",
  );

  // X02-ページ遷移: 別ページへ行くと overlay は残らない
  await pageA.goto(`http://127.0.0.1:${port}/b`);
  await pageA.waitForLoadState("load");
  const leaked = await pageA.$("#figdiff-overlay");
  evidence.results.X02_navigation = { overlayLeaked: leaked !== null };
  assert.equal(leaked, null, "overlay must not leak into the next page");

  // X02-閉じる: 戻って再度 overlay を出し、Hide で消えて操作を妨げない。
  // ページ遷移で content 側の overlay は消えるが popup の overlayActive は
  // 残る (状態は popup メモリのみ) — その desync も証跡として記録する。
  await pageA.goto(`http://127.0.0.1:${port}/a`);
  await pageA.waitForSelector("#marker");
  await pageA.bringToFront();
  const staleLabel = await popup.evaluate(
    () =>
      [...document.querySelectorAll("#app button")].find((b) => b.textContent?.endsWith("Overlay"))
        ?.textContent ?? null,
  );
  evidence.results.X02_state_after_nav = { toggleLabel: staleLabel };
  if (staleLabel === "Hide Overlay") {
    await popup.evaluate(() => {
      [...document.querySelectorAll("#app button")]
        .find((b) => b.textContent === "Hide Overlay")
        .click();
    });
    await popup.waitForFunction(
      () =>
        [...document.querySelectorAll("#app button")].some((b) => b.textContent === "Show Overlay"),
      undefined,
      { timeout: 10_000 },
    );
  }
  await popup.evaluate(() => {
    [...document.querySelectorAll("#app button")]
      .find((b) => b.textContent === "Show Overlay")
      .click();
  });
  await pageA.waitForSelector("#figdiff-overlay", { timeout: 10_000 });
  await popup.evaluate(() => {
    [...document.querySelectorAll("#app button")]
      .find((b) => b.textContent === "Hide Overlay")
      .click();
  });
  await pageA.waitForSelector("#figdiff-overlay", { state: "detached", timeout: 10_000 });
  await pageA.click("#hit");
  const hits = await pageA.evaluate(() => window.__hits);
  evidence.results.X02_close = { overlayRemoved: true, pageClickWorked: hits === 1 };
  assert.equal(hits, 1, "page must be clickable after overlay removal");

  // X01-比較: Capture & Compare が background capture + diff を実実行する。
  // 結果 (.match-rate) かエラー (.error) のどちらかが出るのが契約。
  await popup.evaluate(() => {
    [...document.querySelectorAll("#app button")]
      .find((b) => b.textContent === "Capture & Compare")
      .click();
  });
  let compareOutcome = "timeout-silent";
  try {
    await popup.waitForFunction(
      () => document.querySelector("#app .match-rate") ?? document.querySelector("#app .error"),
      undefined,
      { timeout: 20_000 },
    );
    const rate = await popup.$("#app .match-rate");
    const err = await popup.$("#app .error");
    compareOutcome = rate
      ? `match-rate:${await rate.textContent()}`
      : err
        ? `error:${await err.textContent()}`
        : "unknown";
  } catch {
    // error は figma タブの section にしか描画されん — upload タブでは
    // 失敗がユーザーに不可視になる。その無応答自体を証跡に残す。
    compareOutcome = "no-visible-result";
    evidence.results.X01_compare_dom = {
      appText: await popup.$eval("#app", (el) => el.innerText),
    };
  }
  evidence.results.X01_compare = { outcome: compareOutcome };
  if (expectCompare) {
    assert.match(
      compareOutcome,
      /^match-rate:[\d.]+%$/,
      `compare must render a real match rate, got ${compareOutcome}`,
    );
  }

  // X01-token: Token タブで保存→SWの chrome.storage 往復→削除を確認する。
  // token 値そのものは証跡に残さず、往復が一致した事実だけ記録する。
  await popup.evaluate(() => {
    [...document.querySelectorAll("#app button")].find((b) => b.textContent === "Token").click();
  });
  await popup.fill('#app input[type="password"]', "e2e-fake-pat-not-real");
  await popup.evaluate(() => {
    [...document.querySelectorAll("#app button")]
      .find((b) => b.textContent === "Save Token")
      .click();
  });
  await popup.waitForTimeout(500);
  const readBack = await popup.evaluate(
    () =>
      new Promise((res) =>
        chrome.runtime.sendMessage({ type: "token:get" }, (r) => res(r?.token ?? null)),
      ),
  );
  assert.equal(readBack, "e2e-fake-pat-not-real", "token must round-trip through background");
  await popup.evaluate(() => {
    [...document.querySelectorAll("#app button")]
      .find((b) => b.textContent === "Clear Token")
      .click();
  });
  await popup.waitForTimeout(500);
  const afterClear = await popup.evaluate(
    () =>
      new Promise((res) =>
        chrome.runtime.sendMessage({ type: "token:get" }, (r) => res(r?.token ?? null)),
      ),
  );
  evidence.results.X01_token = { roundTrip: true, cleared: afterClear === null };
  assert.equal(afterClear, null, "token must be cleared");

  const shotPath = join(evidenceDir, "pageA-with-overlay.png");
  await pageA.screenshot({ path: shotPath });
  evidence.results.artifacts = {
    pageAScreenshot: { file: "pageA-with-overlay.png", sha256: sha256(await readFile(shotPath)) },
    designPng: { file: "input-design.png", sha256: sha256(await readFile(designPath)) },
  };

  await writeFile(join(evidenceDir, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${join(evidenceDir, "evidence.json")}\n`);
} catch (error) {
  evidence.errors.push(String(error?.stack ?? error));
  await writeFile(join(evidenceDir, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  throw error;
} finally {
  await context.close();
  server.close();
}

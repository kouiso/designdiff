// 実Chrome拡張 E2E 検証 (X01/X02)。
// dist/ を実 Chromium へ読み込み、popup → background(service worker) →
// content script の実通信で overlay を出し、移動・スクロール追従・透明度・
// ページ遷移・閉じた後の操作性を確認する。再現DOM注入はしない。
//
// 判定はページ上の実DOM・実スタイルで行い、拡張自身の状態表示は使わない。
// 一致率の期待値も拡張の出力ではなく、検体ページと検体画像の作図から決める。
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
// 複製は script/prepare-e2e-dist.mjs で dist/ の外に作る。
const shippedDir = join(root, "app/chrome-extension/dist");
const extDir = process.env.FIGDIFF_EXT_DIR ? resolve(process.env.FIGDIFF_EXT_DIR) : shippedDir;
// compare は captureVisibleTab を要し、activeTab 未付与の自動化では失敗する。
// 権限拡張済み複製で走らせる時だけ FIGDIFF_EXPECT_COMPARE=1 を立てる。
const expectCompare = process.env.FIGDIFF_EXPECT_COMPARE === "1";
const evidenceDir = process.argv[2] ? resolve(process.argv[2]) : undefined;
if (!evidenceDir) throw new Error("evidence dir argument is required");
await mkdir(evidenceDir, { recursive: true });

const evidence = { schemaVersion: 1, results: {}, errors: [] };
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
// 検証対象の manifest を証跡に残し、権限拡張版との区別を後から追えるようにする
const manifestUnderTest = JSON.parse(await readFile(join(extDir, "manifest.json"), "utf8"));
evidence.results.extUnderTest = {
  dir: extDir.replace(root, "<repo>"),
  manifest: manifestUnderTest,
};
// 権限拡張版で通った結果を出荷物の保証と取り違えないよう、拡張版は出荷 manifest に
// <all_urls> を足しただけ (name の識別子以外は同一) であることを先に確かめる。
if (extDir !== shippedDir) {
  const shippedManifest = JSON.parse(await readFile(join(shippedDir, "manifest.json"), "utf8"));
  const shippedHosts = shippedManifest.host_permissions ?? [];
  assert.ok(!shippedHosts.includes("<all_urls>"), "shipped manifest must not grant <all_urls>");
  assert.deepEqual(
    { ...manifestUnderTest, name: shippedManifest.name },
    { ...shippedManifest, host_permissions: [...shippedHosts, "<all_urls>"] },
    "E2E dist may differ from the shipped manifest only by <all_urls> and its name marker",
  );
  assert.notEqual(manifestUnderTest.name, shippedManifest.name, "E2E dist must be labeled");
  evidence.results.extUnderTest.addedOverShipped = { host_permissions: ["<all_urls>"] };
}

// --- 検体ページ: 既知要素 + 縦長コンテンツ + クリック計測用マーカー ---
const PAGE_A = `<!doctype html><html><body style="margin:0">
<div id="marker" style="position:absolute;left:100px;top:120px;width:80px;height:40px;background:#18A957"></div>
<button id="hit" style="position:absolute;left:300px;top:400px;width:120px;height:40px">hit-me</button>
<div style="height:3000px;background:linear-gradient(#fff,#000)"></div>
<script>window.__hits=0;document.getElementById('hit').addEventListener('click',()=>window.__hits++);</script>
</body></html>`;
const PAGE_B = `<!doctype html><html><body style="background:#222;color:#eee">page-b</body></html>`;
// 一致率の期待値を作図から決めるための比較専用ページ。白地に単色矩形だけを置き、
// グラデーション・文字・スクロールバーなど描画系依存の画素を持たせない。
const MARKER = { x: 100, y: 120, w: 80, h: 40, rgb: [0x18, 0xa9, 0x57] };
const PAGE_C = `<!doctype html><html><body style="margin:0;background:#fff;overflow:hidden">
<div id="marker" style="position:absolute;left:${MARKER.x}px;top:${MARKER.y}px;width:${MARKER.w}px;height:${MARKER.h}px;background:#18A957"></div>
</body></html>`;

const server = createServer((req, res) => {
  res.setHeader("content-type", "text/html");
  res.end(req.url === "/b" ? PAGE_B : req.url === "/c" ? PAGE_C : PAGE_A);
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
  // 結果 (.match-rate) か行動可能なエラー (.error) のどちらかが出るのが契約。
  // 「何も表示されない」のは失敗を握り潰しているだけなので、どの環境でも受け付けない。
  const clickCaptureAndCompare = () =>
    popup.evaluate(() => {
      [...document.querySelectorAll("#app button")]
        .find((b) => b.textContent === "Capture & Compare")
        .click();
    });
  await clickCaptureAndCompare();
  let compareOutcome = "no-visible-result";
  let visibleErrorText = null;
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
    visibleErrorText = err ? await err.textContent() : null;
  } catch {
    // DOM 全文を証跡に残す。ただし catch に落ちる時点で契約違反なので、
    // この後の assertion で必ず落とす。
    evidence.results.X01_compare_dom = {
      appText: await popup.$eval("#app", (el) => el.innerText),
    };
  }
  evidence.results.X01_compare = { outcome: compareOutcome, visibleErrorText };
  assert.match(
    compareOutcome,
    /^(match-rate:[\d.]+%|error:.+)$/,
    `compare must show a visible result, got ${compareOutcome}`,
  );
  if (expectCompare) {
    assert.match(
      compareOutcome,
      /^match-rate:[\d.]+%$/,
      `compare must render a real match rate, got ${compareOutcome}`,
    );
  } else if (!compareOutcome.startsWith("match-rate:")) {
    // activeTab 未付与の自動実行では captureVisibleTab が失敗する。その失敗は
    // 行動可能な案内として popup に見え、比較中表示が戻り、再試行できなければならない。
    assert.match(
      compareOutcome,
      /^error:Could not capture the page/,
      `capture failure must be visible and actionable, got ${compareOutcome}`,
    );
    const retryState = await popup.evaluate(() => {
      const btn = [...document.querySelectorAll("#app button")].find(
        (b) => b.textContent === "Capture & Compare" || b.textContent === "Comparing...",
      );
      return { label: btn?.textContent ?? null, disabled: btn?.disabled ?? null };
    });
    evidence.results.X01_compare_retry_state = retryState;
    assert.equal(
      retryState.label,
      "Capture & Compare",
      "capture failure must clear the comparing state so retry stays possible",
    );
    assert.equal(retryState.disabled, false, "retry button must not stay disabled");
    // 再試行でも同じ行動可能エラーが出ること — リトライ経路自体の実行証拠。
    // 前回の .error は比較中も state に残って描画され続けるため、出現待ちでは
    // 再試行が返らなくても即通ってしまう。Comparing... に入ってから抜けるまでを
    // 観測し、その完了時点で表示されているエラーを読む。
    const retryError = await popup.evaluate(
      () =>
        new Promise((resolveRetry, rejectRetry) => {
          const app = document.querySelector("#app");
          const compareButton = () =>
            [...app.querySelectorAll("button")].find(
              (b) => b.textContent === "Capture & Compare" || b.textContent === "Comparing...",
            );
          let sawComparing = false;
          const observer = new MutationObserver(() => {
            const btn = compareButton();
            if (btn?.textContent === "Comparing...") {
              sawComparing = true;
            } else if (sawComparing && btn && !btn.disabled) {
              observer.disconnect();
              clearTimeout(timer);
              resolveRetry(app.querySelector(".error")?.textContent ?? null);
            }
          });
          const timer = setTimeout(() => {
            observer.disconnect();
            rejectRetry(new Error(`retry did not complete (sawComparing=${sawComparing})`));
          }, 20_000);
          observer.observe(app, { childList: true, subtree: true, characterData: true });
          compareButton().click();
        }),
    );
    assert.ok(retryError, "retry must finish with a visible error");
    evidence.results.X01_compare_retry_error = retryError;
    assert.match(
      retryError,
      /^Could not capture the page/,
      `retry after capture failure must reproduce the actionable error, got ${retryError}`,
    );
  }

  if (expectCompare) {
    // X01-一致率: 期待値は作図だけから決める (拡張の出力を正解に使わない)。
    // 比較ページを実測した viewport 寸法で、ページと同じ配置の画像と、
    // 既知面積の矩形を足した画像を作り、表示された一致率と差分画素数を照合する。
    const pageC = await context.newPage();
    await pageC.goto(`http://127.0.0.1:${port}/c`);
    await pageC.waitForSelector("#marker");
    const viewport = await pageC.evaluate(() => ({
      cssWidth: innerWidth,
      cssHeight: innerHeight,
      dpr: devicePixelRatio,
    }));
    // 小数 DPR では矩形境界が補間され、画素数を作図から確定できない
    assert.ok(
      Number.isInteger(viewport.dpr) && viewport.dpr >= 1,
      `dpr must be integer, got ${viewport.dpr}`,
    );
    const width = viewport.cssWidth * viewport.dpr;
    const height = viewport.cssHeight * viewport.dpr;
    const totalPixels = width * height;
    assert.ok(totalPixels > 0, "viewport must have a positive area");

    const toDevice = (r) => ({
      x: r.x * viewport.dpr,
      y: r.y * viewport.dpr,
      w: r.w * viewport.dpr,
      h: r.h * viewport.dpr,
      rgb: r.rgb,
    });
    // 白地との差が閾値を大きく超え、AA 判定にも掛からない (内側に同色画素が十分ある) 矩形
    const EXTRA = { x: 400, y: 200, w: 200, h: 100, rgb: [0, 0, 0] };
    const writeDesign = async (file, rects) => {
      const buf = Buffer.alloc(totalPixels * 4, 255);
      for (const { x, y, w, h, rgb } of rects.map(toDevice)) {
        assert.ok(x >= 0 && y >= 0 && x + w <= width && y + h <= height, "rect must fit viewport");
        for (let yy = y; yy < y + h; yy++) {
          for (let xx = x; xx < x + w; xx++) {
            const i = (yy * width + xx) * 4;
            buf[i] = rgb[0];
            buf[i + 1] = rgb[1];
            buf[i + 2] = rgb[2];
          }
        }
      }
      const path = join(evidenceDir, file);
      await sharp(buf, { raw: { width, height, channels: 4 } })
        .png()
        .toFile(path);
      return path;
    };
    const cases = [
      {
        label: "identical",
        file: await writeDesign("design-identical.png", [MARKER]),
        expectedDiffPixels: 0,
      },
      {
        label: "mismatch",
        file: await writeDesign("design-mismatch.png", [MARKER, EXTRA]),
        expectedDiffPixels: toDevice(EXTRA).w * toDevice(EXTRA).h,
      },
    ];

    // toLocaleString 書式 (数字と桁区切りだけ) 以外を弾く。`-20,000` や `NaN` のような
    // 退行を非数字の削除で丸めて受け入れないため、ここで構造を固定する。
    const parseCount = (s) => Number(s.replace(/,/g, ""));
    const matchRateResults = [];
    for (const c of cases) {
      // 前回比較後に再表示された overlay が capture に写らないよう、毎回読み直す
      await pageC.goto(`http://127.0.0.1:${port}/c`);
      await pageC.waitForSelector("#marker");
      assert.equal(
        await pageC.$("#figdiff-overlay"),
        null,
        "page must be overlay-free before capture",
      );

      // 前回の一致率表示を新しい結果と取り違えないよう、比較ごとに新しい popup を開く
      const comparePopup = await context.newPage();
      await comparePopup.goto(`chrome-extension://${extensionId}/popup.html`);
      await comparePopup.waitForSelector("text=Figma");
      await comparePopup.evaluate(() => {
        [...document.querySelectorAll("#app button")]
          .find((b) => b.textContent === "Upload")
          .click();
      });
      await comparePopup.setInputFiles('#app input[type="file"]', c.file);
      await comparePopup.waitForSelector("text=Design loaded", { timeout: 10_000 });
      await pageC.bringToFront();
      await comparePopup.evaluate(() => {
        [...document.querySelectorAll("#app button")]
          .find((b) => b.textContent === "Capture & Compare")
          .click();
      });
      await comparePopup.waitForSelector("#app .match-rate, #app .error", { timeout: 20_000 });
      const errorText = await comparePopup.$eval(
        "#app",
        (el) => el.querySelector(".error")?.textContent ?? null,
      );
      assert.equal(errorText, null, `${c.label}: compare must not error, got ${errorText}`);
      const rateText = await comparePopup.$eval("#app .match-rate", (el) => el.textContent);
      const statsText = await comparePopup.$eval("#app .result .stats", (el) => el.textContent);
      const popupShot = `popup-match-rate-${c.label}.png`;
      await comparePopup.screenshot({ path: join(evidenceDir, popupShot) });
      const pageShot = `page-compare-${c.label}.png`;
      await pageC.screenshot({ path: join(evidenceDir, pageShot) });
      await comparePopup.close();

      const expectedRatePercent = ((totalPixels - c.expectedDiffPixels) / totalPixels) * 100;
      const stats = statsText.match(
        /^(\d{1,3}(?:,\d{3})*|\d+) diff px \/ (\d{1,3}(?:,\d{3})*|\d+) total$/,
      );
      const result = {
        label: c.label,
        design: c.file.replace(evidenceDir, "<evidence>"),
        expected: {
          diffPixels: c.expectedDiffPixels,
          totalPixels,
          ratePercent: expectedRatePercent,
        },
        displayed: { rateText, statsText },
        screenshots: { popup: popupShot, page: pageShot },
      };
      matchRateResults.push(result);
      evidence.results.X01_match_rate = { viewport, cases: matchRateResults };

      assert.ok(stats, `${c.label}: stats must read "<n> diff px / <n> total", got ${statsText}`);
      assert.equal(
        parseCount(stats[2]),
        totalPixels,
        `${c.label}: total px must equal the viewport area`,
      );
      assert.equal(
        parseCount(stats[1]),
        c.expectedDiffPixels,
        `${c.label}: diff px must equal the constructed difference`,
      );
      const rateMatch = rateText.match(/^(\d+(?:\.\d+)?)%$/);
      assert.ok(rateMatch, `${c.label}: match rate must read "<n>%", got ${rateText}`);
      // 表示は小数2桁丸めなので、作図から求めた真値との差は 0.005 以内に収まる
      assert.ok(
        Math.abs(Number(rateMatch[1]) - expectedRatePercent) <= 0.005,
        `${c.label}: displayed ${rateText} must match constructed ${expectedRatePercent}%`,
      );
    }
    await pageC.close();
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
  console.info(join(evidenceDir, "evidence.json"));
} catch (error) {
  evidence.errors.push(String(error?.stack ?? error));
  await writeFile(join(evidenceDir, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  throw error;
} finally {
  await context.close();
  server.close();
}

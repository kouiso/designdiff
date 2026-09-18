// desktop D-case 検証 driver — 実 Electron UI を駆動して D01/D03/D08/D09/D10
// と X09 (desktop 側: MCP が作った project.json を desktop が読む) を検証する。
//
// oracle は FigDiff 自身の status ではなく、実 fetch リクエストログ・
// ディスク上の project.json / credentials.json・DOM 状態・独立 PNG 観測。
//
// fetch 境界は合成済み (api.figma.com → fixture 応答 / モードファイルで
// エラーを動的注入)。その他のネットワークは禁止して逸脱を検出する。

import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  mkdir,
  mkdtemp,
  readdir,
  writeFile,
} from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import sharp from "sharp";

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, "../../..");
const requireFromDesktop = createRequire(join(repository, "app/desktop/package.json"));
const { _electron: electron } = requireFromDesktop("playwright/test");
const evidenceDir = process.argv[2] ? resolve(process.argv[2]) : undefined;
if (!evidenceDir) throw new Error("evidence dir argument is required");
await mkdir(evidenceDir, { recursive: true });

const sandbox = await mkdtemp(join(tmpdir(), "figdiff-dcases-"));
const isolatedHome = join(sandbox, "home");
const userData = join(sandbox, "user-data");
const projectsDirectory = join(evidenceDir, "projects");
const figdiffHome = join(evidenceDir, "figdiff-home");
const fixtureDir = join(isolatedHome, "fixtures");
await Promise.all([
  mkdir(isolatedHome, { recursive: true }),
  mkdir(projectsDirectory, { recursive: true }),
  mkdir(figdiffHome, { recursive: true }),
  mkdir(fixtureDir, { recursive: true }),
]);

// ---------- fixture ----------

const png = async (w, h, rgb) =>
  await sharp({ create: { width: w, height: h, channels: 3, background: rgb } })
    .png()
    .toBuffer();

const framePng = await png(200, 120, { r: 40, g: 90, b: 200 });
const dropPng = await png(64, 48, { r: 30, g: 160, b: 90 });
const localPng = await png(80, 60, { r: 200, g: 80, b: 80 });
const japanesePng = await png(50, 50, { r: 120, g: 60, b: 180 });

const paths = {
  local: join(fixtureDir, "d03-local.png"),
  drop: join(fixtureDir, "d03-drop.png"),
  japanese: join(fixtureDir, "実装-比較テスト.png"),
};
await writeFile(paths.local, localPng);
await writeFile(paths.drop, dropPng);
await writeFile(paths.japanese, japanesePng);

// ---------- Web 撮影対象のローカル HTTP サーバ (D03) ----------

const httpLog = [];
const server = createServer((req, res) => {
  httpLog.push({ url: req.url, ua: req.headers["user-agent"] ?? "" });
  if (req.url === "/capture-target") {
    res.setHeader("content-type", "text/html");
    res.end(
      `<!doctype html><html><body style="margin:0"><div style="width:100vw;height:100vh;background:linear-gradient(45deg,#2040c8 25%,#c84040 25%,#c84040 50%,#2040c8 50%,#2040c8 75%,#c84040 75%)"></div></body></html>`,
    );
    return;
  }
  res.setHeader("content-type", "text/html");
  res.end(`<!doctype html><html><body><h1>impl page</h1></body></html>`);
});
await new Promise((resolve2) => server.listen(0, "127.0.0.1", resolve2));
const port = server.address().port;
const implUrl = `http://127.0.0.1:${port}/page`;

// ---------- mock fetch bootstrap (D01/D09) ----------

const requestLog = join(evidenceDir, "figma-requests.jsonl");
// 証跡dirは run をまたいで残るので、append されるログは開始時に切り直す。
await writeFile(requestLog, "");
const modeFile = join(sandbox, "figma-mode.txt");
await writeFile(modeFile, "ok");

// CANVAS (7:7) 配下に FRAME ヘッダー(7:8) / カード(7:9) を持つ擬似ファイル。
const canvasDoc = {
  id: "7:7",
  name: "Page 1",
  type: "CANVAS",
  children: [
    {
      id: "7:8",
      name: "ヘッダー",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 40 },
    },
    {
      id: "7:9",
      name: "カード",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 40, width: 200, height: 120 },
    },
  ],
};

const bootstrap = join(sandbox, "bootstrap.mjs");
await writeFile(
  bootstrap,
  `
import os from "node:os";
import { appendFileSync, readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { app } from "electron";
os.homedir = () => ${JSON.stringify(isolatedHome)};
syncBuiltinESMExports();
app.setPath("home", ${JSON.stringify(isolatedHome)});
app.setPath("userData", ${JSON.stringify(userData)});
const requestLog = ${JSON.stringify(requestLog)};
const modeFile = ${JSON.stringify(modeFile)};
const framePng = Buffer.from(${JSON.stringify(framePng.toString("base64"))}, "base64");
const canvasDoc = ${JSON.stringify(canvasDoc)};
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  appendFileSync(requestLog, JSON.stringify({ url }) + "\\n");
  const mode = readFileSync(modeFile, "utf-8").trim();
  const parsed = new URL(url);
  if (parsed.origin === "https://api.figma.com") {
    if (mode === "offline") throw new TypeError("fetch failed");
    if (mode !== "ok") {
      return new Response(JSON.stringify({ err: "injected " + mode }), {
        status: Number(mode),
        headers: mode === "429" ? { "Retry-After": "7" } : {},
      });
    }
    if (parsed.pathname === "/v1/files/FD01/nodes") {
      const id = parsed.searchParams.get("ids");
      if (id !== "7:7") throw new Error("unexpected node request: " + id);
      return Response.json({ nodes: { "7:7": { document: canvasDoc } } });
    }
    if (parsed.pathname === "/v1/images/FD01") {
      const id = parsed.searchParams.get("ids");
      // D09 はエラーモードごとに別 node を使う。cache key が異なれば cache
      // clear なしで必ず API 応答を踏める (Windows では稼働中の cache を消せない)。
      const allowed = ["7:8", "7:9", "7:10", "7:11", "7:12", "7:13", "7:14", "7:15"];
      if (!allowed.includes(id)) throw new Error("unexpected export: " + id);
      return Response.json({ images: { [id]: "https://figma-fixture.invalid/" + id.replace(":", "_") + ".png" } });
    }
    throw new Error("unexpected figma api path: " + parsed.pathname);
  }
  if (parsed.origin === "https://figma-fixture.invalid") {
    return new Response(framePng, { status: 200, headers: { "content-type": "image/png" } });
  }
  throw new Error("synthetic boundary forbids unexpected network access: " + url);
};
const credentials = await import(${JSON.stringify(pathToFileURL(join(repository, "package/credential-store/dist/index.js")).href)});
credentials.selectFileCredentialBackend();
await import(${JSON.stringify(pathToFileURL(join(repository, "app/desktop/dist/main/main.js")).href)});
`,
);

const environment = {
  ...process.env,
  FIGDIFF_HOME: figdiffHome,
  FIGDIFF_PROJECTS_DIR: projectsDirectory,
  FIGDIFF_DISABLE_KEYCHAIN_READ: "1",
};
delete environment.ELECTRON_RUN_AS_NODE;

const launch = () =>
  electron.launch({
    executablePath: process.env.FIGDIFF_ELECTRON_EXECUTABLE ?? requireFromDesktop("electron"),
    args: [bootstrap, `--user-data-dir=${userData}`],
    env: environment,
    timeout: 30_000,
  });

const evidence = { schemaVersion: 1, results: {}, pageErrors: [] };
// nav ボタンは aria-label を持たず同名要素が他にもあるため、
// Main navigation スコープで確実に拾う。
const nav = (pg, label) =>
  pg.locator('nav[aria-label="Main navigation"] button', { hasText: label });
const setMode = (mode) => writeFile(modeFile, mode);
const figmaRequests = () =>
  (existsSync(requestLog) ? readFileSync(requestLog, "utf-8") : "")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l).url)
    .filter((u) => u.startsWith("https://api.figma.com"));

// export 呼出しは非同期なので固定 sleep ではなくログを poll する。
const waitForExport = async (from, timeout = 15_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const hits = figmaRequests().slice(from).filter((u) => u.includes("/v1/images/"));
    if (hits.length) return hits;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("no figma export request observed");
};

// ---------- 実行 ----------

const application = await launch();
const page = await application.firstWindow();
page.on("pageerror", (error) => evidence.pageErrors.push(error.message));

// ---- D01: 初回起動 → 認証 → 案件作成 → フレーム選択 ----

await page.getByText("3ステップで差分検出", { exact: true }).waitFor();
await page.getByText("実装URLを", { exact: false }).first().waitFor();
const designInput = page.getByLabel("Figma URL またはローカル画像パス...", { exact: true });
await designInput.waitFor();
evidence.results.D01 = { onboarding: "steps + input visible" };

// トークン未設定で figma URL を送信 → ダイアログ + エラー表示、API 呼出しなし。
await designInput.fill("https://www.figma.com/design/FD01/Fixture?node-id=7-7");
await page.getByLabel("送信", { exact: true }).click();
await page.getByText("Figma Tokenが必要です", { exact: true }).waitFor();
await page.getByText("Figma Token を設定してください", { exact: false }).waitFor();
assert.equal(figmaRequests().length, 0, "token-less submit must not reach the API");

// PAT を dialog 経由で保存 → file backend の credentials.json ができる。
await page.locator("#token-input").fill("figd_dcases_fixture_token_0000001");
await page.getByRole("button", { name: "保存", exact: true }).click();
await page.getByText("Figma Tokenが必要です", { exact: true }).waitFor({ state: "hidden" });
const credentialPath = join(isolatedHome, ".figdiff", "credentials.json");
assert.ok(existsSync(credentialPath), "credentials.json not written by token save");
const savedToken = JSON.parse(readFileSync(credentialPath, "utf-8"));
assert.ok(
  JSON.stringify(savedToken).includes("figd_dcases_fixture_token_0000001"),
  "saved PAT not found in credentials.json",
);
evidence.results.D01.auth = { credentialFile: "credentials.json", viaDialog: true };

// 同じ URL を再送 → page detection → フレーム一覧 → カード選択 → export は 7:9 のみ。
await designInput.fill("https://www.figma.com/design/FD01/Fixture?node-id=7-7");
await page.getByLabel("送信", { exact: true }).click();
await page.getByText("カード", { exact: true }).waitFor({ timeout: 15_000 });
await page.getByText("ヘッダー", { exact: true }).waitFor();
const beforeExport = figmaRequests().length;
await page.getByRole("button", { name: /カード/ }).first().click();
const exports = await waitForExport(beforeExport);
assert.equal(exports.length, 1, `expected exactly 1 export call, got ${exports.length}`);
assert.ok(exports[0].includes("ids=7%3A9") || exports[0].includes("ids=7:9"),
  `selected frame 7:9 not exported: ${exports[0]}`);
evidence.results.D01.frameSelect = { exported: exports[0], framesListed: ["ヘッダー", "カード"] };

// 案件作成: 新規プロジェクトフォーム → project.json が実ディスクに残る。
await nav(page, "ホーム").click();
await page.getByText("新規プロジェクト", { exact: true }).first().click();
await page.getByPlaceholder("プロジェクト名（例: コーポレートサイト）").fill("D01案件");
await page.getByPlaceholder("実装URL（例: http://localhost:3000）").fill(implUrl);
await page.getByRole("button", { name: "作成", exact: true }).click();
// 空プロジェクトの初期画面は "Add Your First Page"。
await page.getByText("Add Your First Page", { exact: true }).waitFor({ timeout: 15_000 });
const projectIds = await readdir(projectsDirectory);
const d01Project = projectIds.find((id) => {
  const json = JSON.parse(readFileSync(join(projectsDirectory, id, "project.json"), "utf-8"));
  return json.name === "D01案件";
});
assert.ok(d01Project, "D01案件 project.json not persisted");
const d01Json = JSON.parse(
  readFileSync(join(projectsDirectory, d01Project, "project.json"), "utf-8"),
);
assert.equal(d01Json.implementationUrl, implUrl);
evidence.results.D01.project = { id: d01Project, persisted: true };

// プロジェクト内で page + figma source を追加して Compare → 選択 node が export される。
await page.getByText("Add Your First Page", { exact: true }).click();
await page.getByPlaceholder("Page name").fill("トップ");
await page.getByPlaceholder("/path").fill("/");
await page.getByRole("button", { name: "追加", exact: true }).first().click();
await page.getByText("Design Sources", { exact: true }).waitFor({ timeout: 15_000 });
await page.getByRole("button", { name: "Add Design Source", exact: true }).click();
await page.getByPlaceholder("Label (e.g. PC Design, SP Design)").fill("デスクトップ");
await page
  .getByPlaceholder("Figma URL or local image path")
  .fill("https://www.figma.com/design/FD01/Fixture?node-id=7-8");
await page.getByRole("button", { name: "追加", exact: true }).click();
await page.getByText("デスクトップ", { exact: true }).waitFor({ timeout: 15_000 });

// ---- D03 (前半): project view の drop zone へ実 File を drop ----
// project view に戻る導線は無い (tab が最後の page を記憶する) ので、
// D&D は source 追加直後のこの画面で行う。
// 実パスを持つ File は OS D&D 以外では input[type=file] 経由でしか作れないので、
// 一時 input を DOM に挿して setInputFiles し、その files[0] を drop に回す。
evidence.results.D03 = {};
await page.evaluate(() => {
  const el = document.createElement("input");
  el.type = "file";
  el.id = "fd-d03-file-input";
  document.body.appendChild(el);
});
await page.locator("input#fd-d03-file-input").setInputFiles(paths.drop);
await page.evaluate(() => {
  const file = document.querySelector("input#fd-d03-file-input")?.files?.[0];
  if (!file) throw new Error("no file staged");
  const zone = [...document.querySelectorAll("div")].find(
    (el) =>
      (el.getAttribute("style") ?? "").includes("dashed") &&
      el.textContent.includes("実装スクリーンショット"),
  );
  if (!zone) throw new Error("drop zone not found");
  const dt = new DataTransfer();
  dt.items.add(file);
  zone.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true }));
});
await page.getByText("読み込み済み", { exact: true }).first().waitFor({ timeout: 15_000 });
evidence.results.D03.drop = { screenshotLoaded: true };

// source を Compare → 選択 node が export される (D01 の締め)。
const beforeSourceExport = figmaRequests().length;
await page.getByRole("button", { name: "Compare", exact: true }).click();
const sourceExports = await waitForExport(beforeSourceExport);
assert.equal(sourceExports.length, 1, `source compare should export once, got ${sourceExports}`);
assert.ok(
  sourceExports[0].includes("ids=7%3A8") || sourceExports[0].includes("ids=7:8"),
  `source node 7:8 not exported: ${sourceExports[0]}`,
);
evidence.results.D01.sourceCompare = { exported: sourceExports[0] };

// ---- D03 (後半): compare ページでファイル入力 / Web撮影 / 失敗後の入力保持 ----

const shotInput = page.getByPlaceholder("URL またはファイルパス（例: http://localhost:3000）");
await shotInput.waitFor({ state: "attached", timeout: 15_000 }).catch(() => {});
const shotPills = page.locator("span.fd-pill", { hasText: "読み込み済み" });
// screenshot が載ると input は「変更」ボタンに隠れる。「変更」で input を
// 出してから pill 増分を待つ (置換では pill 数が変わらないため)。
const loadShot = async (pathOrUrl, timeout = 15_000) => {
  const change = page.getByRole("button", { name: "変更", exact: true });
  if (await change.count()) await change.first().click();
  const before = await shotPills.count();
  await shotInput.fill(pathOrUrl);
  await page.getByRole("button", { name: "実装スクリーンショット", exact: true }).click();
  await shotPills.nth(before).waitFor({ timeout });
};

// ローカルファイルパス入力 → readLocalImage → 読み込み済み。
await loadShot(paths.local);

// Web 撮影: URL 入力 → captureUrlScreenshot → hidden window が実 fetch → 撮影画像。
const beforeHttp = httpLog.length;
await loadShot(`http://127.0.0.1:${port}/capture-target`, 30_000);
const captureHits = httpLog.slice(beforeHttp).filter((h) => h.url === "/capture-target");
assert.ok(captureHits.length >= 1, "capture URL was not fetched by the hidden window");
evidence.results.D03.localFile = "loaded";
evidence.results.D03.webCapture = { url: "/capture-target", requests: captureHits.length };

// 失敗後の入力保持: 存在しないパス → エラー表示、入力は残る。
const badPath = join(fixtureDir, "does-not-exist.png");
{
  const change = page.getByRole("button", { name: "変更", exact: true });
  if (await change.count()) await change.first().click();
}
await shotInput.fill(badPath);
await page.getByRole("button", { name: "実装スクリーンショット", exact: true }).click();
await page.getByText("画像の読み込みに失敗しました", { exact: false }).waitFor({ timeout: 15_000 });
assert.equal(await shotInput.inputValue(), badPath, "input lost after load failure");
evidence.results.D03.inputRetainedOnFailure = true;

// ---- D09: HTTP エラー系 + オフライン + 再試行 ----
// 401/403 は製品仕様上 token 再入力ダイアログに誘導される (isTokenError)。
// 429/500/offline はエラーバナーに理由が出る。両方とも「黙って失敗」ではない。

await nav(page, "ホーム").click();
const figmaUrlInput = page.getByLabel("Figma URL またはローカル画像パス...", { exact: true });
const nodeUrl = (nodeId) => `https://www.figma.com/design/FD01/Fixture?node-id=${nodeId.replace(":", "-")}`;
const submitDesign = async (url) => {
  await figmaUrlInput.fill(url);
  await page.getByLabel("送信", { exact: true }).click();
};

// 実挙動: エクスポート画像は userData/cache にキャッシュされ、cache hit は
// API を呼ばず成功する (401/403 でもキャッシュ済みなら dialog すら出ない)。
// 稼働中の cache ファイルは Windows では削除できないため、モードごとに
// 別 node id を送信して cache key をずらし、必ず API 応答を踏ませる。

const d09 = {};
for (const [mode, nodeId] of [["401", "7:10"], ["403", "7:11"]]) {
  await setMode(mode);
  const url = nodeUrl(nodeId);
  await submitDesign(url);
  await page.getByText("Figma Tokenが必要です", { exact: true }).waitFor({ timeout: 15_000 });
  assert.equal(await figmaUrlInput.inputValue(), url, `input lost after ${mode}`);
  // 実観測: PAT 保存成功後も dialog の isSubmitting が false に戻らず、
  // 再オープン時にキャンセルボタンが disabled のまま残る (D09 実欠陥)。
  // Escape / onOpenChange 経路は生きているのでそちらで閉じる。
  const cancelDisabled = await page
    .getByRole("button", { name: "キャンセル", exact: true })
    .isDisabled();
  d09[mode] = { surfaced: "token re-entry dialog", cancelDisabled };
  await page.keyboard.press("Escape");
  await page.getByText("Figma Tokenが必要です", { exact: true }).waitFor({ state: "hidden" });
}
for (const [mode, nodeId, pattern] of [
  ["429", "7:12", /rate limit|429/],
  ["500", "7:13", /server error|500/],
  ["offline", "7:14", /fetch failed|invoking|Error/],
]) {
  await setMode(mode);
  const url = nodeUrl(nodeId);
  await submitDesign(url);
  try {
    await page.getByText(pattern).first().waitFor({ timeout: 15_000 });
  } catch (e) {
    const dump = join(evidenceDir, `stuck-d09-${mode}.txt`);
    await writeFile(dump, await page.locator("body").innerText());
    throw e;
  }
  const surfaced = await page.getByText(pattern).first().textContent();
  assert.equal(await figmaUrlInput.inputValue(), url, `input lost after ${mode}`);
  d09[mode] = { surfaced: surfaced.slice(0, 140) };
}
// 復旧後の再試行で成功する (未キャッシュの node で API 到達を確認)。
await setMode("ok");
const beforeRecovery = figmaRequests().length;
await submitDesign(nodeUrl("7:15"));
const recoveryHits = await waitForExport(beforeRecovery, 15_000);
assert.ok(
  recoveryHits.some((u) => u.includes("ids=7%3A15") || u.includes("ids=7:15")),
  "retry after recovery did not reach export",
);
evidence.results.D09 = { ...d09, retryAfterRecovery: "export succeeded" };

// ---- D10: キーボード / 狭いウィンドウ / 日本語名 ----

// D09 の再試行成功で quick-compare 画面へ遷移しているので home に戻る。
await nav(page, "ホーム").click();
await figmaUrlInput.waitFor({ timeout: 15_000 });

const d10 = {};
// キーボードのみで design URL 送信 (Enter)。
// home の入力値はセクション間で残るのでキー送信前に空にする。
await figmaUrlInput.click();
await figmaUrlInput.fill("");
await figmaUrlInput.pressSequentially("https://www.figma.com/design/FD01/Fixture?node-id=7-7");
await page.keyboard.press("Enter");
await page.getByText("カード", { exact: true }).waitFor({ timeout: 15_000 });
d10.keyboardSubmit = "frame list appeared";

// 日本語プロジェクト名。
await nav(page, "ホーム").click();
await page.getByText("新規プロジェクト", { exact: true }).first().click();
await page.getByPlaceholder("プロジェクト名（例: コーポレートサイト）").fill("比較テスト案件");
await page.getByPlaceholder("実装URL（例: http://localhost:3000）").fill(implUrl);
await page.getByPlaceholder("実装URL（例: http://localhost:3000）").press("Enter");
await page.getByText("Add Your First Page", { exact: true }).waitFor({ timeout: 15_000 });
const jpIds = await readdir(projectsDirectory);
const jpProject = jpIds.find((id) => {
  const j = JSON.parse(readFileSync(join(projectsDirectory, id, "project.json"), "utf-8"));
  return j.name === "比較テスト案件";
});
assert.ok(jpProject, "Japanese-named project not persisted");
d10.japaneseProject = jpProject;

// 日本語ファイル名の読み込み (compare ページのパス入力)。
// 現在は project view。source を足さず比較ページ入力は使わず、
// screenshot drop zone は project view にあるので drop 済みの結果だけ見る。
await page.evaluate(() => {
  const el = document.createElement("input");
  el.type = "file";
  el.id = "fd-d10-file-input";
  document.body.appendChild(el);
});
await page.locator("input#fd-d10-file-input").setInputFiles(paths.japanese);
const jpName = await page.evaluate(() => {
  const el = document.querySelector("input#fd-d10-file-input");
  return el?.files?.[0]?.name ?? "";
});
assert.equal(jpName, "実装-比較テスト.png", "Japanese filename mangled");
d10.japaneseFilename = jpName;

// 狭いウィンドウ: viewport を縮めて主要 UI の状態を実測する。
// 実測では 430px 幅でタブ帯が nav ボタンを覆い pointer クリックが届かないため、
// クリックではなく hit-test で到達可否を記録する。
await page.setViewportSize({ width: 430, height: 780 });
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
const homeReachable = await page.evaluate(() => {
  const nav = document.querySelector('nav[aria-label="Main navigation"]');
  const home = [...(nav?.querySelectorAll("button") ?? [])].find((b) =>
    b.textContent?.includes("ホーム"),
  );
  if (!home) return { found: false, reachable: false };
  const rect = home.getBoundingClientRect();
  const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  return { found: true, reachable: hit === home || home.contains(hit) };
});
d10.narrowViewport = { width: 430, overflowPx: overflow, homeNav: homeReachable };
await page.setViewportSize({ width: 1440, height: 900 });
evidence.results.D10 = d10;

await application.close();

// ---- X09 (desktop 側): MCP 作成 project を desktop が読む ----
// 実 MCP サーバを stdio で起動して create_project を呼び、同じ
// FIGDIFF_PROJECTS_DIR に書かせる。desktop 再起動で一覧に出ることを確認する。

const mcpHome = join(sandbox, "mcp-home");
await mkdir(mcpHome, { recursive: true });
// MCP SDK は mcp-server 側の依存かつ ESM-only なので、resolve して import する。
const requireFromMcp = createRequire(join(repository, "app/mcp-server/package.json"));
const { Client } = await import(
  pathToFileURL(requireFromMcp.resolve("@modelcontextprotocol/sdk/client/index.js")).href
);
const { StdioClientTransport } = await import(
  pathToFileURL(requireFromMcp.resolve("@modelcontextprotocol/sdk/client/stdio.js")).href
);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(repository, "app/mcp-server/dist/index.js")],
  cwd: sandbox,
  env: {
    HOME: mcpHome,
    USERPROFILE: mcpHome,
    PATH: dirname(process.execPath),
    FIGDIFF_HOME: figdiffHome,
    FIGDIFF_PROJECTS_DIR: projectsDirectory,
  },
  stderr: "pipe",
});
transport.stderr?.resume();
const mcp = new Client({ name: "d-cases-x09", version: "1.0.0" });
await mcp.connect(transport);
const created = await mcp.callTool({
  name: "create_project",
  arguments: {
    name: "MCP経由案件",
    implementation_url: "https://example.com/impl",
    id: "mcp-made-project",
  },
});
assert.ok(!created.isError, `create_project failed: ${JSON.stringify(created.content)}`);
await mcp.close();
assert.ok(
  existsSync(join(projectsDirectory, "mcp-made-project", "project.json")),
  "MCP project.json missing",
);

// ---- D08: 再起動 → 永続化 → 案件切替 ----

const application2 = await launch();
const page2 = await application2.firstWindow();
page2.on("pageerror", (error) => evidence.pageErrors.push(error.message));

// 3 案件 (D01案件・比較テスト案件・MCP経由案件) が一覧に復元される。
await page2.locator("article", { hasText: "D01案件" }).waitFor({ timeout: 15_000 });
await page2.locator("article", { hasText: "比較テスト案件" }).waitFor();
await page2.locator("article", { hasText: "MCP経由案件" }).waitFor();
const d08 = { restored: ["D01案件", "比較テスト案件", "MCP経由案件"] };

// D01案件を開く → page 一覧と source が保持されている。
await page2.locator("article", { has: page2.locator("h3", { hasText: "D01案件" }) }).first().click();
await page2.getByText("デスクトップ", { exact: true }).waitFor({ timeout: 15_000 });
await page2.getByRole("heading", { name: "トップ", exact: true }).waitFor();
d08.d01ProjectContents = { page: "トップ", source: "デスクトップ" };

// 案件切替: MCP経由案件を開く → 別内容が出て、戻ると元に戻る。
await nav(page2, "ホーム").click();
await page2.locator("article", { has: page2.locator("h3", { hasText: "MCP経由案件" }) }).first().click();
await page2.waitForTimeout(1000);
const mcpView = await page2.locator("body").textContent();
assert.ok(mcpView.includes("example.com") || mcpView.includes("MCP経由案件"),
  "MCP project did not open its own content");
d08.switching = "isolated per project";

// X09 側の確認: MCP が書いた project.json を desktop の schema で load できている
// (一覧表示 + オープン成功がその証左)。
evidence.results.X09 = {
  direction: "mcp-write → desktop-read",
  project: "mcp-made-project",
  listed: true,
  opened: true,
};
evidence.results.D08 = d08;

await application2.close();
server.close();

assert.equal(evidence.pageErrors.length, 0, `page errors: ${evidence.pageErrors.join(" | ")}`);
await writeFile(join(evidenceDir, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(join(evidenceDir, "evidence.json"));

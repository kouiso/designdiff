// desktop D-case 検証 driver — 実 Electron UI を駆動して D01/D03/D08/D09/D10
// と X09 (desktop 側: MCP が作った project.json を desktop が読む) を検証する。
//
// oracle は FigDiff 自身の status ではなく、実 fetch リクエストログ・
// ディスク上の project.json / credentials.json・DOM 状態・canvas の
// 寸法/画素照合による独立画像観測。
//
// fetch 境界は合成済み (api.figma.com → fixture 応答 / モードファイルで
// エラーを動的注入)。main fetch 以外の通信は session.webRequest で
// 別ログに全件記録し、両ログの union に allowlist を適用する。

import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
// projects / figdiff-home は証跡dir配下で run をまたいで残る。同一dirへの
// 再実行で「案件0件」assertや固定 id の MCP 案件が前回分と衝突するので空にする。
// ただし前回 run のマーカー (証跡ファイル) が無い dir を無条件に消すと、
// evidenceDir の打ち間違いで他人のデータを消し得るため、マーカー確認付きにする。
const isPriorRunDir =
  existsSync(join(evidenceDir, "figma-requests.jsonl")) ||
  existsSync(join(evidenceDir, "evidence.json"));
if (isPriorRunDir) {
  await rm(projectsDirectory, { recursive: true, force: true });
  await rm(figdiffHome, { recursive: true, force: true });
}
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
// mock 内の throw (想定外の node/path/ホスト) は main process 側で起きるため
// pageerror では拾えない。別ログに記録して末尾で空を assert する。
const errorLog = join(evidenceDir, "boundary-errors.jsonl");
// fetch mock は main process の fetch だけを見る。renderer / hidden window /
// Electron net.request など Chromium 経由の通信は session.webRequest で
// 別ログに全件記録し、末尾で両ログの union に allowlist を適用する。
const networkLog = join(evidenceDir, "network-requests.jsonl");
// 計測された session の一覧。defaultSession 以外 (partition 指定の
// BrowserWindow / net.request) は defaultSession の webRequest では
// 見えないため、session-created ごとに記録して数を証跡へ出す。
const sessionLog = join(evidenceDir, "network-sessions.jsonl");
// 証跡dirは run をまたいで残るので、append されるログは開始時に切り直す。
await writeFile(requestLog, "");
await writeFile(errorLog, "");
await writeFile(networkLog, "");
await writeFile(sessionLog, "");
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

// 単一 frame だけを持つ CANVAS。frames.length===1 の auto-load 分岐を踏む。
const singleCanvasDoc = {
  id: "7:20",
  name: "Single Page",
  type: "CANVAS",
  children: [
    {
      id: "7:21",
      name: "唯一のフレーム",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 120, height: 80 },
    },
  ],
};

// D10 キーボード送信専用の CANVAS。7:7 とは別物にすることで、frame 一覧が
// 前段の残り表示ではなく今回の送信で出たことを node id で区別できる。
const keyboardCanvasDoc = {
  id: "7:30",
  name: "Keyboard Page",
  type: "CANVAS",
  children: [
    {
      id: "7:31",
      name: "キーボード枠A",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 40 },
    },
    {
      id: "7:32",
      name: "キーボード枠B",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 40, width: 100, height: 60 },
    },
  ],
};

// エラー注入と再試行用の node。CANVAS 以外の正常応答を返し、
// tryPageDetection の nodeType!==CANVAS 分岐を例外経由ではなくクリーンに通す。
const exportableNodeIds = [
  "7:8", "7:9", "7:10", "7:11", "7:12", "7:13", "7:14", "7:15", "7:16", "7:21",
];

const bootstrap = join(sandbox, "bootstrap.mjs");
await writeFile(
  bootstrap,
  `
import os from "node:os";
import { appendFileSync, readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { app, session } from "electron";
os.homedir = () => ${JSON.stringify(isolatedHome)};
syncBuiltinESMExports();
app.setPath("home", ${JSON.stringify(isolatedHome)});
app.setPath("userData", ${JSON.stringify(userData)});
const requestLog = ${JSON.stringify(requestLog)};
const networkLog = ${JSON.stringify(networkLog)};
const sessionLog = ${JSON.stringify(sessionLog)};
const modeFile = ${JSON.stringify(modeFile)};
// driver 側でwriteする mode と完全一致させる。truncate 中の空文字や
// 将来の typo mode が境界エラーログを無効化するのを防ぐ。
const KNOWN_MODES = ["ok","offline","401","403","429","500"];
const framePng = Buffer.from(${JSON.stringify(framePng.toString("base64"))}, "base64");
const canvasDoc = ${JSON.stringify(canvasDoc)};
const singleCanvasDoc = ${JSON.stringify(singleCanvasDoc)};
const keyboardCanvasDoc = ${JSON.stringify(keyboardCanvasDoc)};
const exportableNodeIds = ${JSON.stringify(exportableNodeIds)};
const errorLog = ${JSON.stringify(errorLog)};
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  // ts 必須: tokenless 期間の「遅れて届いた dispatch」は index ではなく
  // 時刻比較でしか検出できない (index は append 位置に過ぎない)。
  appendFileSync(requestLog, JSON.stringify({ url, ts: Date.now() }) + "\\n");
  // catch 内で modeFile を再読すると、try 中に setMode が走った場合に
  // 境界違反を「意図的な注入」と誤分類して捨てる。try 前に確定させる。
  let mode = "ok";
  try {
    mode = readFileSync(modeFile, "utf-8").trim();
    if (!KNOWN_MODES.includes(mode)) {
      // truncate 中の空読みや typo mode は「意図した注入」ではない。
      // 違反として記録した上で ok 扱いにし、ログ無効化を起こさない。
      appendFileSync(
        errorLog,
        JSON.stringify({ url, error: "unknown mode " + JSON.stringify(mode) }) + "\\n",
      );
      mode = "ok";
    }
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
        if (id === "7:7") return Response.json({ nodes: { "7:7": { document: canvasDoc } } });
        if (id === "7:20") return Response.json({ nodes: { "7:20": { document: singleCanvasDoc } } });
        if (id === "7:30") return Response.json({ nodes: { "7:30": { document: keyboardCanvasDoc } } });
        if (exportableNodeIds.includes(id)) {
          return Response.json({ nodes: { [id]: { document: {
            id,
            name: "Synthetic Frame " + id,
            type: "FRAME",
            absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
          } } } });
        }
        throw new Error("unexpected node request: " + id);
      }
      if (parsed.pathname === "/v1/images/FD01") {
        const id = parsed.searchParams.get("ids");
        // D09 はエラーモードごとに別 node を使う。cache key が異なれば cache
        // clear なしで必ず API 応答を踏める (Windows では稼働中の cache を消せない)。
        if (!exportableNodeIds.includes(id)) throw new Error("unexpected export: " + id);
        return Response.json({ images: { [id]: "https://figma-fixture.invalid/" + id.replace(":", "_") + ".png" } });
      }
      throw new Error("unexpected figma api path: " + parsed.pathname);
    }
    if (parsed.origin === "https://figma-fixture.invalid") {
      return new Response(framePng, { status: 200, headers: { "content-type": "image/png" } });
    }
    throw new Error("synthetic boundary forbids unexpected network access: " + url);
  } catch (e) {
    // エラーモード注入による意図的な throw (offline の TypeError 等) は
    // 境界違反ではない。try 突入時に確定した mode で判定する。
    if (mode === "ok") {
      appendFileSync(errorLog, JSON.stringify({ url, error: String(e) }) + "\\n");
    }
    throw e;
  }
};
// fetch 以外のチャネル (renderer・hidden window・net.request) は
// Chromium net stack を通るため webRequest で全件捕捉する。
// http/https だけ記録し、file/data/blob/devtools は対象外。
// defaultSession 以外の session (partition 指定 window / net.request) は
// defaultSession の webRequest に出ないため、session-created でも同じ
// 計測を仕掛け、session 一覧を証跡に残す。
const instrumentSession = (s) => {
  try {
    appendFileSync(sessionLog, JSON.stringify({ id: s?.storagePath ?? "unknown" }) + "\\n");
  } catch {}
  s.webRequest.onBeforeRequest((details, callback) => {
    try {
      const u = new URL(details.url);
      // ws/wss も onBeforeRequest に来る。http 系だけ拾うと WebSocket 経由の
      // 外部通信が境界から見えなくなるため含める。
      if (["http:", "https:", "ws:", "wss:"].includes(u.protocol)) {
        appendFileSync(networkLog, JSON.stringify({ url: details.url }) + "\\n");
      }
    } catch {}
    callback({});
  });
};
app.whenReady().then(() => {
  instrumentSession(session.defaultSession);
  app.on("session-created", instrumentSession);
});
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

// completed は末尾まで到達した時だけ true にする。fatal で途中落ちした
// evidence.json は results が部分的に埋まったまま残るため、台帳取込側が
// 「全項 PASS」に見えないよう完走マーカーで区別する。
const evidence = { schemaVersion: 1, completed: false, results: {}, pageErrors: [] };
// assert 失敗や予期せぬ throw でも部分証跡が残るよう、exit 時に必ず書き出す。
// 成功時も同じ内容が上書きされるだけなので二重書きは問題ない。
process.on("exit", () => {
  try {
    writeFileSync(
      join(evidenceDir, "evidence.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
  } catch {
    // 証跡の書き出し自体の失敗はこれ以上追えないので握る。
  }
});
const fatal = (err) => {
  evidence.fatalError = String(err?.stack ?? err);
  process.exit(1);
};
process.on("unhandledRejection", fatal);
process.on("uncaughtException", fatal);

// nav ボタンは aria-label を持たず同名要素が他にもあるため、
// Main navigation スコープで確実に拾う。
const nav = (pg, label) =>
  pg.locator('nav[aria-label="Main navigation"] button', { hasText: label });
// writeFile は truncate してから書くため、mock が読む瞬間に空文字を
// 返し得る。temp + rename で原子的に差し替える (読み手は常に完全な
// mode か古い mode のどちらかを見る)。
const setMode = async (mode) => {
  const tmp = `${modeFile}.tmp`;
  await writeFile(tmp, mode);
  await rename(tmp, modeFile);
};
const allLoggedRequests = () =>
  (existsSync(requestLog) ? readFileSync(requestLog, "utf-8") : "")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l).url);
const figmaRequests = () =>
  allLoggedRequests().filter((u) => u.startsWith("https://api.figma.com"));

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

// 初 hit で即 return すると「1件だけ export される」assert が
// 2件目未到着の瞬間を捉えて誤 pass し得る。settle 窓後に読み直す。
const waitForExportSettled = async (from, settleMs = 1500, timeout = 15_000) => {
  await waitForExport(from, timeout);
  await new Promise((r) => setTimeout(r, settleMs));
  return figmaRequests().slice(from).filter((u) => u.includes("/v1/images/"));
};

// 否定 assert (「API に届いていない」「ディスクに書かれていない」) も同じ
// race を持つ。ダイアログ描画後に IPC→fetch→appendFileSync が遅れて
// 着地する可能性があるため、観測の直前に同じ settle 窓を置く。
const settle = (ms = 1500) => new Promise((r) => setTimeout(r, ms));

// ---------- 実行 ----------

const application = await launch();
// firstWindow 解決後に pageerror を貼ると初期 module 評価中の throw を
// 逃す。window event で早期に仕掛け、後から作られる hidden capture
// window の pageerror も同じ証跡に拾う。
// window event は「これから作られる window」にしか発火しないので、
// launch 解決時点で既に存在する window は sweep で補完する。
const watchPageErrors = (() => {
  const seen = new Set();
  return (app) => {
    const watch = (w) => {
      if (seen.has(w)) return;
      seen.add(w);
      w.on("pageerror", (error) => evidence.pageErrors.push(error.message));
    };
    app.on("window", watch);
    for (const w of app.windows()) watch(w);
  };
})();
watchPageErrors(application);
const page = await application.firstWindow();

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
// ダイアログ描画→IPC→fetch→ログappend は非同期なので、描画直後の 0 件は
// 「まだ届いていない」だけかもしれない。settle 後に読む。
await settle();
assert.equal(figmaRequests().length, 0, "token-less submit must not reach the API");

// もう1系統の token check: handleCreateProject 内の designUrl チェック。
// name+implUrl 必須ガードを先に通す必要があるため、作成フォームを開いて
// 両方を埋めてから「作成」を押す (designUrl は前段の入力が state に残る)。
await page.keyboard.press("Escape");
await page.getByText("Figma Tokenが必要です", { exact: true }).waitFor({ state: "hidden" });
await page.getByText("新規プロジェクト", { exact: true }).first().click();
await page.getByPlaceholder("プロジェクト名（例: コーポレートサイト）").fill("未作成テスト");
await page.getByPlaceholder("実装URL（例: http://localhost:3000）").fill(implUrl);
await page.getByRole("button", { name: "作成", exact: true }).click();
await page.getByText("Figma Tokenが必要です", { exact: true }).waitFor({ timeout: 15_000 });
await settle();
assert.equal(figmaRequests().length, 0, "token-less create must not reach the API");
assert.equal(
  (await readdir(projectsDirectory)).length,
  0,
  "project created despite missing token",
);
evidence.results.D01.tokenlessPaths = ["quickCompareSubmit", "createProjectForm"];

// tokenless 期間の境界時刻: PAT 保存操作の直前に取る。ログ行の ts は
// append 時刻なので「dispatch 時刻」ではないが、境界を期間の最後尾
// (PAT 保存 = token が存在し始める瞬間) に置けば、遅れて着地した
// dispatch も ts < 境界 で必ず捕捉できる。期間途中に境界を置くと
// 境界以降の着地を取りこぼす。
const tokenlessPhaseEndTs = Date.now();

// PAT を dialog 経由で保存 → file backend の credentials.json ができる。
await page.locator("#token-input").fill("figd_dcases_fixture_token_0000001");
await page.getByRole("button", { name: "保存", exact: true }).click();
await page.getByText("Figma Tokenが必要です", { exact: true }).waitFor({ state: "hidden" });

// implUrl が残っていると navigateAfterLoad が live_overlay へ分岐するので空に戻し、
// 作成フォームは開いたまま残るのでキャンセルで閉じる。
await page.getByPlaceholder("実装URL（任意、例: http://localhost:3000）").fill("");
await page.getByRole("button", { name: "キャンセル", exact: true }).click();
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
const exports = await waitForExportSettled(beforeExport, 1500);
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
// drop の観測は page-wide の「読み込み済み」では拾えない — design 側にも
// 同じ文言が出得るため .first() が既存 pill で即解決し、drop が no-op に
// 退行しても pass してしまう。drop zone 内の表示に限定して観測する。
const shotZoneLoaded = () =>
  page.evaluate(() => {
    const zone = [...document.querySelectorAll("div")].find(
      (el) =>
        (el.getAttribute("style") ?? "").includes("dashed") &&
        el.textContent.includes("実装スクリーンショット"),
    );
    if (!zone) return null;
    return [...zone.querySelectorAll("p")].some((p) =>
      p.textContent.includes("読み込み済み"),
    );
  });
assert.equal(await shotZoneLoaded(), false, "screenshot slot already loaded before drop");
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
await page.waitForFunction(
  () => {
    const zone = [...document.querySelectorAll("div")].find(
      (el) =>
        (el.getAttribute("style") ?? "").includes("dashed") &&
        el.textContent.includes("実装スクリーンショット"),
    );
    return (
      zone !== undefined &&
      [...zone.querySelectorAll("p")].some((p) => p.textContent.includes("読み込み済み"))
    );
  },
  { timeout: 15_000, polling: 200 },
);
evidence.results.D03.drop = { screenshotLoaded: true, via: "scoped zone text" };
// 後続の画面計測に混入しないよう、一時 input は役目を終えたら除去する。
await page.evaluate(() => document.querySelector("input#fd-d03-file-input")?.remove());

// source を Compare → 選択 node が export される (D01 の締め)。
const beforeSourceExport = figmaRequests().length;
await page.getByRole("button", { name: "Compare", exact: true }).click();
const sourceExports = await waitForExportSettled(beforeSourceExport, 1500);
assert.equal(sourceExports.length, 1, `source compare should export once, got ${sourceExports}`);
assert.ok(
  sourceExports[0].includes("ids=7%3A8") || sourceExports[0].includes("ids=7:8"),
  `source node 7:8 not exported: ${sourceExports[0]}`,
);
evidence.results.D01.sourceCompare = { exported: sourceExports[0] };

// ---- D03 (後半): compare ページでファイル入力 / Web撮影 / 失敗後の入力保持 ----

const shotInput = page.getByPlaceholder("URL またはファイルパス（例: http://localhost:3000）");
await shotInput.waitFor({ state: "attached", timeout: 15_000 }).catch(() => {});
// 「読み込み済み」pill は design 側にも同じ文言があるため page-wide では拾えない。
// 「実装スクリーンショット」label の sibling に限定して screenshot slot のみを見る。
// pill 有無で sibling button は「変更」/ upload に切り替わる。
const shotLabelXpath = '//span[normalize-space(.)="実装スクリーンショット"]';
const shotPill = page
  .locator(`${shotLabelXpath}/following-sibling::span[contains(@class,"fd-pill")]`)
  .last();
// sibling button は pill 有無で「変更」/ upload に切り替わる。名前なし
// .last() だと将来 button が増えた時に別ボタンを踏んで detach/attach が
// 通ってしまうため、各状態の文言/aria-label で確実に区別する。
const shotChange = page
  .locator(`${shotLabelXpath}/following-sibling::button[contains(normalize-space(.),"変更")]`)
  .last();
const shotUpload = page
  .locator(`${shotLabelXpath}/following-sibling::button[@aria-label="実装スクリーンショット"]`)
  .last();
// screenshot が載ると input は「変更」ボタンに隠れる。「変更」で input を
// 出してから scoped pill の出現を待つ (増分カウントだと design pill を誤検知する)。
// 「変更」後に pill の detached を待たないと、旧 pill が残ったまま
// waitFor(attached) が即解決して「今回の load が成功した」証左にならない。
const loadShot = async (pathOrUrl, timeout = 15_000) => {
  if (await shotPill.count()) {
    await shotChange.click();
    await shotPill.waitFor({ state: "detached", timeout });
  }
  await shotInput.fill(pathOrUrl);
  await shotUpload.click();
  await shotPill.waitFor({ state: "attached", timeout });
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
if (await shotPill.count()) {
  await shotChange.click();
  await shotPill.waitFor({ state: "detached", timeout: 15_000 });
}
await shotInput.fill(badPath);
await shotUpload.click();
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
// エラーモードでも「API に実際に届いた」ことを node id 付きで境界 assert する。
// UI 文言だけだと cache hit や stale バナーで誤 pass し得るため。
const assertApiHit = (before, nodeId, label) => {
  const encoded = nodeId.replace(":", "%3A");
  const hits = figmaRequests()
    .slice(before)
    .filter((u) => u.includes(`ids=${nodeId}`) || u.includes(`ids=${encoded}`));
  assert.ok(hits.length >= 1, `${label}: no API request reached for ${nodeId}`);
  return hits;
};
for (const [mode, nodeId] of [["401", "7:10"], ["403", "7:11"]]) {
  await setMode(mode);
  const url = nodeUrl(nodeId);
  const beforeErr = figmaRequests().length;
  await submitDesign(url);
  await page.getByText("Figma Tokenが必要です", { exact: true }).waitFor({ timeout: 15_000 });
  assertApiHit(beforeErr, nodeId, mode);
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
// matcher は数字を含めない。ephemeral port を含む URL 文字列が画面に
// 出ていると /500/ や /429/ が案件カード側の文言に誤マッチし得るため。
for (const [mode, nodeId, pattern] of [
  ["429", "7:12", /rate limit/],
  ["500", "7:13", /server error/],
  ["offline", "7:14", /fetch failed/],
]) {
  await setMode(mode);
  const url = nodeUrl(nodeId);
  const beforeErr = figmaRequests().length;
  await submitDesign(url);
  try {
    await page.getByText(pattern).first().waitFor({ timeout: 15_000 });
  } catch (e) {
    const dump = join(evidenceDir, `stuck-d09-${mode}.txt`);
    await writeFile(dump, await page.locator("body").innerText());
    throw e;
  }
  assertApiHit(beforeErr, nodeId, mode);
  const surfaced = await page.getByText(pattern).first().textContent();
  assert.equal(await figmaUrlInput.inputValue(), url, `input lost after ${mode}`);
  d09[mode] = { surfaced: surfaced.slice(0, 140) };
}
// 復旧後の再試行で成功する (未キャッシュの node で API 到達を確認)。
await setMode("ok");
const beforeRecovery = figmaRequests().length;
await submitDesign(nodeUrl("7:15"));
const recoveryHits = await waitForExportSettled(beforeRecovery, 1500, 15_000);
assert.ok(
  recoveryHits.some((u) => u.includes("ids=7%3A15") || u.includes("ids=7:15")),
  "retry after recovery did not reach export",
);

// 同一 URL の再試行: 500 で失敗した 7:16 を mode 復帰後にそのまま再送する。
// 失敗した export は cache されないので、同じ URL の再送が実ユーザーの自然な操作になる。
await nav(page, "ホーム").click();
await setMode("500");
const retryUrl = nodeUrl("7:16");
// 7:13 の 500 banner が画面に残ったままだと、次の waitFor が stale 要素で
// 即解決して「7:16 の失敗が表示された」証左にならない。消えるまで待つ。
await page.getByText(/server error/).first().waitFor({ state: "hidden", timeout: 15_000 });
const beforeFailedRetry = figmaRequests().length;
await submitDesign(retryUrl);
await page.getByText(/server error/).first().waitFor({ timeout: 15_000 });
assertApiHit(beforeFailedRetry, "7:16", "500-retry");
assert.equal(await figmaUrlInput.inputValue(), retryUrl, "input lost before same-URL retry");
await setMode("ok");
const beforeRetry = figmaRequests().length;
await submitDesign(retryUrl);
const retryHits = await waitForExportSettled(beforeRetry, 1500, 15_000);
assert.ok(
  retryHits.some((u) => u.includes("ids=7%3A16") || u.includes("ids=7:16")),
  "same-URL retry did not reach export",
);
d09.sameUrlRetry = { node: "7:16", exported: retryHits[0] };

// 単一 frame の page (7:20) は一覧を出さず直接 load される (frames.length===1 分岐)。
await nav(page, "ホーム").click();
const beforeSingle = figmaRequests().length;
await submitDesign(nodeUrl("7:20"));
const singleHits = await waitForExportSettled(beforeSingle, 1500, 15_000);
assert.ok(
  singleHits.some((u) => u.includes("ids=7%3A21") || u.includes("ids=7:21")),
  "single-frame page did not auto-export 7:21",
);
evidence.results.D01.singleFrameAutoLoad = singleHits[0];

evidence.results.D09 = { ...d09, retryAfterRecovery: "export succeeded" };

// ---- D10: キーボード / 狭いウィンドウ / 日本語名 ----

// D09 の再試行成功で quick-compare 画面へ遷移しているので home に戻る。
await nav(page, "ホーム").click();
await figmaUrlInput.waitFor({ timeout: 15_000 });

const d10 = {};
// キーボードのみで design URL 送信 (Enter)。hero 側入力は DesignInput と同じ
// designUrl state に繋がる別コントロールで、Enter は handleLauncherSubmit
// (implUrl 空なら handleLegacySubmit に委譲) を通る — こちらの経路を踏む。
// hero 入力は aria-label を持たない (DesignInput 側は持つ) ので :not で確実に区別。
const heroInput = page.locator(
  'input[placeholder="Figma URL またはローカル画像パス..."]:not([aria-label])',
);
await heroInput.click();
await heroInput.fill("");
// 専用 node 7:30 を使い、frame 一覧が前段 (7:7) の残り表示と区別できるようにする。
const beforeKb = figmaRequests().length;
await heroInput.pressSequentially("https://www.figma.com/design/FD01/Fixture?node-id=7-30");
await page.keyboard.press("Enter");
await page.getByText("キーボード枠B", { exact: true }).waitFor({ timeout: 15_000 });
assertApiHit(beforeKb, "7:30", "keyboardSubmit");
d10.keyboardSubmit = "frame list appeared via hero input (node 7:30)";

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

// 狭いウィンドウの計測は「比較」画面で行う (header/tab は全画面共通だが文脈を残す)。
await nav(page, "比較").click();
// nav click 直後に resize→計測すると遷移前の画面を「compare」として
// 誤記し得る。compare の DOM マーカーを待ってから viewport を縮める。
await page
  .getByText("実装スクリーンショット", { exact: true })
  .first()
  .waitFor({ timeout: 15_000 });

// 狭いウィンドウ: viewport を縮めて主要 UI の状態を実測する。
// 実測では 430px 幅でタブ帯が nav ボタンを覆い pointer クリックが届かないため、
// クリックではなく hit-test で到達可否を記録する。
await page.setViewportSize({ width: 430, height: 780 });
// marker・overflow・犯人要素・hit-test を1回の evaluate で取る — 画面遷移や
// 再レイアウトが計測間に挟まると別画面の値が混ざるため。
const narrow = await page.evaluate(() => {
  const limit = document.documentElement.clientWidth;
  const body = document.body.innerText;
  const view = body.includes("実装スクリーンショット")
    ? "compare"
    : body.includes("Add Your First Page")
      ? "project"
      : "other";
  // overflow 犯人候補: display:none で消えてる要素は bounding が 0 だが、
  // visibility:hidden / transform で画面外に飛ばされた要素は大きいまま
  // 残り「犯人」に見えるため、実際に描画領域と交差するものだけ拾う。
  const offenders = [...document.querySelectorAll("body *")]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return (
        r.width > 0 &&
        r.height > 0 &&
        r.right > limit + 1 &&
        style.visibility !== "hidden" &&
        style.display !== "none"
      );
    })
    .slice(0, 6)
    .map((el) => {
      const r = el.getBoundingClientRect();
      const cls = typeof el.className === "string" ? el.className.slice(0, 50) : "";
      return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""} right=${Math.round(r.right)}`;
    });
  const nav = document.querySelector('nav[aria-label="Main navigation"]');
  const home = [...(nav?.querySelectorAll("button") ?? [])].find((b) =>
    b.textContent?.includes("ホーム"),
  );
  let homeNav = { found: false, reachable: false };
  if (home) {
    const rect = home.getBoundingClientRect();
    const hit = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    homeNav = { found: true, reachable: hit === home || home.contains(hit) };
  }
  return {
    width: 430,
    view,
    overflowPx: document.documentElement.scrollWidth - limit,
    overflowElements: offenders,
    homeNav,
  };
});
d10.narrowViewport = narrow;
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
watchPageErrors(application2);
const page2 = await application2.firstWindow();

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

// 日本語ファイル名 (D10 属性だが、寸法 oracle のため空の compare store が
// 必要なのでこの process で行う): compare ページの実パス入力で
// readLocalImage まで通し、screenshot のみが載った canvas の寸法が
// fixture 固有の 50x50 になることを照合する。pill だけでは
// 「日本語名で実ファイルが解決できた」ことも「この画像が載った」ことも
// 区別できないため、寸法を独立 oracle にする。
await nav(page2, "比較").click();
const shotLabelXpath2 = '//span[normalize-space(.)="実装スクリーンショット"]';
const shotPill2 = page2
  .locator(`${shotLabelXpath2}/following-sibling::span[contains(@class,"fd-pill")]`)
  .last();
await page2
  .getByPlaceholder("URL またはファイルパス（例: http://localhost:3000）")
  .fill(paths.japanese);
await page2
  .locator(`${shotLabelXpath2}/following-sibling::button[@aria-label="実装スクリーンショット"]`)
  .last()
  .click();
await shotPill2.waitFor({ state: "attached", timeout: 15_000 });
// 比較ページには複数の canvas が並び得るため「最初の canvas」ではなく
// fixture 固有寸法の canvas が現れるまで待ち、全 canvas を列挙して照合する。
await page2.waitForFunction(
  () => [...document.querySelectorAll("canvas")].some(
    (c) => c.width === 50 && c.height === 50,
  ),
  { timeout: 15_000, polling: 200 },
);
const japaneseCanvases = await page2.evaluate(() =>
  [...document.querySelectorAll("canvas")].map((c) => ({ width: c.width, height: c.height })));
assert.ok(
  japaneseCanvases.some((c) => c.width === 50 && c.height === 50),
  `japanese-named file did not produce its fixture-sized canvas: ${JSON.stringify(japaneseCanvases)}`,
);
d10.japaneseFilename = {
  loaded: "実装-比較テスト.png",
  canvas: "50x50",
  canvases: japaneseCanvases,
  via: "shotInput path",
};

// D01案件の project view へ戻って positive control へ進む。
// nav「比較」はアクティブだった D01 tab 自体を compare へ切替えたため、
// article click では記憶済みの compare が再表示される。閉じて開き直す。
await nav(page2, "ホーム").click();
await page2.locator('span[aria-label="D01案件 を閉じる"]').click();
await page2.locator("article", { has: page2.locator("h3", { hasText: "D01案件" }) }).first().click();
await page2.getByText("デスクトップ", { exact: true }).waitFor({ timeout: 15_000 });

// positive control: この process で design 画像を compare store に載せる。
// 比較未実行のまま切替後を計っても 0/0 は「正しい」と「stale 不可視」の
// 区別が付かないため、まず D01案件の source を Compare して載せる。
const designPill2 = page2.locator(
  '//span[normalize-space(.)="デザイン画像（Figma）"]/following-sibling::span[contains(@class,"fd-pill")]',
);
const beforeD08Export = figmaRequests().length;
await page2.getByRole("button", { name: "Compare", exact: true }).click();
await designPill2.waitFor({ state: "attached", timeout: 15_000 });
// canvas は画像 load 後に描かれる。先に載っている screenshot (50x50) や
// 別用途の canvas と混同しないよう、fixture 寸法の canvas を列挙して待つ。
// (非アクティブ window では RAF poll が回らないことがあるため ms polling)
await page2.waitForFunction(
  () => [...document.querySelectorAll("canvas")].some(
    (c) => c.width === 200 && c.height === 120,
  ),
  { timeout: 15_000, polling: 200 },
);
const compareControl = await page2.evaluate(() => {
  const canvases = [...document.querySelectorAll("canvas")].map((c) => ({
    width: c.width,
    height: c.height,
  }));
  return { canvasCount: canvases.length, canvases };
});
// design fixture は 200x120。幅だけだと「何か描かれた」までしか分からず、
// 寸法照合で「この fixture が載った」ことまで結び付ける。最初の canvas では
// なく全列挙で照合する (別寸法の canvas が先に並ぶことがある)。
assert.ok(
  compareControl.canvases.some((c) => c.width === 200 && c.height === 120),
  `positive control failed: design fixture not on compare canvas ${JSON.stringify(compareControl)}`,
);
// source の画像は永続化済みパス or image cache から読まれることがあるため、
// ここで API 再発行を assert すると誤検知になる。pill+canvas が実証の oracle。
const d08ExportHits = figmaRequests()
  .slice(beforeD08Export)
  .filter((u) => u.includes("ids=7%3A8") || u.includes("ids=7:8"));
d08.comparePositiveControl = { ...compareControl, apiHitsForSource: d08ExportHits.length };

// 案件切替: MCP経由案件を開く → 空の案件内容が出ることを実画面で確認する。
// (一覧の article タイトルにも案件名は出るため、画面遷移の確証は空状態表示で取る)
await nav(page2, "ホーム").click();
await page2.locator("article", { has: page2.locator("h3", { hasText: "MCP経由案件" }) }).first().click();
await page2.getByText("Add Your First Page", { exact: true }).waitFor({ timeout: 15_000 });
const mcpView = await page2.locator("body").textContent();
assert.ok(
  !mcpView.includes("デスクトップ"),
  "D01 source contents leaked into MCP project view",
);

// design 画像を載せた直後に別案件の「比較」を開いた時の状態を観測する。
// compare store は共通のため、前案件の画像が残る実挙動があり得る — 記録して台帳へ渡す。
await nav(page2, "比較").click();
// 観測の罠: c.width>0 は未描画の既定 300x150 canvas でも真で、最初の
// canvas は crop selector かもしれず、「読み込み済み」pill は driver が
// 直前に載せた screenshot 側にも出る。fixture 固有寸法 (200x120) の
// canvas が現れるまで待ち、全 canvas 列挙＋その canvas の中央画素照合＋
// design label sibling 限定の pill で観測する。
await page2
  .waitForFunction(
    () =>
      [...document.querySelectorAll("canvas")].some(
        (c) => c.width === 200 && c.height === 120,
      ),
    { timeout: 10_000, polling: 200 },
  )
  .catch(() => {});
await settle(1500);
const compareAfterSwitch = await page2.evaluate(() => {
  const designLabel = [...document.querySelectorAll("span")].find(
    (s) => s.textContent.trim() === "デザイン画像（Figma）",
  );
  const out = {
    canvases: [...document.querySelectorAll("canvas")].map((c) => ({
      width: c.width,
      height: c.height,
    })),
    fixtureCanvas: null,
    centerPixel: null,
    matchesFixture: false,
    designPill: false,
  };
  // design slot の pill は label の sibling に限定する。page-wide だと
  // この compare 画面で driver が載せた screenshot pill を拾って
  // 「design が残っている」証拠が汚染される。
  if (designLabel?.parentElement) {
    out.designPill = [...designLabel.parentElement.querySelectorAll("span.fd-pill")].some(
      (s) => s.textContent.includes("読み込み済み"),
    );
  }
  // RGBA の alpha だけでは不透明な空状態と実画像を区別できない。
  // fixture 寸法の canvas を特定して fixture 色 (40,90,200) との距離を
  // 中央で測り、「D01 の画像が残っている」か「空状態」かを分ける。
  const fixture = [...document.querySelectorAll("canvas")].find(
    (c) => c.width === 200 && c.height === 120,
  );
  if (fixture) {
    out.fixtureCanvas = "200x120";
    const ctx = fixture.getContext("2d");
    if (ctx) {
      const x = Math.floor(fixture.width / 2);
      const y = Math.floor(fixture.height / 2);
      const d = ctx.getImageData(x, y, 1, 1).data;
      out.centerPixel = [d[0], d[1], d[2]];
      const dist = Math.abs(d[0] - 40) + Math.abs(d[1] - 90) + Math.abs(d[2] - 200);
      out.matchesFixture = dist < 60;
    }
  }
  return out;
});
d08.compareAfterProjectSwitch = compareAfterSwitch;

// D01案件へ戻ると元の内容が復元される (往復で切替の実効性を確認)。
// tab は最後に見た page を記憶するため、positive control の Compare 後は
// compare 画面で開き直される。tab を一度閉じて開き直すと page:"project_view"
// の新規 tab になり、project view が確実に出る。
await nav(page2, "ホーム").click();
await page2.locator('span[aria-label="D01案件 を閉じる"]').click();
await page2.locator("article", { has: page2.locator("h3", { hasText: "D01案件" }) }).first().click();
await page2.getByText("デスクトップ", { exact: true }).waitFor({ timeout: 15_000 });
// tab 切替ではなく tab close→再オープンでの復元確認 (tab は最後の page を
// 記憶するため、切替だけでは project view に戻らない)。
d08.switching = "close-and-reopen round-trip verified";

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

// 合成境界の検証: main fetch ログと Chromium webRequest ログは許可先が
// 異なるため union ではなく別々に照合する。mock は main の fetch だけなので、
// renderer / hidden window / net.request から本物の api.figma.com に出たら
// chromium 側の allowlist (撮影サーバのみ) で必ず境界違反になる。
const readUrlLog = (path) =>
  (existsSync(path) ? readFileSync(path, "utf-8") : "")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l).url);
const allRequests = readUrlLog(requestLog);
const chromiumRequests = readUrlLog(networkLog);
// host (hostname:port) で照合する — 撮影対象サーバはこの run が
// listen した port のみ許可し、別 port の loopback 通信は境界違反として残す。
const allowedMainHosts = [
  "api.figma.com",
  "figma-fixture.invalid",
  `127.0.0.1:${port}`,
];
const allowedChromiumHosts = [`127.0.0.1:${port}`];
const offBoundary = [
  ...allRequests.filter((u) => !allowedMainHosts.includes(new URL(u).host)),
  ...chromiumRequests.filter((u) => !allowedChromiumHosts.includes(new URL(u).host)),
];
assert.deepEqual(offBoundary, [], `off-boundary requests: ${offBoundary.join(", ")}`);
// instrumentation が無言で外れていても networkLog が空なら「クリーン」に
// 見えてしまう。撮影 URL が必ず webRequest に記録されていることと、
// partition session が session-created で捕捉されていることを positive
// control として assert する。
assert.ok(
  chromiumRequests.some((u) => new URL(u).host === `127.0.0.1:${port}`),
  `capture request missing from webRequest log (instrumentation dead?): ${JSON.stringify(chromiumRequests)}`,
);
const sessionsObserved = (existsSync(sessionLog) ? readFileSync(sessionLog, "utf-8") : "")
  .split("\n")
  .filter(Boolean).length;
assert.ok(
  sessionsObserved >= 2,
  `expected >=2 sessions (default + capture partition), got ${sessionsObserved}`,
);
const boundaryThrows = (existsSync(errorLog) ? readFileSync(errorLog, "utf-8") : "").trim();
assert.equal(boundaryThrows, "", `synthetic boundary throws: ${boundaryThrows}`);
// tokenless 期間 (tokenlessPhaseEndTs 以前の時刻) に figma リクエストが
// 一件も無いことを全ログで再確認する。ログ行は append 位置でしかないため
// index 比較は同義語反復になる — 行内の ts と時刻で比較する。
const tokenlessEntries = (existsSync(requestLog) ? readFileSync(requestLog, "utf-8") : "")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));
const leakedDuringTokenless = tokenlessEntries.filter(
  (entry) => typeof entry.ts === "number" &&
    entry.ts < tokenlessPhaseEndTs &&
    entry.url.startsWith("https://api.figma.com"),
);
assert.equal(
  leakedDuringTokenless.length,
  0,
  `figma request logged during tokenless phase: ${JSON.stringify(leakedDuringTokenless)}`,
);
// 計測値をそのまま残す (assert 通過後は空が確定だが、定数でなく実値を記録)。
evidence.networkBoundary = {
  mainFetchRequests: allRequests.length,
  chromiumRequests: chromiumRequests.length,
  sessionsObserved,
  offBoundary,
  unexpectedThrows: boundaryThrows === "" ? 0 : boundaryThrows.split("\n").length,
  tokenlessPhaseEndTs,
};

// 実挙動として観測した製品欠陥。assert はせず証跡として台帳へ渡す。
// 値は固定文ではなくこの run の観測から生成する (再現しなければ載せない)。
// observed はこの run で実測した値だけ、hypothesis は原因の推測 — 分離して
// おかないと台帳が推測を実測として引用する。
const knownDefects = [];
if (d09["401"]?.cancelDisabled || d09["403"]?.cancelDisabled) {
  knownDefects.push({
    id: "token-dialog-cancel-stuck",
    detail: "PAT 保存成功後に TokenRequiredDialog を再オープンするとキャンセルボタンが disabled のまま残る (Escape/onOpenChange 経路は生存)",
    observedIn: "D09.401/403.cancelDisabled",
    observed: {
      "401": d09["401"]?.cancelDisabled,
      "403": d09["403"]?.cancelDisabled,
    },
    hypothesis: "dialog の isSubmitting が保存成功後に false へ戻らない可能性",
  });
}
// 案件を跨いだ compare 状態リーク: 807行のテキストリークは hard assert で
// run を落とすのに、画像+pill の残存を注記だけにすると台帳に出ない。
// 同じ観測ルールで knownDefects へ載せる (block 化は製品判断)。
if (
  d08.compareAfterProjectSwitch?.designPill ||
  d08.compareAfterProjectSwitch?.matchesFixture
) {
  knownDefects.push({
    id: "compare-store-shared-across-projects",
    detail: "design 画像を載せた直後に別案件の「比較」を開くと、前案件の画像+pill がそのまま残る",
    observedIn: "D08.compareAfterProjectSwitch",
    observed: d08.compareAfterProjectSwitch,
    hypothesis: "compare store が案件非依存で共有されている可能性",
  });
}
if (
  (d10.narrowViewport?.overflowPx ?? 0) > 0 ||
  d10.narrowViewport?.homeNav?.reachable === false
) {
  knownDefects.push({
    id: "narrow-viewport-overflow",
    detail: "430px viewport で横 overflow が発生する",
    observedIn: "D10.narrowViewport",
    observed: {
      overflowPx: d10.narrowViewport?.overflowPx,
      homeNavReachable: d10.narrowViewport?.homeNav?.reachable,
      view: d10.narrowViewport?.view,
      overflowElements: d10.narrowViewport?.overflowElements,
    },
    hypothesis: "タブ帯が nav ボタンを覆い click point を遮断し得る (過去 run で一度観測)",
  });
}
evidence.knownDefects = knownDefects;

assert.equal(evidence.pageErrors.length, 0, `page errors: ${evidence.pageErrors.join(" | ")}`);
evidence.completed = true;
await writeFile(join(evidenceDir, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(join(evidenceDir, "evidence.json"));

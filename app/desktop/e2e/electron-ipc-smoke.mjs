// Electron 起動 + IPC 経路のスモーク。実 Electron を Playwright で起ち上げ、
// ウィンドウ生成を確認したうえで preload 経由の IPC を最低1本ずつ通す:
//   - project save → list → load → delete (プロジェクト経路)
//   - token save → get → delete (設定/資格情報経路, file バックエンド)
//   - file:read-local-image (比較入力の画像読み出し経路)
// 重い UI 操作は desktop-c-cases.mjs が担う。ここでは「配布物として
// 起動して IPC が生きているか」だけを早く確かめる。
// 実行には dist/ が必要。Linux では xvfb-run 経由で起動する。

import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, "../../..");
const requireFromDesktop = createRequire(join(repository, "app/desktop/package.json"));
const { _electron: electron } = requireFromDesktop("playwright/test");
const requireSharp = createRequire(join(repository, "app/mcp-server/package.json"));
const sharp = requireSharp("sharp");

const evidenceDir = process.argv[2] ? resolve(process.argv[2]) : undefined;
if (!evidenceDir) throw new Error("evidence dir argument is required");
await mkdir(evidenceDir, { recursive: true });

const sandbox = await mkdtemp(join(tmpdir(), "figdiff-ipc-smoke-"));
const isolatedHome = join(sandbox, "home");
const userData = join(sandbox, "user-data");
const figdiffHome = join(sandbox, "figdiff-home");
const projectsDirectory = join(sandbox, "projects");
const fixtureDir = join(isolatedHome, "fixtures");
await mkdir(isolatedHome, { recursive: true });
await mkdir(userData, { recursive: true });
await mkdir(figdiffHome, { recursive: true });
await mkdir(projectsDirectory, { recursive: true });
await mkdir(fixtureDir, { recursive: true });

// 画像読み出し経路の検体。実 PNG を生成して file:read-local-image に通す。
const fixturePng = join(fixtureDir, "smoke.png");
await sharp({
  create: { width: 4, height: 4, channels: 3, background: { r: 24, g: 169, b: 87 } },
})
  .png()
  .toFile(fixturePng);

// c-cases と同じ隔離ブートストラップ。home/userData/資格情報 backend を
// 砂箱に向け、本物の dist/main/main.js を読む。
const bootstrap = join(sandbox, "bootstrap.mjs");
await writeFile(
  bootstrap,
  `
import os from "node:os";
import { syncBuiltinESMExports } from "node:module";
import { app } from "electron";
os.homedir = () => ${JSON.stringify(isolatedHome)};
syncBuiltinESMExports();
app.setPath("home", ${JSON.stringify(isolatedHome)});
app.setPath("userData", ${JSON.stringify(userData)});
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

const evidence = { schemaVersion: 1, results: {}, errors: [] };
const pageErrors = [];
let application;
try {
  application = await electron.launch({
    executablePath: process.env.FIGDIFF_ELECTRON_EXECUTABLE ?? requireFromDesktop("electron"),
    args: [bootstrap, `--user-data-dir=${userData}`],
    env: environment,
    timeout: 30_000,
  });

  const page = await application.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  await page.waitForLoadState("domcontentloaded");
  const title = await page.title();
  assert.ok(await page.locator("body").count(), "window body must exist");
  evidence.results.window = { title, bodyRendered: true };

  const api = await page.evaluate(() => typeof window.electronAPI);
  assert.equal(api, "object", "preload must expose window.electronAPI");
  evidence.results.preload = { electronAPI: api };

  // --- project IPC 往復 ---
  const project = {
    id: "ipc-smoke",
    name: "IPC smoke",
    implementationUrl: "http://localhost:3000",
    pages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const roundTrip = await page.evaluate(async (p) => {
    await window.electronAPI.project.save(p);
    const list = await window.electronAPI.project.list();
    const loaded = await window.electronAPI.project.load(p.id);
    await window.electronAPI.project.delete(p.id);
    const afterDelete = await window.electronAPI.project.list();
    return {
      listed: list.some((item) => item.id === p.id),
      loadedName: loaded?.name ?? null,
      deleted: !afterDelete.some((item) => item.id === p.id),
    };
  }, project);
  assert.equal(roundTrip.listed, true, "saved project must appear in project:list");
  assert.equal(roundTrip.loadedName, "IPC smoke", "project:load must return the saved project");
  assert.equal(roundTrip.deleted, true, "deleted project must leave project:list");
  evidence.results.project = roundTrip;

  // --- token IPC 往復 (file バックエンドに向けた資格情報保存経路) ---
  const token = await page.evaluate(async () => {
    // savePat は figd_ 接頭辞つきの印字可能文字列しか受け付けない
    await window.electronAPI.saveFigmaToken("figd_ipc_smoke_not_a_real_token");
    const read = await window.electronAPI.getFigmaToken();
    await window.electronAPI.deleteFigmaToken();
    const afterDelete = await window.electronAPI.getFigmaToken();
    return { read, deleted: afterDelete === null };
  });
  assert.equal(token.read, "figd_ipc_smoke_not_a_real_token", "token must round-trip via IPC");
  assert.equal(token.deleted, true, "token must be deleted");
  evidence.results.token = { roundTrip: true, cleared: true };

  // --- 画像読み出し IPC (比較入力経路) ---
  const image = await page.evaluate(async (path) => {
    const result = await window.electronAPI.readLocalImage(path);
    return result;
  }, fixturePng);
  const imageString = typeof image === "string" ? image : JSON.stringify(image);
  assert.ok(imageString.length > 0, "read-local-image must return image payload");
  evidence.results.image = { bytes: imageString.length };

  assert.deepEqual(pageErrors, [], "renderer must not raise page errors");
  await writeFile(join(evidenceDir, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  console.info(
    JSON.stringify({ ok: true, evidence: evidenceDir, checks: Object.keys(evidence.results) }),
  );
} catch (error) {
  evidence.errors.push(String(error?.stack ?? error));
  await writeFile(join(evidenceDir, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  throw error;
} finally {
  // darwin では window-all-closed でも app が終了しない (macOS 流儀)。そのうえ
  // close() 自体が応答しない環境もあるので、段階的に畳む: app.quit() を試み、
  // だめなら close() に時限をかけ、最後は子プロセスを直接 kill する。
  // 検証が終わった後の後始末で CI を timeout に沈めないため。
  if (application) {
    const proc = application.process();
    try {
      await Promise.race([
        application.evaluate(({ app }) => app.quit()),
        new Promise((resolve) => setTimeout(resolve, 10_000)),
      ]);
      await Promise.race([
        application.close(),
        new Promise((resolve) => setTimeout(resolve, 10_000)),
      ]);
    } catch {
      // 終了競合の例外は後始末上は無視する
    } finally {
      if (proc.exitCode === null && !proc.killed) {
        proc.kill("SIGKILL");
      }
    }
  }
}

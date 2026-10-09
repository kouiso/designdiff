// Electron 起動 + IPC 経路のスモーク。実 Electron を Playwright で起ち上げ、
// ウィンドウ生成を確認したうえで preload 経由の IPC を最低1本ずつ通す:
//   - project save → list → load → delete (プロジェクト経路)
//   - token save → get → delete (設定/資格情報経路, file バックエンド)
//   - file:read-local-image (比較入力の画像読み出し経路)
//   - compare 画面を UI 駆動で通す比較 (同一ペアと既知欠陥ペアの2回)
// 重い UI 操作は desktop-c-cases.mjs が担う。ここでは「配布物として
// 起動して IPC が生きていて、比較が1回通るか」だけを早く確かめる。
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

// 比較経路の検体。期待値は製品の出力ではなく、ここでの作図から決める。
// 背景と既存ブロックはベタ塗りにし、欠陥矩形は既存ブロックから離して置く。
// こうすると欠陥の全画素が「周囲に同色が3画素以上ある」状態になり、
// pixelmatch の anti-alias 判定に掛からず、差分画素数が矩形の面積と一致する。
const COMPARE_W = 64;
const COMPARE_H = 48;
const COMPARE_BACKGROUND = [240, 240, 240, 255];
const COMPARE_BLOCK = { x: 4, y: 4, w: 16, h: 12, color: [30, 90, 200, 255] };
const COMPARE_DEFECT = { x: 36, y: 24, w: 12, h: 8, color: [0, 0, 0, 255] };
const inRect = (rect, x, y) =>
  x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
const comparePaint = (withDefect) => (x, y) => {
  if (withDefect && inRect(COMPARE_DEFECT, x, y)) return COMPARE_DEFECT.color;
  if (inRect(COMPARE_BLOCK, x, y)) return COMPARE_BLOCK.color;
  return COMPARE_BACKGROUND;
};
const writeComparePng = async (name, paint) => {
  const raw = Buffer.alloc(COMPARE_W * COMPARE_H * 4);
  for (let y = 0; y < COMPARE_H; y++) {
    for (let x = 0; x < COMPARE_W; x++) {
      raw.set(paint(x, y), (y * COMPARE_W + x) * 4);
    }
  }
  const path = join(fixtureDir, name);
  await sharp(raw, { raw: { width: COMPARE_W, height: COMPARE_H, channels: 4 } })
    .png()
    .toFile(path);
  return path;
};
const compareDesignPng = await writeComparePng("compare-design.png", comparePaint(false));
const compareIdenticalPng = await writeComparePng("compare-identical.png", comparePaint(false));
const compareDefectPng = await writeComparePng("compare-defect.png", comparePaint(true));
const defectArea = COMPARE_DEFECT.w * COMPARE_DEFECT.h;
// matchRate は FigDiff 自身の採点なので合否には使わない (AGENTS.md の
// self-certification 禁止)。合否は作図で決まる画素数と矩形だけで判定する。
const expectedCompare = {
  identical: { diffPixels: 0, diffRegions: 0, coloredBox: null, colored: 0 },
  defect: {
    diffPixels: defectArea,
    diffRegions: 1,
    colored: defectArea,
    coloredBox: {
      x: COMPARE_DEFECT.x,
      y: COMPARE_DEFECT.y,
      w: COMPARE_DEFECT.w,
      h: COMPARE_DEFECT.h,
    },
  },
};

// compare 画面へは案件 → デザインソース → Compare の実 UI で入る。
// 案件は起動前に projects dir へ置き、project:list 経由でホームに出させる。
const COMPARE_PROJECT = { id: "compare-smoke", name: "Compare smoke" };
const COMPARE_SOURCE_LABEL = "Smoke design";
await mkdir(join(projectsDirectory, COMPARE_PROJECT.id), { recursive: true });
await writeFile(
  join(projectsDirectory, COMPARE_PROJECT.id, "project.json"),
  JSON.stringify({
    ...COMPARE_PROJECT,
    implementationUrl: "http://localhost:3000",
    pages: [
      {
        id: "p1",
        name: "Page",
        path: "/",
        designSources: [
          {
            id: "smoke-design",
            type: "local_image",
            label: COMPARE_SOURCE_LABEL,
            filePath: compareDesignPng,
          },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  }),
);

// 差分画像は pixelmatch が一致画素を灰色 (r=g=b)、不一致を有彩色で描く。
// 有彩色画素の数と外接矩形を数え、欠陥の位置が作図どおりかを製品の数値とは
// 別に確かめる。
const measureDiffImage = async (dataUrl) => {
  const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl ?? "");
  if (!match) throw new Error(`diff image must be a PNG data URL: ${String(dataUrl).slice(0, 40)}`);
  const { data, info } = await sharp(Buffer.from(match[1], "base64"))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let colored = 0;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      if (data[i] === data[i + 1] && data[i + 1] === data[i + 2]) continue;
      colored++;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return {
    width: info.width,
    height: info.height,
    colored,
    coloredBox: colored ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null,
  };
};

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

  // --- 比較 (renderer の compareImages を compare 画面の実操作で通す) ---
  // 比較は renderer 内で完結し、bundle 済みの関数は外から呼べない。製品経路を
  // 外さないよう、ユーザーと同じ画面操作で流して DOM の結果を読む。
  const report = page.locator('[data-testid="compare-diff-report"]');
  const screenshotInput = page.getByPlaceholder(
    "URL またはファイルパス（例: http://localhost:3000）",
  );
  // 採取の失敗で元の比較エラーを上書きしないよう、採取側の例外は証跡へ積むだけにする。
  const dumpStuck = async (name) => {
    try {
      await page.screenshot({ path: join(evidenceDir, `${name}.png`) });
      await writeFile(join(evidenceDir, `${name}.html`), await page.content());
    } catch (dumpError) {
      evidence.errors.push(`failure dump failed: ${String(dumpError?.stack ?? dumpError)}`);
    }
  };
  const loadScreenshot = async (path) => {
    // 一度読み込むと入力欄は隠れて「変更」ボタンに置き換わる。
    const change = page.getByRole("button", { name: "変更", exact: true });
    if (await change.count()) await change.click();
    await screenshotInput.fill(path);
    await page.getByRole("button", { name: "実装スクリーンショット", exact: true }).click();
    // design 側にも「読み込み済み」pill が常にあるので、2個目の出現を待つ。
    await page.locator("span.fd-pill", { hasText: "読み込み済み" }).nth(1).waitFor();
  };
  const runCompare = async (expectedPath) => {
    const before = (await report.count()) ? await report.innerText() : null;
    const run = page.getByRole("button", { name: "差分を検出", exact: true });
    await run.waitFor({ state: "visible" });
    assert.ok(await run.isEnabled(), "差分を検出 must be enabled");
    await run.click();
    if (before !== null) {
      // 前回の結果が残ったまま読むと、比較が走っていなくても通ってしまう。
      await page.waitForFunction(
        (previous) => {
          const element = document.querySelector('[data-testid="compare-diff-report"]');
          return element !== null && element.innerText !== previous;
        },
        before,
        { timeout: 30_000 },
      );
    }
    await report.waitFor({ timeout: 30_000 });
    const text = await report.innerText();
    const read = (pattern, label) => {
      const found = pattern.exec(text);
      if (!found) throw new Error(`${label} missing in compare report: ${text.slice(0, 400)}`);
      return Number(found[1]);
    };
    const diffImage = await measureDiffImage(
      await report.locator('img[src^="data:image/"]').first().getAttribute("src"),
    );
    return {
      screenshot: expectedPath,
      diffRegions: read(/diffRegions:\s*(\d+)/, "diffRegions"),
      diffPixels: read(/diffPixels:\s*(\d+)/, "diffPixels"),
      diffImage,
      // 失敗時の切り分け用に残すだけで、assertCompare では見ない。
      matchRateDiagnostic: read(/matchRate:\s*([\d.]+)%/, "matchRate"),
    };
  };
  const assertCompare = (label, actual, expected) => {
    assert.equal(actual.diffImage.width, COMPARE_W, `${label}: diff image width`);
    assert.equal(actual.diffImage.height, COMPARE_H, `${label}: diff image height`);
    assert.equal(actual.diffImage.colored, expected.colored, `${label}: diff image pixels`);
    assert.deepEqual(actual.diffImage.coloredBox, expected.coloredBox, `${label}: diff image box`);
    assert.equal(actual.diffPixels, expected.diffPixels, `${label}: diffPixels`);
    assert.equal(actual.diffRegions, expected.diffRegions, `${label}: diffRegions`);
  };

  try {
    await page
      .locator("article", { has: page.locator("h3", { hasText: COMPARE_PROJECT.name }) })
      .first()
      .click();
    const sourceCard = page.locator("article", { hasText: COMPARE_SOURCE_LABEL });
    await sourceCard.waitFor({ timeout: 15_000 });
    await sourceCard.getByRole("button", { name: "Compare" }).click();
    await screenshotInput.waitFor({ timeout: 15_000 });

    await loadScreenshot(compareIdenticalPng);
    const identical = await runCompare(compareIdenticalPng);
    evidence.results.compareIdentical = identical;
    assertCompare("identical pair", identical, expectedCompare.identical);

    await loadScreenshot(compareDefectPng);
    const defect = await runCompare(compareDefectPng);
    evidence.results.compareDefect = { ...defect, expected: expectedCompare.defect };
    assertCompare("known-defect pair", defect, expectedCompare.defect);
  } catch (error) {
    await dumpStuck("compare-failure");
    throw error;
  }

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

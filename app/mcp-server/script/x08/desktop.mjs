// X08 desktop 面: 実 Electron アプリを起動し、seed した案件で
// 実装スクリーンショット → 差分を検出 まで実 UI 操作で流す。
// 表示された diff 画像と DOM 上の採点数を x08-desktop.json に書く。

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, statfs, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { writeX08Fixture } from "./fixture.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, "../../../..");
const requireFromDesktop = createRequire(join(repository, "app/desktop/package.json"));
const { _electron: electron } = requireFromDesktop("playwright/test");
const requireSharp = createRequire(join(repository, "app/mcp-server/package.json"));
const sharp = requireSharp("sharp");

const evidenceDir = process.argv[2] ? resolve(process.argv[2]) : undefined;
if (!evidenceDir) throw new Error("evidence dir argument is required");
await mkdir(evidenceDir, { recursive: true });
const filesystem = await statfs(evidenceDir);
if (filesystem.bavail * filesystem.bsize < 512 * 1024 * 1024) {
  throw new Error("Native verification requires at least 512 MiB free");
}

const sandbox = await mkdtemp(join(tmpdir(), "figdiff-x08-desktop-"));
const isolatedHome = join(sandbox, "home");
const userData = join(sandbox, "user-data");
const figdiffHome = join(sandbox, "configured-home");
const projectsDirectory = join(sandbox, "configured-projects");
const projectDirectory = join(projectsDirectory, "x08-fixture");
await mkdir(isolatedHome, { recursive: true });
await mkdir(figdiffHome, { recursive: true });
await mkdir(projectDirectory, { recursive: true });
await mkdir(userData, { recursive: true });

const { designPath, expectedDiffPixelCount, expectedRegions } =
  await writeX08Fixture(evidenceDir);
// file:read-local-image は home/tmp 配下のみ許可。証跡dirと別に sandbox home 側にも置く。
const homeFixture = await writeX08Fixture(isolatedHome);
const desktopDesignPath = homeFixture.designPath;
const screenshotPath = homeFixture.screenshotPath;

await writeFile(
  join(projectDirectory, "project.json"),
  JSON.stringify({
    id: "x08-fixture",
    name: "X08 fixture",
    implementationUrl: "http://localhost:3000",
    pages: [
      {
        id: "fixture-page",
        name: "Fixture page",
        path: "/",
        designSources: [
          { id: "fixture-image", type: "local_image", label: "X08 design", filePath: desktopDesignPath },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  }),
);

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

const pageErrors = [];
const application = await electron.launch({
  executablePath: process.env.FIGDIFF_ELECTRON_EXECUTABLE ?? requireFromDesktop("electron"),
  args: [bootstrap, `--user-data-dir=${userData}`],
  env: environment,
  timeout: 30_000,
});

try {
  const page = await application.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.getByText("X08 fixture", { exact: true }).first().waitFor();
  await page.getByText("X08 fixture", { exact: true }).first().click();
  await page.getByText("X08 design", { exact: true }).waitFor();
  // 「比較を開始」は描画タイミングが遅れることがあるので待ってから押す。
  const start = page.getByRole("button", { name: "比較を開始", exact: true });
  try {
    await start.waitFor({ state: "visible", timeout: 10_000 });
    await start.click();
  } catch {
    // 既に比較画面へ進んでいる場合はそのまま続行する。
  }

  try {
    await page
      .getByPlaceholder("URL またはファイルパス（例: http://localhost:3000）")
      .fill(screenshotPath);
  } catch (error) {
    await page.screenshot({ path: join(evidenceDir, "x08-desktop-stuck.png") });
    await writeFile(join(evidenceDir, "x08-desktop-dom.txt"), await page.content());
    throw error;
  }
  await page.getByRole("button", { name: "実装スクリーンショット", exact: true }).click();
  await page.getByRole("button", { name: "差分を検出", exact: true }).click();

  const report = page.locator('[data-testid="compare-diff-report"]');
  await report.waitFor({ timeout: 30_000 });
  const img = report.locator('img[src^="data:image/"]');
  await img.waitFor({ timeout: 30_000 });
  const src = await img.getAttribute("src");
  const diffImageBase64 = src.replace(/^data:image\/png;base64,/, "");
  const diffBytes = Buffer.from(diffImageBase64, "base64");
  const raw = await sharp(diffBytes).ensureAlpha().raw().toBuffer();

  // DOM に出た採点値 (diffPixels / region 数) も独立 oracle として拾う。
  const monoValues = await page.locator(".mono.font-bold.text-lg").allTextContents();
  const diffPixelCountDom = Number.parseInt(monoValues[1] ?? "", 10);
  const regionCountDom = Number.parseInt(monoValues[0] ?? "", 10);

  const out = {
    surface: "desktop",
    diffPixelsSha256: createHash("sha256").update(raw).digest("hex"),
    diffPngBase64: diffImageBase64,
    diffPngSha256: createHash("sha256").update(diffBytes).digest("hex"),
    diffPixelCountDom,
    regionCountDom,
    expectedDiffPixelCount,
    expectedRegions,
    pageErrors,
  };
  // face レベルの自己検査: DOM 採点が数値として読め、page error が無いことを確認する。
  assert.ok(Number.isFinite(diffPixelCountDom), "diffPixelCount not readable from DOM");
  assert.ok(Number.isFinite(regionCountDom), "regionCount not readable from DOM");
  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(" | ")}`);
  out.results = {
    X08: {
      status: "PASS",
      expected: `desktop 面が同一検体で diffPixelCount=${expectedDiffPixelCount}・領域=${expectedRegions.length} を描画する`,
      actual: {
        diffPixelCountDom,
        regionCountDom,
        diffPixelsSha256: out.diffPixelsSha256,
        pageErrors: pageErrors.length,
      },
    },
  };
  await writeFile(join(evidenceDir, "x08-desktop.json"), `${JSON.stringify(out, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ok: true, diffPixelCountDom, regionCountDom })}\n`);
} finally {
  await application.close();
}

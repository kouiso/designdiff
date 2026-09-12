        views: ["home", "project", "compare", "measured", ...(!before ? ["convergence"] : [])],
  if (!before) {
    await page.getByRole("navigation", { name: "Main navigation" }).getByText("収束", { exact: true }).click();
    await expect(page.getByText("design.png · review-alpha", { exact: true })).toHaveCount(2);
    await page.screenshot({ path: join(evidence, "after-convergence.png"), animations: "disabled" });
  }
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { _electron as electron, expect } from "playwright/test";
import sharp from "sharp";

import { ConvergenceHistorySchema, scopeComparisonCampaign } from "@figdiff/shared";

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, "../../..");
const evidence = process.env.FIGDIFF_SCORE_EVIDENCE;
if (!evidence) throw new Error("FIGDIFF_SCORE_EVIDENCE is required");
const before = process.argv.includes("--before");
await mkdir(evidence, { recursive: true });
// Electron の一時プロファイルと描画キャッシュ用の余裕。容量不足を検証成功として扱わない。
const minimumFreeBytes = 512 * 1024 * 1024;
const filesystem = await statfs(evidence);
const freeBytes = filesystem.bavail * filesystem.bsize;
if (freeBytes < minimumFreeBytes) {
  throw new Error(
    `Native verification requires at least 512 MiB free before launch; available ${Math.floor(freeBytes / 1024 / 1024)} MiB`,
  );
}
const sandbox = await mkdtemp(join(evidence, "native-score-"));
const isolatedHome = join(sandbox, "home");
const userData = join(sandbox, "user-data");
const projectDirectory = join(isolatedHome, ".figdiff/projects/score-fixture");
await mkdir(projectDirectory, { recursive: true });
await mkdir(userData, { recursive: true });
const designPath = join(isolatedHome, "design.png");
await sharp({ create: { width: 96, height: 96, channels: 4, background: "#f0f0f0" } })
  .png()
  .toFile(designPath);
await writeFile(
  join(projectDirectory, "project.json"),
  JSON.stringify({
    id: "score-fixture",
    name: "Unmeasured score fixture",
    implementationUrl: "http://localhost:3000",
    pages: [{
      id: "fixture-page",
      name: "Fixture page",
      path: "/",
      designSources: [{ id: "fixture-image", type: "local_image", label: "Fixture design", filePath: designPath }],
    }],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  }),
);
const convergenceDirectory = join(isolatedHome, ".figdiff/convergence");
await mkdir(convergenceDirectory, { recursive: true });
const campaignKey = scopeComparisonCampaign(`local:${designPath}`, "review-alpha");
await writeFile(join(convergenceDirectory, "fixture.json"), JSON.stringify(ConvergenceHistorySchema.parse({
  sourceKey: campaignKey,
  campaigns: [{
    campaignId: "fixture-history",
    sourceKey: campaignKey,
    designSource: designPath,
    startedAt: 1000,
    updatedAt: 1000,
    endedAt: 1000,
    iterations: [{ comparisonId: "fixture-iteration", matchRate: 50, regionCount: 1, status: "UNCERTAIN", structuralVerdict: "inconclusive", timestamp: 1000 }],
  }],
})));

// OS と Electron の保存先を隔離し、既存の認証情報へ触れずに本物の main/preload を起動する。
const bootstrap = join(sandbox, "bootstrap.mjs");
const require = createRequire(import.meta.url);
await writeFile(bootstrap, `
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
`);
const environment = { ...process.env, FIGDIFF_HOME: join(isolatedHome, ".figdiff"), FIGDIFF_CONVERGENCE_DIR: convergenceDirectory, FIGDIFF_DISABLE_KEYCHAIN_READ: "1" };
delete environment.ELECTRON_RUN_AS_NODE;
const application = await electron.launch({
  executablePath: process.env.FIGDIFF_ELECTRON_EXECUTABLE ?? require("electron"),
  args: [bootstrap, `--user-data-dir=${userData}`],
  env: environment,
  timeout: 30000,
});
const errors = [];
try {
  const page = await application.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.getByText("Unmeasured score fixture", { exact: true })).toBeVisible();
  assert.equal(await page.evaluate(() => typeof window.electronAPI?.project?.list), "function");
  const checkScore = async (name, count) => {
    const values = page.getByTestId("score-ring-value");
    await expect(values).toHaveCount(count);
    await values.first().scrollIntoViewIfNeeded();
    for (let index = 0; index < count; index++) {
      await expect(values.nth(index)).toBeVisible();
      await expect(values.nth(index)).toHaveText(before ? "0" : "—");
      const color = await values.nth(index).evaluate((element) => element.style.color.replaceAll(" ", ""));
      assert.equal(color, before ? "var(--diff)" : "var(--muted-fg)");
    }
    if (!before) await expect(page.getByRole("img", { name: "未実行", exact: true })).toHaveCount(count);
    await page.screenshot({ path: join(evidence, `${before ? "before" : "after"}-${name}.png`), animations: "disabled" });
  };
  await checkScore("home", 1);
  await page.getByText("Unmeasured score fixture", { exact: true }).click();
  await expect(page.getByText("Fixture design", { exact: true })).toBeVisible();
  await checkScore("project", 2);
  await page.getByRole("button", { name: "比較を開始", exact: true }).click();
  await expect(page.getByText("デザインと実装を比較", { exact: true })).toBeVisible();
  const compareValue = page.getByTestId("score-ring-value");
  await expect(compareValue).toHaveText(before ? "0" : "—");
  if (!before) await expect(page.getByTestId("compare-score-verdict-badge")).toHaveCount(0);
  await page.screenshot({ path: join(evidence, `${before ? "before" : "after"}-compare.png`), animations: "disabled" });
  await page.getByPlaceholder("URL またはファイルパス（例: http://localhost:3000）").fill(designPath);
  await page.getByRole("button", { name: "実装スクリーンショット", exact: true }).click();
  await page.getByRole("button", { name: "差分を検出", exact: true }).click();
  await expect(page.getByText("RegionScore Summary", { exact: true })).toBeVisible();
  await expect(compareValue).toHaveText(/^[0-9]+$/);
  if (!before) await expect(compareValue).not.toHaveText("—");
  await expect(page.getByTestId("compare-score-verdict-badge")).toBeVisible();
  await page.screenshot({ path: join(evidence, `${before ? "before" : "after"}-measured.png`), animations: "disabled" });
  if (!before) {
    await page.getByRole("navigation", { name: "Main navigation" }).getByText("収束", { exact: true }).click();
    await expect(page.getByText("design.png · review-alpha", { exact: true })).toHaveCount(2);
    await page.screenshot({ path: join(evidence, "after-convergence.png"), animations: "disabled" });
  }
  assert.deepEqual(errors, []);
  await writeFile(join(evidence, `${before ? "before" : "after"}-native.json`), JSON.stringify({ native: true, preload: true, views: ["home", "project", "compare", "measured", ...(!before ? ["convergence"] : [])], errors, sandbox }, null, 2));
} finally {
  await application.close();
}

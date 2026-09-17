import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  statfs,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { _electron as electron, expect } from "playwright/test";
import sharp from "sharp";

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, "../../..");
const require = createRequire(import.meta.url);
const sharedRequire = createRequire(join(repository, "package/shared/package.json"));
const { parse: parseYaml } = sharedRequire("yaml");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const collectFiles = async (root) => {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(path)));
    else files.push(path);
  }
  return files;
};
const buildRoots = [
  join(repository, "app/desktop/dist"),
  join(repository, "package/shared/dist"),
  join(repository, "package/credential-store/dist"),
];
const buildIdentityFiles = [
  join(repository, "pnpm-lock.yaml"),
  join(repository, "package.json"),
  join(repository, "app/desktop/package.json"),
  join(repository, "package/shared/package.json"),
  join(repository, "package/credential-store/package.json"),
];
const captureBuild = async () => {
  const paths = [
    ...(await Promise.all(buildRoots.map(collectFiles))).flat(),
    ...buildIdentityFiles,
  ].sort();
  const files = await Promise.all(
    paths.map(async (path) => ({
      path: path.slice(repository.length + 1),
      size: (await stat(path)).size,
      sha256: sha256(await readFile(path)),
    })),
  );
  return {
    roots: buildRoots.map((path) => path.slice(repository.length + 1)),
    identityFiles: buildIdentityFiles.map((path) => path.slice(repository.length + 1)),
    fileCount: files.length,
    sha256: sha256(
      Buffer.from(files.map((file) => `${file.path}\0${file.size}\0${file.sha256}`).join("\n")),
    ),
    files,
  };
};
const evidence = resolve(process.env.FIGDIFF_IGNORE_EVIDENCE ?? "");
if (!process.env.FIGDIFF_IGNORE_EVIDENCE) throw new Error("FIGDIFF_IGNORE_EVIDENCE is required");
await mkdir(evidence, { recursive: true });
const filesystem = await statfs(evidence);
if (filesystem.bavail * filesystem.bsize < 512 * 1024 * 1024) {
  throw new Error("Native verification requires at least 512 MiB free before launch");
}
const startedAt = new Date().toISOString();
const buildAtStart = await captureBuild();
const revision = execFileSync("/usr/bin/git", ["rev-parse", "HEAD"], {
  cwd: repository,
  encoding: "utf8",
}).trim();
const dirtyState = execFileSync("/usr/bin/git", ["status", "--porcelain=v1"], {
  cwd: repository,
  encoding: "utf8",
})
  .trimEnd()
  .split("\n")
  .filter(Boolean);

const sandbox = await mkdtemp(join(evidence, "native-ignore-"));
const isolatedHome = join(sandbox, "home");
const userData = join(sandbox, "user-data");
// 三つの保存先を分け、既定homeへの直書きが偶然成功しないようにする。
const figdiffHome = join(sandbox, "configured-home");
const projectsDirectory = join(sandbox, "configured-projects");
const projectDirectory = join(projectsDirectory, "ignore-fixture");
await mkdir(isolatedHome, { recursive: true });
await mkdir(figdiffHome, { recursive: true });
await mkdir(projectDirectory, { recursive: true });
await mkdir(userData, { recursive: true });
const designPath = join(isolatedHome, "design.png");
const screenshotPath = join(isolatedHome, "screenshot.png");
const resizedScreenshotPath = join(isolatedHome, "screenshot-resized.png");
const resizedDesignPath = join(isolatedHome, "design-resized.png");
await sharp({ create: { width: 20, height: 20, channels: 4, background: "#ff0000" } })
  .png()
  .toFile(designPath);
const halfPixels = Buffer.alloc(20 * 20 * 4);
for (let y = 0; y < 20; y += 1) {
  for (let x = 0; x < 20; x += 1) {
    const offset = (y * 20 + x) * 4;
    halfPixels.set(x < 10 ? [255, 0, 0, 255] : [0, 0, 255, 255], offset);
  }
}
await sharp(halfPixels, { raw: { width: 20, height: 20, channels: 4 } })
  .png()
  .toFile(screenshotPath);
const resizedHalfPixels = Buffer.alloc(40 * 40 * 4);
for (let y = 0; y < 40; y += 1) {
  for (let x = 0; x < 40; x += 1) {
    resizedHalfPixels.set(x < 20 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * 40 + x) * 4);
  }
}
await sharp(resizedHalfPixels, { raw: { width: 40, height: 40, channels: 4 } })
  .png()
  .toFile(resizedScreenshotPath);
await sharp({ create: { width: 40, height: 40, channels: 4, background: "#ff0000" } })
  .png()
  .toFile(resizedDesignPath);
const durableInputs = {
  design: join(evidence, "input-design-20x20-red.png"),
  screenshot: join(evidence, "input-screenshot-20x20-half-blue.png"),
  resizedDesign: join(evidence, "input-design-40x40-red.png"),
  resizedScreenshot: join(evidence, "input-screenshot-40x40-half-blue.png"),
};
await Promise.all([
  writeFile(durableInputs.design, await readFile(designPath)),
  writeFile(durableInputs.screenshot, await readFile(screenshotPath)),
  writeFile(durableInputs.resizedDesign, await readFile(resizedDesignPath)),
  writeFile(durableInputs.resizedScreenshot, await readFile(resizedScreenshotPath)),
]);

const inspectRawDifference = async (leftPath, rightPath, masks = []) => {
  const [left, right] = await Promise.all([
    sharp(leftPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(rightPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  assert.deepEqual(left.info, right.info);
  let differingPixelCount = 0;
  let comparedPixelCount = 0;
  let minX = left.info.width;
  let minY = left.info.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < left.info.height; y += 1) {
    for (let x = 0; x < left.info.width; x += 1) {
      if (
        masks.some(
          (mask) =>
            x >= mask.x && x < mask.x + mask.width && y >= mask.y && y < mask.y + mask.height,
        )
      )
        continue;
      comparedPixelCount += 1;
      const offset = (y * left.info.width + x) * left.info.channels;
      let differs = false;
      for (let channel = 0; channel < left.info.channels; channel += 1) {
        if (left.data[offset + channel] !== right.data[offset + channel]) differs = true;
      }
      if (!differs) continue;
      differingPixelCount += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return {
    comparedPixelCount,
    differingPixelCount,
    bounds:
      differingPixelCount === 0
        ? null
        : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
  };
};
const rightHalf = { id: "right-half", x: 10, y: 0, width: 10, height: 20 };
const baselineOracle = await inspectRawDifference(designPath, screenshotPath);
const maskedOracle = await inspectRawDifference(designPath, screenshotPath, [rightHalf]);
const resizedOracle = await inspectRawDifference(resizedDesignPath, resizedScreenshotPath);
const fullCanvasOracle = await inspectRawDifference(resizedDesignPath, resizedScreenshotPath, [
  { x: 0, y: 0, width: 40, height: 40 },
]);
assert.deepEqual(baselineOracle, {
  comparedPixelCount: 400,
  differingPixelCount: 200,
  bounds: { x: 10, y: 0, width: 10, height: 20 },
});
assert.deepEqual(maskedOracle, {
  comparedPixelCount: 200,
  differingPixelCount: 0,
  bounds: null,
});
assert.deepEqual(resizedOracle, {
  comparedPixelCount: 1600,
  differingPixelCount: 800,
  bounds: { x: 20, y: 0, width: 20, height: 40 },
});
assert.deepEqual(fullCanvasOracle, {
  comparedPixelCount: 0,
  differingPixelCount: 0,
  bounds: null,
});
await writeFile(
  join(projectDirectory, "project.json"),
  JSON.stringify({
    id: "ignore-fixture",
    name: "Ignore region fixture",
    implementationUrl: "http://localhost:3000",
    pages: [
      {
        id: "fixture-page",
        name: "Fixture page",
        path: "/",
        designSources: [
          {
            id: "fixture-image",
            type: "local_image",
            label: "Fixture design",
            filePath: designPath,
          },
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
const rendererCrashes = [];
const launchApplication = async () =>
  await electron.launch({
    executablePath: process.env.FIGDIFF_ELECTRON_EXECUTABLE ?? require("electron"),
    args: [bootstrap, `--user-data-dir=${userData}`],
    env: environment,
    timeout: 30_000,
  });
const observePage = async (application) => {
  const page = await application.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("crash", () => rendererCrashes.push("renderer crashed"));
  return page;
};
const openFixtureComparison = async (page) => {
  await expect(page.getByText("Ignore region fixture", { exact: true }).first()).toBeVisible();
  if (!(await page.getByText("Fixture design", { exact: true }).isVisible())) {
    await page.getByText("Ignore region fixture", { exact: true }).first().click();
  }
  await expect(page.getByText("Fixture design", { exact: true })).toBeVisible();
  const start = page.getByRole("button", { name: "比較を開始", exact: true });
  if (await start.isVisible()) await start.click();
};
const loadScreenshotAndCompare = async (page, inputPath) => {
  const changeScreenshot = page.getByRole("button", { name: "変更", exact: true });
  if (await changeScreenshot.isVisible()) await changeScreenshot.click();
  const screenshotInput = page.getByPlaceholder(
    "URL またはファイルパス（例: http://localhost:3000）",
  );
  await screenshotInput.fill(inputPath);
  await page.getByRole("button", { name: "実装スクリーンショット", exact: true }).click();
  await page.getByRole("button", { name: "差分を検出", exact: true }).click();
};
const fillMask = async (page, id, x, y, width, height) => {
  const fields = page.locator("fieldset input");
  await fields.nth(0).fill(id);
  await fields.nth(2).fill(String(x));
  await fields.nth(3).fill(String(y));
  await fields.nth(4).fill(String(width));
  await fields.nth(5).fill(String(height));
  await page.getByRole("button", { name: "マスクを保存して再比較", exact: true }).click();
};
const regionCard = (page, id) => page.getByText(id, { exact: true }).locator("xpath=../..");
const diffPixelValue = (page) =>
  page.getByText("差分ピクセル", { exact: true }).locator("..").locator("p").nth(1);
const listRegions = async (page) =>
  await page.evaluate(async () => await window.electronAPI.ignoreRegion.list("ignore-fixture"));
const saveError = async (page, entry) =>
  await page.evaluate(async (candidate) => {
    try {
      await window.electronAPI.ignoreRegion.save("ignore-fixture", candidate);
      return null;
    } catch (error) {
      return String(error);
    }
  }, entry);
let application = await launchApplication();
try {
  let page = await observePage(application);
  const preloadSurface = await page.evaluate(() => ({
    list: typeof window.electronAPI?.ignoreRegion?.list,
    save: typeof window.electronAPI?.ignoreRegion?.save,
    delete: typeof window.electronAPI?.ignoreRegion?.delete,
  }));
  assert.deepEqual(preloadSurface, { list: "function", save: "function", delete: "function" });
  await openFixtureComparison(page);
  await page.screenshot({ path: join(evidence, "comparison-entry.png"), animations: "disabled" });
  await loadScreenshotAndCompare(page, screenshotPath);
  const score = page.getByTestId("score-ring-value");
  await expect(score).toHaveText("50");
  await expect(diffPixelValue(page)).toHaveText(String(baselineOracle.differingPixelCount));
  const baselineScore = await score.textContent();
  const baselineDiffPixels = await diffPixelValue(page).textContent();

  await page.getByRole("button", { name: "除外", exact: true }).click();
  const beforeInvalid = await listRegions(page);
  const invalidInputError = await saveError(page, {
    id: "invalid-negative",
    x: -1,
    y: 0,
    width: 1,
    height: 1,
  });
  assert.match(invalidInputError ?? "", /greater than or equal to 0|nonnegative|too[_ ]small/i);
  assert.deepEqual(await listRegions(page), beforeInvalid);

  await fillMask(page, rightHalf.id, rightHalf.x, rightHalf.y, rightHalf.width, rightHalf.height);
  await expect(score).toHaveText("100");
  await expect(diffPixelValue(page)).toHaveText(String(maskedOracle.differingPixelCount));
  const savedScore = await score.textContent();
  const savedDiffPixels = await diffPixelValue(page).textContent();
  const expectedRightHalfEntry = {
    ...rightHalf,
    coordinate_context: {
      canvas_width: 20,
      canvas_height: 20,
      design_original_width: 20,
      design_original_height: 20,
      screenshot_original_width: 20,
      screenshot_original_height: 20,
    },
  };
  const savedEntries = await listRegions(page);
  assert.deepEqual(savedEntries, [expectedRightHalfEntry]);
  const savedCard = regionCard(page, "right-half");
  await expect(savedCard.getByText("x:10 y:0 w:10 h:20", { exact: true })).toBeVisible();
  await expect(savedCard.getByText("この画像条件で確認済み", { exact: true })).toBeVisible();
  await page.screenshot({ path: join(evidence, "ignore-saved-pass.png"), animations: "disabled" });

  const savedConfigPath = join(projectDirectory, "ignore-regions.yaml");
  const savedConfigBytes = await readFile(savedConfigPath);
  const savedConfig = parseYaml(savedConfigBytes.toString("utf8"));
  assert.deepEqual(savedConfig, { version: 1, regions: [expectedRightHalfEntry] });
  const durableSavedConfig = join(evidence, "ignore-regions-saved.yaml");
  await writeFile(durableSavedConfig, savedConfigBytes);

  await chmod(projectDirectory, 0o500);
  let ioError;
  try {
    await assert.rejects(writeFile(join(projectDirectory, "independent-write-probe"), "probe"), {
      code: "EACCES",
    });
    ioError = await saveError(page, {
      ...expectedRightHalfEntry,
      id: "io-denied",
    });
    assert.match(ioError ?? "", /EACCES|permission denied/i);
  } finally {
    await chmod(projectDirectory, 0o700);
  }
  assert.deepEqual(await listRegions(page), [expectedRightHalfEntry]);

  await application.close();
  application = await launchApplication();
  page = await observePage(application);
  await openFixtureComparison(page);
  await page.getByRole("button", { name: "除外", exact: true }).click();
  const restartedCard = regionCard(page, "right-half");
  await expect(restartedCard.getByText("x:10 y:0 w:10 h:20", { exact: true })).toBeVisible();
  const restartEntries = await listRegions(page);
  assert.deepEqual(restartEntries, [expectedRightHalfEntry]);
  await loadScreenshotAndCompare(page, screenshotPath);
  await expect(page.getByTestId("score-ring-value")).toHaveText("100");
  await expect(diffPixelValue(page)).toHaveText(String(maskedOracle.differingPixelCount));
  const restartedScore = await page.getByTestId("score-ring-value").textContent();
  const restartedDiffPixels = await diffPixelValue(page).textContent();
  await expect(restartedCard.getByText("この画像条件で確認済み", { exact: true })).toBeVisible();

  await restartedCard.getByRole("button", { name: "削除", exact: true }).click();
  await expect(page.getByTestId("score-ring-value")).toHaveText("50");
  await expect(diffPixelValue(page)).toHaveText(String(baselineOracle.differingPixelCount));
  const deleteRestoredScore = await page.getByTestId("score-ring-value").textContent();
  const deleteRestoredDiffPixels = await diffPixelValue(page).textContent();
  const deletedEntries = await listRegions(page);
  assert.deepEqual(deletedEntries, []);
  const deletedConfigBytes = await readFile(savedConfigPath);
  assert.deepEqual(parseYaml(deletedConfigBytes.toString("utf8")), { version: 1, regions: [] });
  const durableDeletedConfig = join(evidence, "ignore-regions-after-delete.yaml");
  await writeFile(durableDeletedConfig, deletedConfigBytes);
  await page.screenshot({
    path: join(evidence, "ignore-deleted-recompare.png"),
    animations: "disabled",
  });

  await fillMask(page, rightHalf.id, rightHalf.x, rightHalf.y, rightHalf.width, rightHalf.height);
  await loadScreenshotAndCompare(page, resizedScreenshotPath);
  await expect(diffPixelValue(page)).toHaveText(String(resizedOracle.differingPixelCount));
  const resizedDiffPixels = await diffPixelValue(page).textContent();
  const incompatibleCard = regionCard(page, "right-half");
  await expect(
    incompatibleCard.getByText("現在の画像条件とは不一致のため無効", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: join(evidence, "ignore-context-mismatch.png"),
    animations: "disabled",
  });

  await fillMask(page, "full-canvas", 0, 0, 40, 40);
  await expect(page.getByText(/no pixels remain to compare/)).toBeVisible();
  await expect(page.getByTestId("score-ring-value")).toHaveText("—");
  await expect(
    regionCard(page, "right-half").getByText("現在の画像条件とは不一致のため無効", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    regionCard(page, "full-canvas").getByText("この画像条件で確認済み", { exact: true }),
  ).toBeVisible();
  const finalEntries = await listRegions(page);
  const expectedFullCanvasEntry = {
    id: "full-canvas",
    x: 0,
    y: 0,
    width: 40,
    height: 40,
    coordinate_context: {
      canvas_width: 40,
      canvas_height: 40,
      design_original_width: 20,
      design_original_height: 20,
      screenshot_original_width: 40,
      screenshot_original_height: 40,
    },
  };
  assert.deepEqual(finalEntries, [expectedRightHalfEntry, expectedFullCanvasEntry]);
  await page.screenshot({
    path: join(evidence, "ignore-full-canvas-uncertain.png"),
    animations: "disabled",
  });
  const finalConfigBytes = await readFile(savedConfigPath);
  assert.deepEqual(parseYaml(finalConfigBytes.toString("utf8")), {
    version: 1,
    regions: [expectedRightHalfEntry, expectedFullCanvasEntry],
  });
  const durableFinalConfig = join(evidence, "ignore-regions-final.yaml");
  await writeFile(durableFinalConfig, finalConfigBytes);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(rendererCrashes, []);
  await writeFile(
    join(evidence, "native-ignore-result.json"),
    `${JSON.stringify(
      {
        transportObservations: {
          preloadSurface,
          saveReadback: savedEntries,
          restartReadback: restartEntries,
          deleteReadback: deletedEntries,
          invalidInputRejected: invalidInputError,
          ioWriteRejected: ioError,
        },
        artifactHashes: {
          driver: sha256(await readFile(fileURLToPath(import.meta.url))),
          inputs: await Promise.all(
            Object.entries(durableInputs).map(async ([name, filePath]) => ({
              name,
              path: filePath,
              sha256: sha256(await readFile(filePath)),
            })),
          ),
          savedConfig: {
            path: durableSavedConfig,
            sha256: sha256(savedConfigBytes),
          },
          deletedConfig: {
            path: durableDeletedConfig,
            sha256: sha256(deletedConfigBytes),
          },
          finalConfig: {
            path: durableFinalConfig,
            sha256: sha256(finalConfigBytes),
          },
        },
        independentPixelOracles: {
          baseline: baselineOracle,
          rightHalfMasked: maskedOracle,
          resizedBaseline: resizedOracle,
          fullCanvasMasked: fullCanvasOracle,
        },
        productObservations: {
          baselineScore,
          baselineDiffPixels,
          savedScore,
          savedDiffPixels,
          restartedScore,
          restartedDiffPixels,
          deleteRestoredScore,
          deleteRestoredDiffPixels,
          resizedDiffPixels,
          contextMismatchCard: "right-half",
          applicableFullCanvasCard: "full-canvas",
          fullCanvasComparisonUnavailable: true,
        },
        pageErrors,
        rendererCrashes,
      },
      null,
      2,
    )}\n`,
  );
  const buildAtEnd = await captureBuild();
  const buildUnchanged = buildAtEnd.sha256 === buildAtStart.sha256;
  const artifactPaths = (await readdir(evidence, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name !== "manifest.json")
    .map((entry) => join(evidence, entry.name))
    .sort();
  const artifacts = await Promise.all(
    artifactPaths.map(async (path) => ({
      path: path.slice(evidence.length + 1),
      size: (await stat(path)).size,
      sha256: sha256(await readFile(path)),
    })),
  );
  await writeFile(
    join(evidence, "manifest.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        startedAt,
        completedAt: new Date().toISOString(),
        revision,
        dirtyState,
        command:
          "FIGDIFF_IGNORE_EVIDENCE=<evidence> xvfb-run -a node app/desktop/e2e/native-ignore-region.mjs",
        build: buildAtStart,
        buildEndSha256: buildAtEnd.sha256,
        buildUnchanged,
        driver: {
          path: "app/desktop/e2e/native-ignore-region.mjs",
          sha256: sha256(await readFile(fileURLToPath(import.meta.url))),
        },
        scope:
          "Synthetic native Electron ignore-region flow with independent raw-pixel, DOM diffPixel, IPC, YAML, restart, validation, and EACCES oracles.",
        artifacts,
      },
      null,
      2,
    )}\n`,
  );
  assert.ok(buildUnchanged, "desktop/shared build changed during native verification");
} finally {
  try {
    await application.close();
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
}

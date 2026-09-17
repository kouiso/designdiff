import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, statfs, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { _electron as electron, expect } from "playwright/test";
import sharp from "sharp";

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, "../../..");
const require = createRequire(import.meta.url);
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
const evidencePath = process.env.FIGDIFF_FIX_ANIMATION_EVIDENCE;
if (!evidencePath) throw new Error("FIGDIFF_FIX_ANIMATION_EVIDENCE is required");
const evidence = resolve(evidencePath);
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

const sandbox = await mkdtemp(join(evidence, "native-fix-animation-"));
const isolatedHome = join(sandbox, "home");
const userData = join(sandbox, "user-data");
const projectDirectory = join(isolatedHome, ".figdiff/projects/fix-animation-fixture");
await Promise.all([
  mkdir(projectDirectory, { recursive: true }),
  mkdir(userData, { recursive: true }),
]);

const makeFixPixels = ({ topLeft, bottomRight, width = 90, height = 90 }) => {
  const pixels = Buffer.alloc(width * height * 4, 255);
  const paintSquare = (startX, startY) => {
    for (let y = startY; y < startY + 20; y += 1) {
      for (let x = startX; x < startX + 20; x += 1) {
        const offset = (y * width + x) * 4;
        pixels.set([0, 0, 0, 255], offset);
      }
    }
  };
  if (topLeft) paintSquare(5, 5);
  if (bottomRight) paintSquare(width - 25, height - 25);
  return { pixels, width, height };
};

const writeRawPng = async (path, fixture) => {
  await sharp(fixture.pixels, {
    raw: { width: fixture.width, height: fixture.height, channels: 4 },
  })
    .png()
    .toFile(path);
};

const inputPaths = {
  design: join(isolatedHome, "fix-design.png"),
  before: join(isolatedHome, "fix-before.png"),
  after: join(isolatedHome, "fix-after.png"),
  changedGeometry: join(isolatedHome, "fix-after-changed-geometry.png"),
  animationDesign0: join(isolatedHome, "animation-design-0.png"),
  animationDesign100: join(isolatedHome, "animation-design-100.png"),
  animationImpl20: join(isolatedHome, "animation-impl-20.png"),
  animationImpl120: join(isolatedHome, "animation-impl-120.png"),
};
const durableInputPaths = Object.fromEntries(
  Object.entries(inputPaths).map(([name, path]) => [name, join(evidence, basename(path))]),
);
await Promise.all([
  writeRawPng(inputPaths.design, makeFixPixels({ topLeft: true, bottomRight: true })),
  writeRawPng(inputPaths.before, makeFixPixels({ topLeft: false, bottomRight: true })),
  writeRawPng(inputPaths.after, makeFixPixels({ topLeft: true, bottomRight: false })),
  writeRawPng(
    inputPaths.changedGeometry,
    makeFixPixels({ topLeft: true, bottomRight: false, width: 99, height: 90 }),
  ),
  sharp({ create: { width: 40, height: 40, channels: 4, background: "#c62828" } })
    .png()
    .toFile(inputPaths.animationDesign0),
  sharp({ create: { width: 40, height: 40, channels: 4, background: "#1565c0" } })
    .png()
    .toFile(inputPaths.animationDesign100),
  sharp({ create: { width: 40, height: 40, channels: 4, background: "#c62828" } })
    .png()
    .toFile(inputPaths.animationImpl20),
  sharp({ create: { width: 40, height: 40, channels: 4, background: "#1565c0" } })
    .png()
    .toFile(inputPaths.animationImpl120),
]);
await Promise.all(
  Object.entries(inputPaths).map(async ([name, path]) => {
    await writeFile(durableInputPaths[name], await readFile(path));
  }),
);

const pixelDifference = async (leftPath, rightPath) => {
  const [left, right] = await Promise.all([
    sharp(leftPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(rightPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  assert.equal(left.info.width, right.info.width);
  assert.equal(left.info.height, right.info.height);
  let count = 0;
  let minX = left.info.width;
  let minY = left.info.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < left.info.height; y += 1) {
    for (let x = 0; x < left.info.width; x += 1) {
      const offset = (y * left.info.width + x) * 4;
      if (left.data.subarray(offset, offset + 4).equals(right.data.subarray(offset, offset + 4))) {
        continue;
      }
      count += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return {
    count,
    bounds:
      count === 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
  };
};

const fixOracle = {
  before: await pixelDifference(inputPaths.design, inputPaths.before),
  after: await pixelDifference(inputPaths.design, inputPaths.after),
};
assert.deepEqual(fixOracle.before, {
  count: 400,
  bounds: { x: 5, y: 5, width: 20, height: 20 },
});
assert.deepEqual(fixOracle.after, {
  count: 400,
  bounds: { x: 65, y: 65, width: 20, height: 20 },
});
const inputHashes = Object.fromEntries(
  await Promise.all(
    Object.entries(inputPaths).map(async ([name, path]) => [name, sha256(await readFile(path))]),
  ),
);
assert.equal(inputHashes.animationDesign0, inputHashes.animationImpl20);
assert.equal(inputHashes.animationDesign100, inputHashes.animationImpl120);
assert.notEqual(inputHashes.animationDesign0, inputHashes.animationDesign100);

await writeFile(
  join(projectDirectory, "project.json"),
  JSON.stringify({
    id: "fix-animation-fixture",
    name: "Fix animation fixture",
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
            filePath: inputPaths.design,
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
  FIGDIFF_HOME: join(isolatedHome, ".figdiff"),
  FIGDIFF_DISABLE_KEYCHAIN_READ: "1",
};
delete environment.ELECTRON_RUN_AS_NODE;
const pageErrors = [];
const rendererCrashes = [];
let application;
let page;

const loadScreenshotAndCompare = async (page, inputPath) => {
  const change = page.getByRole("button", { name: "変更", exact: true });
  if (await change.isVisible()) await change.click();
  await page
    .getByPlaceholder("URL またはファイルパス（例: http://localhost:3000）")
    .fill(inputPath);
  await page.getByRole("button", { name: "実装スクリーンショット", exact: true }).click();
  await page.getByRole("button", { name: "差分を検出", exact: true }).click();
  await expect(page.getByTestId("compare-score-verdict-badge")).toBeVisible();
};

try {
  application = await electron.launch({
    executablePath: process.env.FIGDIFF_ELECTRON_EXECUTABLE ?? require("electron"),
    args: [bootstrap, `--user-data-dir=${userData}`],
    env: environment,
    timeout: 30_000,
  });
  page = await application.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("crash", () => rendererCrashes.push("renderer crashed"));
  await expect(page.getByText("Fix animation fixture", { exact: true }).first()).toBeVisible();
  await page.getByText("Fix animation fixture", { exact: true }).first().click();
  await expect(page.getByText("Fixture design", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "比較を開始", exact: true }).click();
  await expect(page.getByText("デザインと実装を比較", { exact: true })).toBeVisible();
  await loadScreenshotAndCompare(page, inputPaths.before);

  await page.getByRole("button", { name: "修正確認", exact: true }).click();
  await page.getByLabel("確認する採点領域").selectOption("top-left");
  await page.getByRole("button", { name: "修正前として固定", exact: true }).click();
  await expect(page.getByText("対象領域: top-left", { exact: true })).toBeVisible();
  await page.screenshot({ path: join(evidence, "fix-before-pinned.png"), animations: "disabled" });

  await loadScreenshotAndCompare(page, inputPaths.after);
  await page.getByRole("button", { name: "修正を確認", exact: true }).click();
  const fixResult = page.getByTestId("fix-verification-result");
  await expect(fixResult.getByText(/対象領域の変化:/)).toContainText("IMPROVED");
  await expect(fixResult.getByText(/現在比較全体:/)).toContainText("FAIL");
  await expect(fixResult.getByText(/bottom-right:/)).toBeVisible();
  await fixResult.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: join(evidence, "fix-improved-with-side-effect.png"),
    animations: "disabled",
  });

  await loadScreenshotAndCompare(page, inputPaths.changedGeometry);
  await page.getByRole("button", { name: "修正を確認", exact: true }).click();
  const conditionMismatch = page.getByText(
    "修正前と修正後の比較条件が一致しないため判定できません。",
    {
      exact: true,
    },
  );
  await expect(conditionMismatch).toBeVisible();
  await expect(page.getByText(/imageGeometry/)).toBeVisible();
  await conditionMismatch.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: join(evidence, "fix-condition-mismatch.png"),
    animations: "disabled",
  });

  await page.getByRole("button", { name: "動き", exact: true }).click();
  await page
    .getByLabel("設計フレームを追加")
    .setInputFiles([inputPaths.animationDesign0, inputPaths.animationDesign100]);
  await page
    .getByLabel("実装フレームを追加")
    .setInputFiles([inputPaths.animationImpl20, inputPaths.animationImpl120]);
  await page.getByLabel("設計フレーム 1 時刻").fill("0");
  await page.getByLabel("設計フレーム 2 時刻").fill("100");
  await page.getByLabel("実装フレーム 1 時刻").fill("20");
  await page.getByLabel("実装フレーム 2 時刻").fill("120");
  await page.getByLabel("対応候補の時間幅").fill("50");
  await page.getByLabel("許容する時間差").fill("30");
  await page.getByRole("button", { name: "時系列を比較", exact: true }).click();
  const animationResult = page.getByTestId("animation-comparison-result");
  await expect(animationResult.getByText(/全体判定:/)).toContainText("PASS");
  const firstMapping = animationResult.getByText("0ms → 20ms (差 20ms)", { exact: true });
  await expect(firstMapping).toBeVisible();
  await expect(animationResult.getByText("100ms → 120ms (差 20ms)", { exact: true })).toBeVisible();
  await expect(
    animationResult.getByRole("list", { name: "局所フレーム結果" }).getByRole("listitem"),
  ).toHaveCount(2);
  await firstMapping.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: join(evidence, "animation-two-frame-mapping.png"),
    animations: "disabled",
  });

  await page.getByRole("button", { name: "animation-design-100.pngを削除", exact: true }).click();
  await page.getByRole("button", { name: "時系列を比較", exact: true }).click();
  await expect(page.getByTestId("animation-comparison-result")).toContainText(
    "時刻のズレは測っていない",
  );
  await page.screenshot({
    path: join(evidence, "animation-single-design-unmeasured.png"),
    animations: "disabled",
  });

  await page.getByLabel("実装フレーム 1 時刻").fill("120");
  await page.getByLabel("実装フレーム 2 時刻").fill("20");
  await page.getByRole("button", { name: "時系列を比較", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("実装側: 撮影する時刻は小さい順");
  await expect(page.getByTestId("animation-comparison-result")).toHaveCount(0);
  await page.screenshot({
    path: join(evidence, "animation-reversed-time-rejected.png"),
    animations: "disabled",
  });

  assert.deepEqual(pageErrors, []);
  assert.deepEqual(rendererCrashes, []);
  const screenshots = [
    "fix-before-pinned.png",
    "fix-improved-with-side-effect.png",
    "fix-condition-mismatch.png",
    "animation-two-frame-mapping.png",
    "animation-single-design-unmeasured.png",
    "animation-reversed-time-rejected.png",
  ];
  const screenshotHashes = Object.fromEntries(
    await Promise.all(
      screenshots.map(async (name) => [name, sha256(await readFile(join(evidence, name)))]),
    ),
  );
  await writeFile(
    join(evidence, "native-fix-animation.json"),
    JSON.stringify(
      {
        native: true,
        preload: true,
        execution: { status: "passed", exitCode: 0 },
        oracle: {
          fix: fixOracle,
          animation: {
            designTimesMs: [0, 100],
            implementationTimesMs: [20, 120],
            expectedMappings: [
              { designAtMs: 0, implementationAtMs: 20 },
              { designAtMs: 100, implementationAtMs: 120 },
            ],
            inputHashes,
          },
        },
        screenshots: screenshotHashes,
        pageErrors,
        rendererCrashes,
      },
      null,
      2,
    ),
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
          "FIGDIFF_FIX_ANIMATION_EVIDENCE=<evidence> xvfb-run -a node app/desktop/e2e/native-fix-animation.mjs",
        build: buildAtStart,
        buildEndSha256: buildAtEnd.sha256,
        buildUnchanged,
        driver: {
          path: "app/desktop/e2e/native-fix-animation.mjs",
          sha256: sha256(await readFile(fileURLToPath(import.meta.url))),
        },
        scope:
          "Synthetic native Electron fix-verification and animation flows with independent raw-pixel, timestamp, image-hash, DOM mapping, condition-mismatch, and rejection oracles.",
        artifacts,
      },
      null,
      2,
    )}\n`,
  );
  assert.ok(buildUnchanged, "desktop/shared build changed during native verification");
} catch (error) {
  if (page) {
    await page.screenshot({ path: join(evidence, "failure.png"), animations: "disabled" });
    await writeFile(join(evidence, "failure-dom.txt"), await page.locator("body").innerText());
  }
  throw error;
} finally {
  try {
    await application?.close();
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
}

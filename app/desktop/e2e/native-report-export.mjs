import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
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
const evidencePath = process.env.FIGDIFF_REPORT_EVIDENCE;
if (!evidencePath) throw new Error("FIGDIFF_REPORT_EVIDENCE is required");
const evidence = resolve(evidencePath);
await mkdir(evidence, { recursive: true });
const filesystem = await statfs(evidence);
if (filesystem.bavail * filesystem.bsize < 512 * 1024 * 1024) {
  throw new Error("Native verification requires at least 512 MiB free before launch");
}
const startedAt = new Date().toISOString();
const buildAtStart = await captureBuild();
const revision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repository,
  encoding: "utf8",
}).trim();
const dirtyState = execFileSync("git", ["status", "--porcelain=v1"], {
  cwd: repository,
  encoding: "utf8",
})
  .trimEnd()
  .split("\n")
  .filter(Boolean);

const sandbox = await mkdtemp(join(evidence, "native-report-"));
const isolatedHome = join(sandbox, "home");
const userData = join(sandbox, "user-data");
const projectDirectory = join(isolatedHome, ".figdiff/projects/report-fixture");
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
};
const durableInputPaths = Object.fromEntries(
  Object.entries(inputPaths).map(([name, path]) => [name, join(evidence, basename(path))]),
);
await Promise.all([
  writeRawPng(inputPaths.design, makeFixPixels({ topLeft: true, bottomRight: true })),
  writeRawPng(inputPaths.before, makeFixPixels({ topLeft: false, bottomRight: true })),
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
};
assert.deepEqual(fixOracle.before, {
  count: 400,
  bounds: { x: 5, y: 5, width: 20, height: 20 },
});

await writeFile(
  join(projectDirectory, "project.json"),
  JSON.stringify({
    id: "report-fixture",
    name: "Report fixture",
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
  GTK_USE_PORTAL: "0",
  DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(sandbox, "unused-dbus")}`,
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
  await expect(page.getByText("Report fixture", { exact: true }).first()).toBeVisible();
  await page.getByText("Report fixture", { exact: true }).first().click();
  await expect(page.getByText("Fixture design", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "比較を開始", exact: true }).click();
  await expect(page.getByText("デザインと実装を比較", { exact: true })).toBeVisible();
  await loadScreenshotAndCompare(page, inputPaths.before);

  // win32 では xwininfo/XTest が使えんため、同じ `0xhwnd "title"` 形式を
  // 返す win32-native-dialog.ps1 (EnumWindows/SendKeys/System.Drawing) に切替える。
  const isWin32 = process.platform === "win32";
  const winDialogHelper = join(directory, "win32-native-dialog.ps1");
  const winDialog = (args, timeout = 10_000) =>
    spawnSync(
      "powershell.exe",
      ["-STA", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", winDialogHelper, ...args],
      { env: environment, encoding: "utf8", timeout },
    );
  const inspectNativeDialog = () => {
    const result = isWin32
      ? winDialog(["tree"], 8_000)
      : spawnSync("xwininfo", ["-root", "-tree"], {
          env: environment,
          encoding: "utf8",
          timeout: 2_000,
        });
    return { tree: result.stdout ?? "", complete: result.status === 0 };
  };
  const nativeDialogState = () => {
    const inspection = inspectNativeDialog();
    if (!inspection.complete) return "unknown";
    return /0x[0-9a-f]+ "Save File"/.test(inspection.tree) ? "open" : "closed";
  };
  const waitForNativeDialog = async (open) => {
    await expect
      .poll(nativeDialogState, {
        timeout: 15_000,
        message: `Native Save File dialog did not become ${open ? "visible" : "closed"}`,
      })
      .toBe(open ? "open" : "closed");
  };
  const captureNativeDialogTree = async () => {
    let tree = "";
    await expect
      .poll(
        () => {
          const inspection = inspectNativeDialog();
          if (inspection.complete && /0x[0-9a-f]+ "Save File"/.test(inspection.tree)) {
            tree = inspection.tree;
            return true;
          }
          return false;
        },
        { timeout: 15_000, message: "Native Save File window tree did not stabilize" },
      )
      .toBe(true);
    return tree;
  };
  // WSLg では root window が巨大化し import -window root が失敗し得るため、
  // 対象 window の id を直接指定して撮る。
  const captureWindowImage = (tree, titlePattern, path, label) => {
    const match = tree.match(new RegExp(`(0x[0-9a-f]+) "${titlePattern}"`));
    assert.ok(match, `${label} window id must be discoverable`);
    if (isWin32) {
      const result = winDialog(["shot", match[1], path]);
      assert.equal(result.status, 0, `${label} capture failed: ${result.stderr ?? ""}`);
      return;
    }
    execFileSync("import", ["-window", match[1], path], { env: environment });
  };
  const captureNativeDialogImage = async (path) => {
    const tree = await captureNativeDialogTree();
    captureWindowImage(tree, "Save File", path, "Save File dialog");
  };
  const captureAppWindowImage = (path) => {
    const { tree } = inspectNativeDialog();
    captureWindowImage(tree, "FigDiff", path, "FigDiff app");
  };
  const nativeKeys = (text) =>
    execFileSync(
      "python3",
      [
        "-c",
        `
import ctypes, sys, subprocess, re
x = ctypes.CDLL("libX11.so.6")
t = ctypes.CDLL("libXtst.so.6")
x.XOpenDisplay.restype = ctypes.c_void_p
x.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
x.XKeysymToKeycode.restype = ctypes.c_uint
x.XSync.argtypes = [ctypes.c_void_p, ctypes.c_int]
t.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
d = x.XOpenDisplay(None)
if not d: raise RuntimeError("No isolated X display")
window_tree = subprocess.check_output(["xwininfo", "-root", "-tree"], text=True)
match = re.search(r'(0x[0-9a-f]+) "Save File"', window_tree)
if not match: raise RuntimeError("Native Save File window was not found")
x.XSetInputFocus.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong]
x.XSetInputFocus(d, int(match.group(1), 16), 1, 0)
def key(sym, down):
 code = x.XKeysymToKeycode(d, sym)
 if not code: raise RuntimeError("Unsupported keysym")
 t.XTestFakeKeyEvent(d, code, down, 0)
for ch in sys.argv[1]:
 if ch == "\\x0c":
  key(0xffe3, 1); key(ord("l"), 1); key(ord("l"), 0); key(0xffe3, 0)
 elif ch == "\\x01":
  key(0xffe3, 1); key(ord("a"), 1); key(ord("a"), 0); key(0xffe3, 0)
 else:
  sym = {"\\n":0xff0d, "\\x1b":0xff1b}.get(ch, ord(ch))
  key(sym, 1); key(sym, 0)
x.XSync(d, 0)
`,
        text,
      ],
      { env: environment, timeout: 5_000 },
    );
  // GTK では Ctrl+L→Ctrl+A→path→Enter。win32 ではフォーカス依存の入力が
  // 他窓に吸われ得るため、WM_CHAR で filename Edit に直接入力してから
  // Save ボタンへ BM_CLICK を投げる (フォーカス不要の経路)。
  const sendDialogInput = (text) => {
    if (isWin32) {
      const found = winDialog(["find"]);
      assert.equal(
        found.status,
        0,
        `Save File dialog hwnd must be discoverable (status=${found.status} stderr=${found.stderr ?? ""})`,
      );
      const hwnd = found.stdout.trim();
      const result = winDialog(["save", hwnd, text], 20_000);
      assert.equal(result.status, 0, `dialog input failed (hwnd=${hwnd}): ${result.stderr ?? ""}`);
      return;
    }
    nativeKeys(`\x0c\x01${text}\n\n`);
  };
  const sendDialogCancel = () => {
    if (isWin32) {
      const found = winDialog(["find"]);
      if (found.status === 0) winDialog(["cancel", found.stdout.trim()], 15_000);
      return;
    }
    nativeKeys("\x1b");
  };
  const saveButton = page.getByRole("button", { name: "レポートを保存", exact: true });
  await expect(saveButton).toBeVisible();
  const savedFiles = [];
  for (const format of ["json", "markdown"]) {
    await page.getByLabel("レポートの形式").selectOption(format);
    const destination = join(evidence, format === "json" ? "saved-report.json" : "saved-report.md");
    // 既存ファイルがあるとネイティブ側で上書き確認が出て、modal 応答の
    // 自動化が別問題になる。新規書込みを検証したいので事前に消しておく。
    await rm(destination, { force: true });
    await saveButton.click();
    await expect(page.getByRole("button", { name: "保存中…", exact: true })).toBeVisible();
    await waitForNativeDialog(true);
    await captureNativeDialogImage(join(evidence, `native-dialog-${format}.png`));
    await writeFile(join(evidence, `native-window-${format}.txt`), await captureNativeDialogTree());
    sendDialogInput(destination);
    await waitForNativeDialog(false);
    captureAppWindowImage(join(evidence, `after-input-${format}.png`));
    const readSavedFile = async () => {
      try {
        return await readFile(destination, "utf8");
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return "";
        throw error;
      }
    };
    await expect.poll(readSavedFile, { timeout: 15_000 }).not.toBe("");
    const content = await readFile(destination, "utf8");
    if (format === "json") {
      const report = JSON.parse(content);
      assert.equal(report.diffPixelCount, fixOracle.before.count);
      assert.equal(report.totalPixelCount, 8100);
      assert.equal(report.diffRegions.length, 1);
      assert.deepEqual(report.diffRegions[0].bounds, fixOracle.before.bounds);
      assert.equal(report.diffRegions[0].diffPixelCount, fixOracle.before.count);
      assert.equal("diffImageBase64" in report, false);
    } else {
      assert.ok(content.includes("**Diff Pixels:** 400 / 8,100"));
      assert.ok(content.includes("**Position:** (5, 5)"));
      assert.ok(content.includes("**Size:** 20x20px"));
    }
    savedFiles.push({ format, path: destination, sha256: sha256(Buffer.from(content)) });
    await expect(saveButton).toBeEnabled();
    await page.screenshot({ path: join(evidence, `saved-${format}.png`) });
  }
  await saveButton.click();
  await waitForNativeDialog(true);
  sendDialogCancel();
  await waitForNativeDialog(false);
  await expect(saveButton).toBeEnabled();
  await expect(page.getByText("保存をキャンセルしました", { exact: true })).toBeVisible();
  for (const saved of savedFiles) {
    assert.equal(sha256(await readFile(saved.path)), saved.sha256);
  }
  await page.screenshot({ path: join(evidence, "canceled.png") });
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(rendererCrashes, []);
  await writeFile(
    join(evidence, "evidence.json"),
    JSON.stringify(
      {
        savedFiles,
        independentRawDifference: fixOracle.before,
        pageErrors,
        rendererCrashes,
        nativeDialogMocked: false,
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
          "FIGDIFF_REPORT_EVIDENCE=<evidence> xvfb-run -a node app/desktop/e2e/native-report-export.mjs",
        build: buildAtStart,
        buildEndSha256: buildAtEnd.sha256,
        buildUnchanged,
        driver: {
          path: "app/desktop/e2e/native-report-export.mjs",
          sha256: sha256(await readFile(fileURLToPath(import.meta.url))),
        },
        scope:
          "Native Electron report export through real save dialogs, saved file readback and independent raw pixel difference.",
        results: {
          D07: {
            status: "PASS",
            expected: "実ファイルが読め、保存内容が差分実測と一致する",
            actual:
              "実Gtk保存ダイアログからJSON/Markdownへ保存し読み戻した。原画像の独立raw差分・bboxをファイル内容へ照合。キャンセル時bytes不変も確認",
          },
        },
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

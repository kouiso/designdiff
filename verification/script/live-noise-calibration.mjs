#!/usr/bin/env node
/**
 * 実画面の雑音の底を測る校正ハーネス。
 *
 * 前回のレシート（p5-oracle-gate-2026-07-28.md）は「設計」と「実装」を
 * 全く同じ描画経路で撮ったため sha256 が一致し、残差 0 が当然の値になった。
 * それは雑音が無いことの証拠にならない。
 *
 * ここでは同じ固定 HTML（fixture.html）を、意図的に違う描画経路で2枚撮る。
 *   - native: deviceScaleFactor=1 で等倍のまま撮影
 *   - downscaled: deviceScaleFactor=3 で高倍率撮影した後、Sharp で 1/3 に縮小
 * どちらも論理サイズ 400x300 の同じ UI だが、アンチエイリアスと縮小時の
 * 丸めが経路ごとに異なるため、実画面と同種の雑音が乗る。
 *
 * 測定は既存の独立オラクル script/oracle-compare.mjs（sharp + pixelmatch のみ、
 * @figdiff/shared を一切 import しない）を子プロセスで呼ぶ。FigDiff 自身の
 * 判定コードは経路のどこにも登場しない（自己認証の禁止を守る）。
 */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const sharp = require(path.join(__dirname, "../../app/mcp-server/node_modules/sharp"));

const ORACLE = path.join(__dirname, "../../script/oracle-compare.mjs");
const FIXTURE_HTML = path.join(__dirname, "../fixture/live-noise-calibration/fixture.html");
const DEFECT_FIXTURE_HTML = path.join(
  __dirname,
  "../fixture/live-noise-calibration/fixture-defect.html",
);
const OUT_DIR = path.join(__dirname, "../fixture/live-noise-calibration");
const WIDTH = 400;
const HEIGHT = 300;
const HIGH_SCALE = 3;

async function sha256(filePath) {
  const buf = await fs.readFile(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

async function captureNative(browser, htmlPath, outName) {
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.goto(`file://${htmlPath}`, { waitUntil: "load" });
  const outPath = path.join(OUT_DIR, outName);
  await page.screenshot({ path: outPath });
  await context.close();
  return outPath;
}

async function captureDownscaled(browser) {
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: HIGH_SCALE,
  });
  const page = await context.newPage();
  await page.goto(`file://${FIXTURE_HTML}`, { waitUntil: "load" });
  const rawPath = path.join(OUT_DIR, "high-scale-raw.png");
  await page.screenshot({ path: rawPath });
  await context.close();

  const meta = await sharp(rawPath).metadata();
  if (meta.width !== WIDTH * HIGH_SCALE || meta.height !== HEIGHT * HIGH_SCALE) {
    throw new Error(
      `high-scale capture の寸法が想定外: ${meta.width}x${meta.height} (期待 ${WIDTH * HIGH_SCALE}x${HEIGHT * HIGH_SCALE})`,
    );
  }
  const outPath = path.join(OUT_DIR, "downscaled.png");
  await sharp(rawPath).resize(WIDTH, HEIGHT).png().toFile(outPath);
  return outPath;
}

function runOracleCompare(designPath, screenshotPath, outDiffPath) {
  const run = spawnSync(
    process.execPath,
    [ORACLE, "compare", designPath, screenshotPath, outDiffPath],
    { encoding: "utf8" },
  );
  if (run.status !== 0) {
    throw new Error(`oracle-compare failed: ${run.stderr}`);
  }
  return JSON.parse(run.stdout);
}

export async function runCalibration() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  let nativePath;
  let downscaledPath;
  let defectNativePath;
  try {
    nativePath = await captureNative(browser, FIXTURE_HTML, "native.png");
    downscaledPath = await captureDownscaled(browser);
    defectNativePath = await captureNative(browser, DEFECT_FIXTURE_HTML, "defect-native.png");
  } finally {
    await browser.close();
  }

  const [nativeHash, downscaledHash] = await Promise.all([
    sha256(nativePath),
    sha256(downscaledPath),
  ]);

  if (nativeHash === downscaledHash) {
    throw new Error(
      "校正の2枚が sha256 一致（バイト単位で同一）。描画経路が実質同じで雑音が乗っていない。" +
        "組み方を作り直す必要がある。この結果は校正の根拠として使わない。",
    );
  }

  const diffPath = path.join(OUT_DIR, "diff.png");
  const compareResult = runOracleCompare(nativePath, downscaledPath, diffPath);

  if (compareResult.correctedResidualRate === 0) {
    throw new Error(
      "sha256 は異なるが、独立オラクルの残差が 0 だった。雑音を捉えられていない可能性がある。" +
        "この結果は校正の根拠として使わない。",
    );
  }

  // 雑音の底（ノイズフロア）だけでなく、閾値がどこに置かれるべきかを判断するため、
  // 同じ描画経路（native, deviceScaleFactor=1）で「小面積の実差分」1件も測る。
  // バッジの背景色を変えただけの局所的な色差分。これが雑音の底より十分大きいことを
  // 確認できて初めて、両者の間に閾値を置く根拠になる。
  const defectDiffPath = path.join(OUT_DIR, "defect-diff.png");
  const defectCompareResult = runOracleCompare(nativePath, defectNativePath, defectDiffPath);

  const report = {
    fixture: path.relative(process.cwd(), FIXTURE_HTML),
    defectFixture: path.relative(process.cwd(), DEFECT_FIXTURE_HTML),
    width: WIDTH,
    height: HEIGHT,
    highScale: HIGH_SCALE,
    images: {
      native: { path: path.relative(process.cwd(), nativePath), sha256: nativeHash },
      downscaled: { path: path.relative(process.cwd(), downscaledPath), sha256: downscaledHash },
      defectNative: {
        path: path.relative(process.cwd(), defectNativePath),
        sha256: await sha256(defectNativePath),
      },
    },
    notByteIdentical: nativeHash !== downscaledHash,
    noiseFloor: compareResult,
    realDefectSignal: defectCompareResult,
  };

  const reportPath = path.join(OUT_DIR, "calibration-report.json");
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  runCalibration()
    .then((report) => {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    })
    .catch((err) => {
      console.error("CALIBRATION ERROR:", err.message);
      process.exit(1);
    });
}

#!/usr/bin/env node
/**
 * Independent oracle for FigDiff alignment detection verification.
 * Uses Sharp + pixelmatch from mcp-server node_modules — NO @figdiff/shared imports.
 * Self-certify ban: this script is the ground-truth, not FigDiff's own output.
 */

import { createRequire } from "node:module";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const sharp = require(path.join(__dirname, "../app/mcp-server/node_modules/sharp"));
const pixelmatch = require(path.join(__dirname, "../app/mcp-server/node_modules/pixelmatch"));

const TMP_DIR = path.join(__dirname, "../.tmp-oracle");
// COARSE_RANGE は実機のシステム UI 帯オフセット(最大72px程度)まで届く値に
// する。粗探索の候補数は変えたくないので、STEP も比例して大きくした
// (441候補のまま: 50/5=10刻み → 100/10=同じ刻み数)。
const COARSE_STEP = 10;
const COARSE_RANGE = 100;
const FINE_RANGE = 5;

/**
 * Shift pixel array by (dx, dy) into a same-size canvas.
 * Pixels shifted outside bounds become transparent (0,0,0,0).
 */
function shiftPixels(srcPixels, width, height, dx, dy) {
  const dst = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcX = x - dx;
      const srcY = y - dy;
      if (srcX < 0 || srcX >= width || srcY < 0 || srcY >= height) continue;
      const srcIdx = (srcY * width + srcX) * 4;
      const dstIdx = (y * width + x) * 4;
      dst[dstIdx] = srcPixels[srcIdx];
      dst[dstIdx + 1] = srcPixels[srcIdx + 1];
      dst[dstIdx + 2] = srcPixels[srcIdx + 2];
      dst[dstIdx + 3] = srcPixels[srcIdx + 3];
    }
  }
  return dst;
}

/**
 * Count differing pixels between two RGBA Uint8ClampedArrays.
 * Uses pixelmatch with threshold=0.1 for speed.
 */
function countDiff(a, b, width, height) {
  const diff = new Uint8ClampedArray(width * height * 4);
  return pixelmatch(a, b, diff, width, height, { threshold: 0.1 });
}

/**
 * Detect translation offset between designPixels and screenshotPixels.
 * Phase 1: coarse search ±COARSE_RANGE in COARSE_STEP increments.
 * Phase 2: fine refinement ±FINE_RANGE around best coarse candidate.
 * Returns { dx, dy, diffAtBest, residualRate }.
 */
function detectTranslationCoarse(designPixels, screenshotPixels, width, height) {
  const totalPixels = width * height;
  let bestDx = 0;
  let bestDy = 0;
  let bestDiff = Infinity;

  // Coarse pass
  for (let dy = -COARSE_RANGE; dy <= COARSE_RANGE; dy += COARSE_STEP) {
    for (let dx = -COARSE_RANGE; dx <= COARSE_RANGE; dx += COARSE_STEP) {
      const shifted = shiftPixels(designPixels, width, height, dx, dy);
      const diff = countDiff(shifted, screenshotPixels, width, height);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestDx = dx;
        bestDy = dy;
      }
    }
  }

  // Fine pass around best coarse candidate
  const coarseBestDx = bestDx;
  const coarseBestDy = bestDy;
  for (let dy = coarseBestDy - FINE_RANGE; dy <= coarseBestDy + FINE_RANGE; dy++) {
    for (let dx = coarseBestDx - FINE_RANGE; dx <= coarseBestDx + FINE_RANGE; dx++) {
      const shifted = shiftPixels(designPixels, width, height, dx, dy);
      const diff = countDiff(shifted, screenshotPixels, width, height);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestDx = dx;
        bestDy = dy;
      }
    }
  }

  return {
    dx: bestDx,
    dy: bestDy,
    diffAtBest: bestDiff,
    residualRate: totalPixels === 0 ? 0 : bestDiff / totalPixels,
  };
}

/**
 * Load image file → Uint8ClampedArray (RGBA) + dimensions via Sharp.
 * When canvasWidth/canvasHeight are given and differ from the source image's
 * own dimensions, the image is padded (NOT scaled) into the top-left corner
 * of a canvasWidth x canvasHeight transparent canvas. This preserves absolute
 * pixel positions/scale — required because oracle-compare measures pixel-level
 * translation offsets, and resizing would distort that measurement.
 */
async function loadImage(filePath, canvasWidth, canvasHeight) {
  const img = sharp(filePath).ensureAlpha();
  const { width, height } = await img.metadata();

  if (
    canvasWidth != null &&
    canvasHeight != null &&
    (width !== canvasWidth || height !== canvasHeight)
  ) {
    const padded = await sharp(filePath)
      .ensureAlpha()
      .extend({
        top: 0,
        left: 0,
        right: Math.max(0, canvasWidth - width),
        bottom: Math.max(0, canvasHeight - height),
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .raw()
      .toBuffer();
    return {
      pixels: new Uint8ClampedArray(padded.buffer, padded.byteOffset, padded.byteLength),
      width: canvasWidth,
      height: canvasHeight,
      originalWidth: width,
      originalHeight: height,
    };
  }

  const rawBuf = await img.raw().toBuffer();
  return {
    pixels: new Uint8ClampedArray(rawBuf.buffer, rawBuf.byteOffset, rawBuf.byteLength),
    width,
    height,
    originalWidth: width,
    originalHeight: height,
  };
}

/**
 * 宣言済み ignore region を両方の画像で同じ値に潰し、その領域の差分を
 * 常にゼロ扱いにする。region 自体は expected.json に書かれた座標(検体作成者が
 * 独立に定めた値)をそのまま使う。FigDiff 側のマスク算出コードは一切呼ばない
 * ので、self-certify ban には抵触しない。
 */
function zeroIgnoreRegions(pixelsA, pixelsB, width, height, regions) {
  if (!regions || regions.length === 0) return 0;
  let maskedPixelCount = 0;
  for (const region of regions) {
    const left = Math.max(0, Math.floor(region.x));
    const top = Math.max(0, Math.floor(region.y));
    const right = Math.min(width, Math.ceil(region.x + region.width));
    const bottom = Math.min(height, Math.ceil(region.y + region.height));
    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        const idx = (y * width + x) * 4;
        pixelsA[idx] = pixelsB[idx] = 0;
        pixelsA[idx + 1] = pixelsB[idx + 1] = 0;
        pixelsA[idx + 2] = pixelsB[idx + 2] = 0;
        pixelsA[idx + 3] = pixelsB[idx + 3] = 0;
        maskedPixelCount++;
      }
    }
  }
  return maskedPixelCount;
}

/**
 * Save Uint8ClampedArray as PNG via Sharp.
 */
async function saveImage(pixels, width, height, outPath) {
  await sharp(Buffer.from(pixels), {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toFile(outPath);
}

/**
 * Build a simple gradient+white-rect test pattern as Uint8ClampedArray.
 */
function buildTestPattern(width, height) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const inRect = x >= 80 && x < 160 && y >= 60 && y < 140;
      if (inRect) {
        pixels[idx] = 255;
        pixels[idx + 1] = 255;
        pixels[idx + 2] = 255;
      } else {
        pixels[idx] = Math.floor((x / width) * 200);
        pixels[idx + 1] = Math.floor((y / height) * 180);
        pixels[idx + 2] = 100;
      }
      pixels[idx + 3] = 255;
    }
  }
  return pixels;
}

/**
 * Self-test: validates oracle logic without real Figma images.
 * Creates a synthetic pattern, shifts it by OFFSET_X,OFFSET_Y, and verifies:
 *   1. Same-image diff = 0
 *   2. Shifted diff > 0
 *   3. Detected offset is within 5px of actual
 *   4. Corrected (shift-back) diff is near 0 (≤2% of total pixels)
 */
async function selfTest() {
  const W = 400;
  const H = 300;
  const OFFSET_X = 10;
  const OFFSET_Y = 0;
  const THRESHOLD_PX = 5;
  const MAX_RESIDUAL = 0.02;

  await fs.mkdir(TMP_DIR, { recursive: true });

  const design = buildTestPattern(W, H);
  const shifted = shiftPixels(design, W, H, OFFSET_X, OFFSET_Y);

  const results = { width: W, height: H, actualOffset: { x: OFFSET_X, y: OFFSET_Y } };

  // Check 1: same image → diff = 0
  const sameDiff = countDiff(design, design, W, H);
  results.check1_same_diff_is_zero = sameDiff === 0;

  // Check 2: shifted image → diff > 0
  const shiftedDiff = countDiff(design, shifted, W, H);
  results.check2_shifted_diff_gt_zero = shiftedDiff > 0;
  results.shiftedDiffPixels = shiftedDiff;

  // Check 3: detection is within THRESHOLD_PX
  const detection = detectTranslationCoarse(design, shifted, W, H);
  results.detectedOffset = { x: detection.dx, y: detection.dy };
  results.diffAtBest = detection.diffAtBest;
  const errX = Math.abs(detection.dx - OFFSET_X);
  const errY = Math.abs(detection.dy - OFFSET_Y);
  results.check3_detection_within_5px = errX <= THRESHOLD_PX && errY <= THRESHOLD_PX;
  results.detectionError = { x: errX, y: errY };

  // Check 4: apply correction, diff should approach 0
  const corrected = shiftPixels(design, W, H, detection.dx, detection.dy);
  const correctedDiff = countDiff(corrected, shifted, W, H);
  const residualRate = correctedDiff / (W * H);
  results.check4_corrected_diff_near_zero = residualRate <= MAX_RESIDUAL;
  results.correctedDiffPixels = correctedDiff;
  results.residualRate = residualRate;

  // Save visual artifacts for inspection
  await saveImage(design, W, H, path.join(TMP_DIR, "self-test-design.png"));
  await saveImage(shifted, W, H, path.join(TMP_DIR, "self-test-shifted.png"));
  await saveImage(corrected, W, H, path.join(TMP_DIR, "self-test-corrected.png"));

  const allPass =
    results.check1_same_diff_is_zero &&
    results.check2_shifted_diff_gt_zero &&
    results.check3_detection_within_5px &&
    results.check4_corrected_diff_near_zero;

  results.overall = allPass ? "PASS" : "FAIL";
  return results;
}

/**
 * Compare two image files and write diff PNG.
 * Returns summary including detected translation and residual rate.
 *
 * ignoreRegions が渡されたら、その領域は比較の分母(comparablePixels)から除外する。
 * 除外しないと、マスク前提の検体(例: システム UI 帯)が常に大きな残差を持ってしまい、
 * 独立オラクルが正当な pass を fail と誤判定する。
 *
 * マスクは「位置合わせ後の画像」に対して座標そのまま適用する。位置合わせ前の
 * design にマスクを焼き込んでからズラすと、ズラした分だけマスクの影が本来
 * 塗りつぶされるべきでない行にズレて乗り、そこが偽の不一致として数えられて
 * しまう(baseline は無補正なので座標がズレず安全だが、corrected は補正で
 * 座標がズレるため、マスクは補正後に適用する必要がある)。
 */
async function compareFiles(designPath, screenshotPath, outDiffPath, ignoreRegions) {
  // Probe dimensions first so we know whether padding-normalization is needed.
  const [designMeta, screenshotMeta] = await Promise.all([
    sharp(designPath).metadata(),
    sharp(screenshotPath).metadata(),
  ]);
  const sizeMismatch =
    designMeta.width !== screenshotMeta.width || designMeta.height !== screenshotMeta.height;
  const canvasWidth = sizeMismatch ? Math.max(designMeta.width, screenshotMeta.width) : undefined;
  const canvasHeight = sizeMismatch
    ? Math.max(designMeta.height, screenshotMeta.height)
    : undefined;

  const design = await loadImage(designPath, canvasWidth, canvasHeight);
  const screenshot = await loadImage(screenshotPath, canvasWidth, canvasHeight);

  const { width, height } = design;
  if (width === 0 || height === 0) {
    throw new Error(`Zero-dimension image: width=${width}, height=${height}`);
  }

  // Baseline diff (no alignment) — マスクは座標がズレないここでだけ焼き込む。
  const baselineDesign = Uint8ClampedArray.from(design.pixels);
  const baselineScreenshot = Uint8ClampedArray.from(screenshot.pixels);
  const maskedPixelCount = zeroIgnoreRegions(
    baselineDesign,
    baselineScreenshot,
    width,
    height,
    ignoreRegions,
  );
  const comparablePixels = Math.max(1, width * height - maskedPixelCount);
  const baselineDiffPng = new Uint8ClampedArray(width * height * 4);
  const baselineDiffCount = pixelmatch(
    baselineDesign,
    baselineScreenshot,
    baselineDiffPng,
    width,
    height,
    { threshold: 0.1 },
  );

  // Detect translation — マスクの影響を受けないよう、無加工のピクセルで探す。
  const detection = detectTranslationCoarse(design.pixels, screenshot.pixels, width, height);

  // Apply correction, then mask in the now-shared (post-alignment) coordinate frame.
  const correctedDesign = shiftPixels(design.pixels, width, height, detection.dx, detection.dy);
  const correctedScreenshot = Uint8ClampedArray.from(screenshot.pixels);
  const correctedMaskedPixelCount = zeroIgnoreRegions(
    correctedDesign,
    correctedScreenshot,
    width,
    height,
    ignoreRegions,
  );
  const correctedComparablePixels = Math.max(1, width * height - correctedMaskedPixelCount);
  const correctedDiffPng = new Uint8ClampedArray(width * height * 4);
  const correctedDiffCount = pixelmatch(
    correctedDesign,
    correctedScreenshot,
    correctedDiffPng,
    width,
    height,
    { threshold: 0.1 },
  );

  if (outDiffPath) {
    await fs.mkdir(path.dirname(outDiffPath), { recursive: true });
    await saveImage(correctedDiffPng, width, height, outDiffPath);
  }

  return {
    width,
    height,
    sizeMismatch,
    designOriginalSize: { width: design.originalWidth, height: design.originalHeight },
    screenshotOriginalSize: { width: screenshot.originalWidth, height: screenshot.originalHeight },
    totalPixels: width * height,
    maskedPixelCount,
    comparablePixels,
    baselineDiffPixels: baselineDiffCount,
    baselineResidualRate: baselineDiffCount / comparablePixels,
    detectedOffset: { x: detection.dx, y: detection.dy },
    correctedMaskedPixelCount,
    correctedComparablePixels,
    correctedDiffPixels: correctedDiffCount,
    correctedResidualRate: correctedDiffCount / correctedComparablePixels,
    improvement: baselineDiffCount - correctedDiffCount,
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────

const [, , mode, ...args] = process.argv;

if (mode === "self-test" || !mode) {
  selfTest()
    .then((results) => {
      console.info(JSON.stringify(results, null, 2));
      process.exit(results.overall === "PASS" ? 0 : 1);
    })
    .catch((err) => {
      console.error("SELF-TEST ERROR:", err.message);
      process.exit(2);
    });
} else if (mode === "compare") {
  const [designPath, screenshotPath, outDiffPath, ignoreRegionsJson] = args;
  if (!designPath || !screenshotPath) {
    console.error(
      "Usage: oracle-compare.mjs compare <design> <screenshot> [out-diff] [ignore-regions-json]",
    );
    process.exit(1);
  }
  let ignoreRegions;
  if (ignoreRegionsJson) {
    try {
      ignoreRegions = JSON.parse(ignoreRegionsJson);
    } catch (err) {
      console.error("Invalid ignore-regions-json:", err.message);
      process.exit(1);
    }
  }
  compareFiles(designPath, screenshotPath, outDiffPath, ignoreRegions)
    .then((results) => {
      console.info(JSON.stringify(results, null, 2));
    })
    .catch((err) => {
      console.error("COMPARE ERROR:", err.message);
      process.exit(2);
    });
} else {
  console.error(`Unknown mode: ${mode}. Use 'self-test' or 'compare'.`);
  process.exit(1);
}

import { createHash } from "node:crypto";
import { open, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";
import { loadGate1Fixtures } from "./gate1-fixture.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = path.join(root, "verification/fixture");
const maxPixels = 4_000_000;
const maxEncodedBytes = 16 * 1024 * 1024;
sharp.concurrency(1);
sharp.cache(false);

/** @param {{data: Buffer, width: number, height: number}} image */
export const validateRgbImage = (image) => {
  if (
    !Buffer.isBuffer(image.data) ||
    !Number.isSafeInteger(image.width) ||
    !Number.isSafeInteger(image.height) ||
    image.width < 1 ||
    image.height < 1 ||
    image.width * image.height > maxPixels ||
    image.data.length !== image.width * image.height * 3
  ) {
    throw new Error("Invalid RGB image dimensions or buffer");
  }
};

/** @param {string} file */
const readBoundedPng = async (file) => {
  const handle = await open(file, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 8 || stat.size > maxEncodedBytes) {
      throw new Error(`${file}: PNG must be a regular file of 8..${maxEncodedBytes} bytes`);
    }
    // stat 後の肥大化でも無制限に読まない。余分な1バイトで読込中のサイズ変更も検出する。
    const encoded = Buffer.alloc(stat.size + 1);
    let total = 0;
    while (total < encoded.length) {
      const { bytesRead } = await handle.read(encoded, total, encoded.length - total, null);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total !== stat.size) throw new Error(`${file}: PNG changed during bounded read`);
    return encoded.subarray(0, total);
  } finally {
    await handle.close();
  }
};

/** @param {Buffer} png */
const validatePngEncoding = (png) => {
  if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error("Expected PNG signature");
  }
  let offset = 8;
  while (offset + 12 <= png.length) {
    const size = png.readUInt32BE(offset);
    const kind = png.toString("ascii", offset + 4, offset + 8);
    const end = offset + 12 + size;
    if (end > png.length || (offset === 8 && (kind !== "IHDR" || size !== 13))) {
      throw new Error("Invalid or truncated PNG structure");
    }
    // デコーダが先頭フレームだけ読む場合も、動画を静止検体として受け入れない。
    if (["acTL", "fcTL", "fdAT"].includes(kind)) throw new Error("Animated PNG is unsupported");
    if (kind === "IEND") {
      if (size !== 0 || end !== png.length) throw new Error("Invalid PNG end or trailing bytes");
      return;
    }
    offset = end;
  }
  throw new Error("Invalid or truncated PNG structure");
};

/** @param {string} file */
export const loadImage = async (file) => {
  const png = await readBoundedPng(file);
  validatePngEncoding(png);
  const image = sharp(png, { limitInputPixels: maxPixels, failOn: "error" });
  const metadata = await image.metadata();
  if (metadata.format !== "png" || (metadata.pages ?? 1) !== 1) {
    throw new Error(`${file}: expected single-frame PNG`);
  }
  const { data, info } = await image
    .toColourspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) throw new Error(`${file}: expected RGBA`);
  const rgb = Buffer.alloc(info.width * info.height * 3);
  for (let i = 0; i < info.width * info.height; i += 1) {
    if (data[i * 4 + 3] !== 255) throw new Error(`${file}: non-opaque pixel ${i}`);
    data.copy(rgb, i * 3, i * 4, i * 4 + 3);
  }
  const result = { data: rgb, width: info.width, height: info.height };
  validateRgbImage(result);
  return { ...result, sha256: createHash("sha256").update(png).digest("hex") };
};

/** @param {Buffer} a @param {number} i @param {Buffer} b @param {number} j */
const delta = (a, i, b, j) =>
  Math.max(Math.abs(a[i] - b[j]), Math.abs(a[i + 1] - b[j + 1]), Math.abs(a[i + 2] - b[j + 2]));

/** @param {{data: Buffer, width: number, height: number}} a
 * @param {{data: Buffer, width: number, height: number}} b
 * @param {number} x @param {number} y @param {number} radius @param {number} threshold */
const hasNearbyColour = (a, b, x, y, radius, threshold) => {
  const i = (y * a.width + x) * 3;
  for (let ny = Math.max(0, y - radius); ny <= Math.min(b.height - 1, y + radius); ny += 1) {
    for (let nx = Math.max(0, x - radius); nx <= Math.min(b.width - 1, x + radius); nx += 1) {
      if (delta(a.data, i, b.data, (ny * b.width + nx) * 3) <= threshold) return true;
    }
  }
  return false;
};

/** @param {{data: Buffer, width: number, height: number}} a
 * @param {{data: Buffer, width: number, height: number}} b
 * @param {number} radius @param {number} threshold */
const unexplainedRatio = (a, b, radius, threshold) => {
  let unexplained = 0;
  for (let y = 0; y < a.height; y += 1) {
    for (let x = 0; x < a.width; x += 1) {
      const found = hasNearbyColour(a, b, x, y, radius, threshold);
      if (!found) unexplained += 1;
    }
  }
  return unexplained / (a.width * a.height);
};

/** @param {{data: Buffer, width: number, height: number}} a
 * @param {{data: Buffer, width: number, height: number}} b */
export const measurePixels = (a, b) => {
  validateRgbImage(a);
  validateRgbImage(b);
  const dimensionsMatch = a.width === b.width && a.height === b.height;
  // 寸法不一致を差分率 1 と呼ぶと実測値と混ざるので、旧 runner の代用値を別に保存する。
  if (!dimensionsMatch) return { dimensionsMatch, legacyRunnerRatio: 1, metrics: null };
  const thresholds = [0, 10, 20, 40, 80, 160];
  const counts = thresholds.map(() => 0);
  const tileColumns = Math.ceil(a.width / 32);
  const tiles = new Uint32Array(tileColumns * Math.ceil(a.height / 32));
  const histogram = new Uint32Array(256);
  let absoluteChannelSum = 0;
  let signedLumaSum = 0;
  for (let i = 0; i < a.width * a.height; i += 1) {
    const d = delta(a.data, i * 3, b.data, i * 3);
    histogram[d] += 1;
    for (let t = 0; t < thresholds.length; t += 1) {
      if (d > thresholds[t]) counts[t] += 1;
    }
    for (let c = 0; c < 3; c += 1) {
      const signed = a.data[i * 3 + c] - b.data[i * 3 + c];
      absoluteChannelSum += Math.abs(signed);
      signedLumaSum += signed;
    }
    if (d > 40) {
      const x = i % a.width;
      const y = Math.floor(i / a.width);
      tiles[Math.floor(y / 32) * tileColumns + Math.floor(x / 32)] += 1;
    }
  }
  let maxTileRatio = 0;
  for (let i = 0; i < tiles.length; i += 1) {
    const x = (i % tileColumns) * 32;
    const y = Math.floor(i / tileColumns) * 32;
    const area = Math.min(32, a.width - x) * Math.min(32, a.height - y);
    maxTileRatio = Math.max(maxTileRatio, tiles[i] / area);
  }
  const total = a.width * a.height;
  return {
    dimensionsMatch,
    legacyRunnerRatio: counts[3] / total,
    metrics: {
      pixelCount: total,
      ratios: Object.fromEntries(thresholds.map((t, i) => [String(t), counts[i] / total])),
      deltaHistogram: Array.from(histogram),
      meanAbsoluteChannelDelta: absoluteChannelSum / (total * 3),
      meanSignedChannelDelta: signedLumaSum / (total * 3),
      maxTile32Ratio: maxTileRatio,
      // 双方向を取らないと片側の線の欠落や膨張だけが近傍で説明されてしまう。
      symmetricUnexplained1pxRatio: Math.max(
        unexplainedRatio(a, b, 1, 40),
        unexplainedRatio(b, a, 1, 40),
      ),
    },
  };
};

/** @param {{metrics: ReturnType<typeof measurePixels>["metrics"]}[]} rows
 * @param {(metrics: NonNullable<ReturnType<typeof measurePixels>["metrics"]>) => number} value */
const range = (rows, value) => {
  const values = rows.flatMap((row) => (row.metrics ? [value(row.metrics)] : []));
  if (values.length === 0) throw new Error("Empty measurement group");
  return { min: Math.min(...values), max: Math.max(...values), comparableCount: values.length };
};

export const runMeasurement = async () => {
  const { definitionSha256, fixtures } = await loadGate1Fixtures(fixtureRoot);
  const rows = [];
  const inputs = [];
  for (const { directory: dir, group, expectation, expectedSha256 } of fixtures) {
    const reference = await loadImage(path.join(fixtureRoot, dir, expectation.figmaFrame));
    const correct = await loadImage(path.join(fixtureRoot, dir, "impl-correct.png"));
    inputs.push({
      pairId: dir,
      expectedSha256,
    });
    for (const variant of expectation.variants) {
      const image = await loadImage(path.join(fixtureRoot, dir, variant.image));
      for (const { against, base } of [
        { against: "figma", base: reference },
        { against: "correct", base: correct },
      ]) {
        rows.push({
          pairId: dir,
          group,
          variant: variant.name,
          expectedVerdict: variant.expectedVerdict,
          knownRedIssue: variant.knownRedIssue,
          against,
          image: {
            file: variant.image,
            width: image.width,
            height: image.height,
            sha256: image.sha256,
          },
          reference: { width: base.width, height: base.height, sha256: base.sha256 },
          ...measurePixels(image, base),
        });
      }
    }
  }
  if (rows.length !== 66)
    throw new Error(`Expected 33 variants × 2 references, found ${rows.length}`);
  const baseline = rows.filter((r) => r.variant === "correct" && r.against === "figma");
  /** @type {Record<string, {pass: ReturnType<typeof range>, fail: ReturnType<typeof range>, gap: number, separated: boolean}>} */
  const summaries = {};
  /** @type {Record<string, (metrics: NonNullable<ReturnType<typeof measurePixels>["metrics"]>) => number>} */
  const selectors = {
    rawAbove10: (m) => m.ratios["10"],
    rawAbove20: (m) => m.ratios["20"],
    rawAbove80: (m) => m.ratios["80"],
    rawAbove160: (m) => m.ratios["160"],
    rawAbove40: (m) => m.ratios["40"],
    exactNonzero: (m) => m.ratios["0"],
    maxTile32: (m) => m.maxTile32Ratio,
    symmetricUnexplained1px: (m) => m.symmetricUnexplained1pxRatio,
  };
  for (const [name, selector] of Object.entries(selectors)) {
    const pass = range(
      baseline.filter((r) => r.group === "pass"),
      selector,
    );
    const fail = range(
      baseline.filter((r) => r.group === "fail"),
      selector,
    );
    summaries[name] = { pass, fail, gap: fail.min - pass.max, separated: fail.min > pass.max };
  }
  return {
    definitionSha256,
    inputs,
    summaries,
    dimensionMismatches: baseline.filter((r) => !r.dimensionsMatch).map((r) => r.pairId),
    rows,
  };
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const output = process.argv[2];
  if (!output)
    throw new Error("Usage: node verification/script/measure-gate1-oracle.mjs OUTPUT.json");
  const result = await runMeasurement();
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
  console.info(
    JSON.stringify({
      summaries: result.summaries,
      dimensionMismatches: result.dimensionMismatches,
    }),
  );
}

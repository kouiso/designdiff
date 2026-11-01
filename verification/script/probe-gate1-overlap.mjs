import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadGate1Fixtures } from "./gate1-fixture.mjs";
import { loadImage, validateRgbImage } from "./measure-gate1-oracle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** @param {{data: Buffer, width: number, height: number}} a */
const profile = (a) => {
  const rows = new Float64Array(a.height);
  for (let y = 0; y < a.height; y += 1) {
    let ink = 0;
    for (let x = 0; x < a.width; x += 1) {
      const i = (y * a.width + x) * 3;
      if (a.data[i] + a.data[i + 1] + a.data[i + 2] < 600) ink += 1;
    }
    rows[y] = ink / a.width;
  }
  return rows;
};

/** @param {{data: Buffer, width: number, height: number}} a
 * @param {{data: Buffer, width: number, height: number}} b
 * @param {number} start @param {number} end @param {number} shift */
const shiftedRawRatio = (a, b, start, end, shift) => {
  let changed = 0;
  for (let y = start; y < end; y += 1) {
    for (let x = 0; x < a.width; x += 1) {
      const i = (y * a.width + x) * 3;
      const j = ((y + shift) * b.width + x) * 3;
      let d = 0;
      for (let c = 0; c < 3; c += 1) d = Math.max(d, Math.abs(a.data[i + c] - b.data[j + c]));
      if (d > 40) changed += 1;
    }
  }
  return changed / ((end - start) * a.width);
};

/** @param {{data: Buffer, width: number, height: number}} a
 * @param {number} x @param {number} y */
const onEdge = (a, x, y) => {
  const i = (y * a.width + x) * 3;
  for (let ny = Math.max(0, y - 1); ny <= Math.min(a.height - 1, y + 1); ny += 1) {
    for (let nx = Math.max(0, x - 1); nx <= Math.min(a.width - 1, x + 1); nx += 1) {
      const j = (ny * a.width + nx) * 3;
      for (let c = 0; c < 3; c += 1) {
        if (Math.abs(a.data[i + c] - a.data[j + c]) > 40) return true;
      }
    }
  }
  return false;
};

/** @param {{data: Buffer, width: number, height: number}} a
 * @param {{data: Buffer, width: number, height: number}} b */
export const probeOverlap = (a, b) => {
  validateRgbImage(a);
  validateRgbImage(b);
  if (a.width !== b.width || a.height !== b.height) throw new Error("Dimension mismatch");
  if (a.height < 161) throw new Error("Invalid probe image: height must exceed 160px");
  let changed = 0;
  let edgeAssociated = 0;
  let neutralChange = 0;
  for (let y = 0; y < a.height; y += 1) {
    for (let x = 0; x < a.width; x += 1) {
      const i = (y * a.width + x) * 3;
      const signed = [0, 1, 2].map((c) => a.data[i + c] - b.data[i + c]);
      if (Math.max(...signed.map(Math.abs)) <= 40) continue;
      changed += 1;
      if (onEdge(a, x, y) || onEdge(b, x, y)) edgeAssociated += 1;
      if (Math.max(...signed) - Math.min(...signed) <= 20) neutralChange += 1;
    }
  }
  const ap = profile(a);
  const bp = profile(b);
  const bands = [];
  // 全候補に同じ画素領域を用い、端の切り捨て量でシフトが有利になることを避ける。
  for (let start = 80; start < a.height - 80; start += 128) {
    const end = Math.min(start + 128, a.height - 80);
    const candidates = [];
    for (let shift = -80; shift <= 80; shift += 1) {
      let sum = 0;
      for (let y = start; y < end; y += 1) sum += Math.abs(ap[y] - bp[y + shift]);
      candidates.push({ shift, profileMeanAbsoluteError: sum / (end - start) });
    }
    candidates.sort(
      (l, r) =>
        l.profileMeanAbsoluteError - r.profileMeanAbsoluteError ||
        Math.abs(l.shift) - Math.abs(r.shift),
    );
    const best = candidates[0];
    bands.push({
      start,
      end,
      ...best,
      zeroShiftProfileError: candidates.find((c) => c.shift === 0)?.profileMeanAbsoluteError,
      rawAtZero: shiftedRawRatio(a, b, start, end, 0),
      rawAtProfileBest: shiftedRawRatio(a, b, start, end, best.shift),
      tiedBestCount: candidates.filter(
        (c) => Math.abs(c.profileMeanAbsoluteError - best.profileMeanAbsoluteError) < 1e-12,
      ).length,
    });
  }
  return {
    changedPixels: changed,
    edgeAssociatedFraction: changed === 0 ? null : edgeAssociated / changed,
    neutralChannelChangeFraction: changed === 0 ? null : neutralChange / changed,
    bands,
  };
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const output = process.argv[2];
  if (!output)
    throw new Error("Usage: node verification/script/probe-gate1-overlap.mjs OUTPUT.json");
  const fixtureRoot = path.join(root, "verification/fixture");
  const rows = [];
  const { fixtures, definitionSha256 } = await loadGate1Fixtures(fixtureRoot);
  for (const { directory: dir, expectation: expected } of fixtures) {
    const a = await loadImage(path.join(fixtureRoot, dir, expected.figmaFrame));
    const b = await loadImage(path.join(fixtureRoot, dir, "impl-correct.png"));
    rows.push({
      pairId: dir,
      expectedVerdict: expected.variants.find((v) => v.name === "correct")?.expectedVerdict,
      dimensions: { figma: [a.width, a.height], correct: [b.width, b.height] },
      imageSha256: { figma: a.sha256, correct: b.sha256 },
      probe: a.width === b.width && a.height === b.height ? probeOverlap(a, b) : null,
    });
  }
  if (rows.length !== 18) throw new Error(`Expected 18 pairs, found ${rows.length}`);
  await writeFile(
    output,
    `${JSON.stringify({ definitionSha256, method: "Diagnostic only. Fixed max-channel delta>40, edge radius1, neutral signed-channel spread<=20, row ink sumRGB<600. Fixed 128px bands, all integer shifts +/-80, common interior rows. Profile-best shifts do not change labels, thresholds, or product comparison.", rows }, null, 2)}\n`,
    { flag: "wx" },
  );
  console.info(`Measured ${rows.length} pairs`);
}

// band-eval v2: 期待判定は band-eval-expectations.md に実装非依存で事前登録済み。
// 入口は compareImages (pixelmatch → クラスタ → buildDiffReport の実パイプライン)、
// Figma ノード木なし = PNG 経路。各ケースを「無関係diff なし/あり」で実行し、
// 最終判定 (status) と期待を別々に記録する。
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const require = createRequire("/home/factory-user/dd-figma-path/app/mcp-server/package.json");
const sharp = require("sharp");
const { compareImages } = await import(
  pathToFileURL("/home/factory-user/dd-figma-path/app/mcp-server/dist/service/image-compare-service.js").href
);

const SIZE = 120;
const WHITE = [255, 255, 255];
const MINT = [0xef, 0xf8, 0xf2];
const GRAY = [0xf7, 0xf7, 0xf7];
const DARK = [0x33, 0x33, 0x33];

const solid = (rgb) => {
  // clamp させるため Uint8ClampedArray で生成する (Buffer への += は
  // mod 256 で回り、255+1 が黒に化けて対照ケースを壊した)。
  const px = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i += 1) {
    px[i * 4] = rgb[0];
    px[i * 4 + 1] = rgb[1];
    px[i * 4 + 2] = rgb[2];
    px[i * 4 + 3] = 255;
  }
  return px;
};
const paintRect = (px, x, y, w, h, rgb) => {
  for (let yy = y; yy < y + h; yy += 1)
    for (let xx = x; xx < x + w; xx += 1) {
      const i = (yy * SIZE + xx) * 4;
      px[i] = rgb[0];
      px[i + 1] = rgb[1];
      px[i + 2] = rgb[2];
    }
};
// 無関係diff: 1px の濃灰線が 2px 平行移動 (y30→32, 両側 30px 幅)
const addUnrelatedDiff = (design, shot) => {
  paintRect(design, 10, 30, 30, 1, DARK);
  paintRect(shot, 10, 32, 30, 1, DARK);
};

// 変異定義 (design/shot を生成して返す)
const band = (y, h) => () => {
  const d = solid(WHITE);
  const s = solid(WHITE);
  paintRect(d, 0, y, SIZE, h, MINT);
  paintRect(s, 0, y, SIZE, h, GRAY);
  return [d, s];
};
const MUTATIONS = {
  "band-top": band(0, 15),
  "band-middle": band(52, 15),
  "band-bottom": band(105, 15),
  straddle: band(100, 15),
  "straddle-thin": band(101, 8),
  "narrow-7": band(106, 7),
  "narrow-3": band(106, 3),
  "wide-30": band(90, 30),
  "block-40x40": () => {
    const d = solid(WHITE);
    const s = solid(WHITE);
    paintRect(d, 40, 40, 40, 40, MINT);
    paintRect(s, 40, 40, 40, 40, GRAY);
    return [d, s];
  },
  "vstripe-8": () => {
    const d = solid(WHITE);
    const s = solid(WHITE);
    paintRect(d, 60, 0, 8, SIZE, MINT);
    paintRect(s, 60, 0, 8, SIZE, GRAY);
    return [d, s];
  },
  "uniform-1.5": () => [solid(WHITE), solid([0xfa, 0xfa, 0xfa])],
  "gradient-ramp": () => {
    const d = solid(WHITE);
    const s = solid(WHITE);
    for (let y = 0; y < SIZE; y += 1) {
      const t = y / SIZE;
      paintRect(d, 0, y, SIZE, 1, [255 - 16 * t, 255 - 7 * t, 255 - 13 * t].map(Math.round));
      paintRect(s, 0, y, SIZE, 1, [255 - 13 * t, 255 - 6 * t, 255 - 11 * t].map(Math.round));
    }
    return [d, s];
  },
  "aa-dither": () => {
    const d = solid(WHITE);
    const s = solid(WHITE);
    for (let y = 0; y < SIZE; y += 1)
      for (let x = 0; x < SIZE; x += 1) {
        if ((x * 7 + y * 13) % 3 === 0) continue;
        const i = (y * SIZE + x) * 4;
        const delta = ((x + y) % 2) * 2 - 1;
        s[i] += delta;
        s[i + 1] += delta;
        s[i + 2] += delta;
      }
    return [d, s];
  },
  "photo-noise": () => {
    const d = solid(WHITE);
    const s = solid(WHITE);
    for (let y = 0; y < SIZE; y += 1)
      for (let x = 0; x < SIZE; x += 1) {
        const n = ((x * 31 + y * 17) % 7) - 3;
        const i = (y * SIZE + x) * 4;
        s[i] -= n;
        s[i + 1] -= n;
        s[i + 2] -= n;
      }
    return [d, s];
  },
  "sanity-displacement-only": () => [solid(WHITE), solid(WHITE)],
  "sanity-identical": () => [solid(WHITE), solid(WHITE)],
};

// 期待 (band-eval-expectations.md と一致。実装式ではなく知覚根拠で固定)
const EXPECT_FAIL = new Set([
  "band-top", "band-middle", "band-bottom", "straddle", "straddle-thin",
  "narrow-7", "narrow-3", "wide-30", "block-40x40", "vstripe-8",
]);
const EXPECT_PASS = new Set([
  "uniform-1.5", "gradient-ramp", "aa-dither", "photo-noise",
  "sanity-displacement-only", "sanity-identical",
]);

const toPng = (raw) =>
  sharp(raw, { raw: { width: SIZE, height: SIZE, channels: 4 } }).png().toBuffer();

delete process.env.DD_DUMP_DIR;
const rows = [];
for (const [name, make] of Object.entries(MUTATIONS)) {
  for (const withUnrelated of name.startsWith("sanity-")
    ? [name === "sanity-identical" ? false : true]
    : [false, true]) {
    const [d0, s0] = make();
    const d = new Uint8ClampedArray(d0);
    const s = new Uint8ClampedArray(s0);
    if (withUnrelated) addUnrelatedDiff(d, s);
    const [dp, sp] = await Promise.all([
      toPng(Buffer.from(d.buffer, d.byteOffset, d.byteLength)),
      toPng(Buffer.from(s.buffer, s.byteOffset, s.byteLength)),
    ]);
    const result = await compareImages({
      designBase64: dp.toString("base64"),
      screenshotBase64: sp.toString("base64"),
      threshold: 0.1,
      rasterizationTolerance: true,
    });
    const expected = EXPECT_FAIL.has(name) ? "FAIL" : "PASS";
    // compareImages は通常 status を返さない。最終判定は diffReport の
    // aggregateVerdict (pass/fail/inconclusive) を使う。
    const agg = result.diffReport?.aggregateVerdict;
    const status =
      result.status ?? (agg === "pass" ? "PASS" : agg === "fail" ? "FAIL" : "UNCERTAIN");
    const signals = (result.diffReport?.issues ?? [])
      .filter((i) => i.severity === "critical")
      .map((i) => `${i.evidence?.signal ?? i.message}=${i.evidence?.actual ?? ""}`);
    let cls;
    if (status === "UNCERTAIN") {
      cls = "undetermined";
    } else if (expected === "FAIL") {
      cls = status === "FAIL" ? "hit" : "MISS";
    } else {
      cls = status === "PASS" ? "correct-pass" : "FALSE-ALARM";
    }
    rows.push({
      case: name,
      unrelatedDiff: withUnrelated,
      expected,
      observedStatus: status,
      aggregateVerdict: result.diffReport?.aggregateVerdict,
      diffPixelCount: result.diffPixelCount,
      diffRegionCount: result.diffRegions?.length ?? 0,
      criticalSignals: signals,
      classification: cls,
    });
    console.log(
      `${cls.padEnd(12)} expect=${expected} got=${status} ` +
        `pm=${result.diffPixelCount} regions=${result.diffRegions?.length ?? 0} ` +
        `${name}${withUnrelated ? " +unrelated" : " (no unrelated)"} ` +
        `${signals.length ? signals.join(",") : ""}`,
    );
  }
}
const tally = {};
for (const r of rows) tally[r.classification] = (tally[r.classification] ?? 0) + 1;
console.log("\ntally:", JSON.stringify(tally));
await writeFile("/tmp/dd-live-run/band-eval2.json", JSON.stringify(rows, null, 2));

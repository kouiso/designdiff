// Acceptance check: is the 8-band max-mean residual overfit to 9949-23513?
// Every case carries an INDEPENDENT, pre-registered expectation decided from
// the geometry alone (rule: a broad colour drift with band-mean dE2000 >= 2
// over >=1/8 of the content height should fail; anything below that or tiny
// in area should not). We then observe whether the implementation emits a
// critical residual_color_drift issue, and score miss / false-alarm against
// OUR expectation, never the other way round.
import { pathToFileURL } from "node:url";

const { buildDiffReport } = await import(
  pathToFileURL(
    "/home/factory-user/dd-figma-path/app/mcp-server/dist/service/diff-report-builder.js",
  ).href
);

const SIZE = 120;
const WHITE = [255, 255, 255];
const MINT = [0xef, 0xf8, 0xf2]; // design gradient bottom stop (#EFF8F2)
const GRAY = [0xf7, 0xf7, 0xf7]; // implemented as flat neutral gray
const DARK = [0x33, 0x33, 0x33];

const solid = (rgb) => {
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
// A benign, explained displacement cluster so the residual path runs, placed
// far from the drift areas (y=30..32).
const withBenignCluster = (design, screenshot) => {
  paintRect(design, 10, 30, 30, 1, DARK);
  paintRect(screenshot, 10, 32, 30, 1, DARK);
  return [
    { x: 10, y: 30, w: 30, h: 1, diffPixelCount: 30 },
    { x: 10, y: 32, w: 30, h: 1, diffPixelCount: 30 },
  ];
};

const cases = [];
const add = (name, expectFire, build, note) => cases.push({ name, expectFire, build, note });

// --- drift band position (all full width, 15px = 1/8 height, dE ~5) ---
for (const [name, y] of [
  ["band-top y0-15", 0],
  ["band-middle y52-67", 52],
  ["band-bottom y105-120 (9949-23513 shape)", 105],
]) {
  add(name, true, () => {
    const d = solid(WHITE);
    const s = solid(WHITE);
    paintRect(d, 0, y, SIZE, 15, MINT);
    paintRect(s, 0, y, SIZE, 15, GRAY);
    return [d, s];
  });
}
// --- band straddling a band boundary (boundary at y=105) ---
add("straddle y100-115 (5 rows in band6, 10 in band7)", true, () => {
  // band7 mean = (10*5.2 + 5*0)/15 = 3.5 >= 2
  const d = solid(WHITE);
  const s = solid(WHITE);
  paintRect(d, 0, 100, SIZE, 15, MINT);
  paintRect(s, 0, 100, SIZE, 15, GRAY);
  return [d, s];
});
add("straddle-thin y101-109 (4 rows each side)", false, () => {
  // both bands dilute to (4*5.2)/15 = 1.4 < 2 -> documented miss zone
  const d = solid(WHITE);
  const s = solid(WHITE);
  paintRect(d, 0, 101, SIZE, 8, MINT);
  paintRect(s, 0, 101, SIZE, 8, GRAY);
  return [d, s];
});
// --- narrower / wider ---
add("narrow 7-row band y106-113", true, () => {
  // band7 mean = (7*5.2)/15 = 2.4 >= 2
  const d = solid(WHITE);
  const s = solid(WHITE);
  paintRect(d, 0, 106, SIZE, 7, MINT);
  paintRect(s, 0, 106, SIZE, 7, GRAY);
  return [d, s];
});
add("very narrow 3-row band y106-109", false, () => {
  // (3*5.2)/15 = 1.0 < 2 -> documented miss zone
  const d = solid(WHITE);
  const s = solid(WHITE);
  paintRect(d, 0, 106, SIZE, 3, MINT);
  paintRect(s, 0, 106, SIZE, 3, GRAY);
  return [d, s];
});
add("wide double band y90-120", true, () => {
  const d = solid(WHITE);
  const s = solid(WHITE);
  paintRect(d, 0, 90, SIZE, 30, MINT);
  paintRect(s, 0, 90, SIZE, 30, GRAY);
  return [d, s];
});
// --- localized region ---
add("local 40x40 block at center, dE5", false, () => {
  // 幾何からの事前計算: 40x40 は高さ15の帯に最大 40*15 画素乗るので帯平均は
  // (40*15*5.2)/(120*15) = 1.73 < 2。事前登録ルールにより期待は quiet。
  // 局所差分は pixelmatch/クラスタ採点の責務で、残差の責務ではない。
  // (初回登録時に誤って fire 期待にしていたが、ルールとこの幾何計算に
  // 反するため quiet に訂正 = 実装出力への追随ではない)
  const d = solid(WHITE);
  const s = solid(WHITE);
  paintRect(d, 40, 40, 40, 40, MINT);
  paintRect(s, 40, 40, 40, 40, GRAY);
  return [d, s];
});
add("local 40x40 block + same block marked as explained diff cluster", false, () => {
  // when pixelmatch DID catch the local block, its pixels are masked out of
  // the residual; the residual must stay quiet and leave the verdict to
  // cluster scoring.
  const d = solid(WHITE);
  const s = solid(WHITE);
  paintRect(d, 40, 40, 40, 40, MINT);
  paintRect(s, 40, 40, 40, 40, GRAY);
  return [d, s, [{ x: 40, y: 40, w: 40, h: 40, diffPixelCount: 1600 }]];
});
// --- vertical stripe (banding is horizontal) ---
add("vertical stripe 8px wide full height, dE5", false, () => {
  // every band: (8/120)*5.2 = 0.35 < 2 -> documented limitation
  const d = solid(WHITE);
  const s = solid(WHITE);
  paintRect(d, 60, 0, 8, SIZE, MINT);
  paintRect(s, 60, 0, 8, SIZE, GRAY);
  return [d, s];
});
// --- controls that must NOT fire ---
add("control: uniform tiny drift dE~1.5 everywhere", false, () => {
  const d = solid(WHITE);
  const s = solid([0xfa, 0xfa, 0xfa]);
  return [d, s];
});
add("control: natural gradient, slightly different ramp", false, () => {
  const d = solid(WHITE);
  const s = solid(WHITE);
  for (let y = 0; y < SIZE; y += 1) {
    const t = y / SIZE;
    paintRect(d, 0, y, SIZE, 1, [255 - 16 * t, 255 - 7 * t, 255 - 13 * t].map(Math.round));
    paintRect(s, 0, y, SIZE, 1, [255 - 13 * t, 255 - 6 * t, 255 - 11 * t].map(Math.round));
  }
  return [d, s];
});
add("control: AA-like +/-1 dither noise", false, () => {
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
});
add("control: photo-like subtle texture noise +/-3", false, () => {
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
});
// --- unrelated extra diff must not change the band verdict ---
add("bottom band + extra unrelated explained diff", true, () => {
  const d = solid(WHITE);
  const s = solid(WHITE);
  paintRect(d, 0, 105, SIZE, 15, MINT);
  paintRect(s, 0, 105, SIZE, 15, GRAY);
  paintRect(d, 60, 70, 20, 1, DARK);
  paintRect(s, 60, 72, 20, 1, DARK);
  return [
    d,
    s,
    [
      { x: 60, y: 70, w: 20, h: 1, diffPixelCount: 20 },
      { x: 60, y: 72, w: 20, h: 1, diffPixelCount: 20 },
    ],
  ];
});

delete process.env.DD_DUMP_DIR;
let misses = 0;
let falseAlarms = 0;
const rows = [];
for (const c of cases) {
  const [d, s, extraRegions] = c.build();
  const clusters = withBenignCluster(d, s);
  const diffRegions = [...clusters, ...(extraRegions ?? [])];
  const report = buildDiffReport({
    designPixels: d,
    screenshotPixels: s,
    width: SIZE,
    height: SIZE,
    diffRegions,
    rasterizationTolerance: true,
  });
  const fired = report.issues.some(
    (i) => i.severity === "critical" && i.evidence?.signal === "residual_color_drift",
  );
  const ok = fired === c.expectFire;
  if (!ok && c.expectFire) misses += 1;
  if (!ok && !c.expectFire) falseAlarms += 1;
  rows.push({ name: c.name, expected: c.expectFire, fired, ok });
  console.info(
    `${ok ? "OK  " : "BAD "} expect=${c.expectFire ? "fire" : "quiet"} fired=${fired}  ${c.name}`,
  );
}
console.info(`\nmisses(expected fire, stayed quiet): ${misses}`);
console.info(`false alarms(expected quiet, fired): ${falseAlarms}`);
await import("node:fs/promises").then(({ writeFile }) =>
  writeFile("/tmp/dd-live-run/band-eval.json", JSON.stringify(rows, null, 2)),
);

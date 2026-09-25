// C01–C13 比較正確性の desktop 面検証。実 Electron アプリを起動し、
// 実 UI 操作 (フレーム選択 → 実装スクリーンショット投入 → 差分を検出)
// で流し、DOM に出た matchRate・diffPixels・領域 bbox・エラー表示を
// 独立 oracle として証跡へ記録する。
// C07 (除外領域) は native-ignore-region.mjs が実 UI 編集込みで検証済み
// のためここでは扱わない。C09 は figma 経路を要するため、第2起動で
// fetch 境界を合成した専用 bootstrap により非表示/可視ノードを切り分ける。

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, "../../..");
const requireFromDesktop = createRequire(join(repository, "app/desktop/package.json"));
const { _electron: electron } = requireFromDesktop("playwright/test");
const requireSharp = createRequire(join(repository, "app/mcp-server/package.json"));
const sharp = requireSharp("sharp");

const evidenceDir = process.argv[2] ? resolve(process.argv[2]) : undefined;
if (!evidenceDir) throw new Error("evidence dir argument is required");
await mkdir(evidenceDir, { recursive: true });

const sandbox = await mkdtemp(join(tmpdir(), "figdiff-c-cases-"));
const isolatedHome = join(sandbox, "home");
const userData = join(sandbox, "user-data");
const figdiffHome = join(sandbox, "figdiff-home");
const projectsDirectory = join(sandbox, "projects");
const fixtureDir = join(isolatedHome, "fixtures");
await mkdir(isolatedHome, { recursive: true });
await mkdir(userData, { recursive: true });
await mkdir(figdiffHome, { recursive: true });
await mkdir(join(projectsDirectory, "c-cases"), { recursive: true });
await mkdir(fixtureDir, { recursive: true });

// ---------- fixture 生成 ----------

const basePixel = (x, y) => [(x * 7) % 256, (y * 5) % 256, ((x + y) * 3) % 256, 255];
const makePng = async (name, w, h, paint) => {
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = paint(x, y);
      const i = (y * w + x) * 4;
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      buf[i + 3] = a;
    }
  }
  const path = join(fixtureDir, name);
  await sharp(buf, { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toFile(path);
  return path;
};

const W = 120;
const H = 80;
const shifted = (dx, dy) => (x, y) => {
  const sx = x - dx;
  const sy = y - dy;
  return sx >= 0 && sx < W && sy >= 0 && sy < H ? basePixel(sx, sy) : [0, 0, 0, 255];
};
const DEFECT = { x: 30, y: 20, w: 24, h: 16 };
const withDefect =
  (paint, rect, color = [255, 0, 0, 255]) =>
  (x, y) =>
    x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h ? color : paint(x, y);

const paths = {};
paths.base = await makePng("design-base.png", W, H, basePixel);
paths.implIdentical = paths.base;
paths.shiftE1 = await makePng("impl-shift-e1.png", W, H, shifted(1, 0));
paths.shiftE2 = await makePng("impl-shift-e2.png", W, H, shifted(2, 0));
paths.shiftS1 = await makePng("impl-shift-s1.png", W, H, shifted(0, 1));
paths.shiftW2 = await makePng("impl-shift-w2.png", W, H, shifted(-2, 0));
paths.implDefect = await makePng("impl-defect.png", W, H, withDefect(basePixel, DEFECT));
paths.design2x = await makePng("design-2x.png", W * 2, H * 2, (x, y) => basePixel(x >> 1, y >> 1));
paths.impl2x = await makePng("impl-2x.png", W * 2, H * 2, (x, y) => basePixel(x >> 1, y >> 1));
paths.design3x = await makePng("design-3x.png", W * 3, H * 3, (x, y) =>
  basePixel((x / 3) | 0, (y / 3) | 0),
);
paths.impl3x = await makePng("impl-3x.png", W * 3, H * 3, (x, y) =>
  basePixel((x / 3) | 0, (y / 3) | 0),
);
paths.implPadded = await makePng("impl-padded.png", 140, 100, (x, y) =>
  x >= 10 && x < 130 && y >= 10 && y < 90 ? basePixel(x - 10, y - 10) : [255, 255, 255, 255],
);
paths.implWide = await makePng("impl-wide.png", 140, 80, (x, y) =>
  basePixel(((x * W) / 140) | 0, y),
);
paths.implTall = await makePng("impl-tall.png", 120, 100, (x, y) =>
  y < H ? basePixel(x, y) : [0, 0, 0, 255],
);
// C06: crop 内と外に1個ずつ欠陥。内側 (40,30,12x10)、外側 (100,8,12x10)。
const CROP = { x: 20, y: 15, w: 60, h: 40 };
const INNER = { x: 40, y: 30, w: 12, h: 10 };
const OUTER = { x: 100, y: 8, w: 12, h: 10 };
paths.implTwoDefects = await makePng(
  "impl-two-defects.png",
  W,
  H,
  withDefect(withDefect(basePixel, INNER), OUTER, [255, 0, 255, 255]),
);
// C08: 透明背景 + 不透明矩形。同じ内容を白合成した impl と、alpha 同一の impl。
const alphaPaint = (x, y) =>
  x >= 40 && x < 80 && y >= 25 && y < 55 ? [20, 120, 220, 255] : [0, 0, 0, 0];
paths.designAlpha = await makePng("design-alpha.png", W, H, alphaPaint);
paths.implAlphaOnWhite = await makePng("impl-alpha-onwhite.png", W, H, (x, y) => {
  const [r, g, b, a] = alphaPaint(x, y);
  return a === 0 ? [255, 255, 255, 255] : [r, g, b, 255];
});
// 背景欠落側: 同じ矩形を黒背景へ置いた検体。透明≠黒なので差分が出るはず。
paths.implRectOnBlack = await makePng("impl-rect-onblack.png", W, H, (x, y) => {
  const [r, g, b, a] = alphaPaint(x, y);
  return a === 0 ? [0, 0, 0, 255] : [r, g, b, 255];
});
// C10: 文字っぽい細線パターンの局所差分 (13x11)。
const TEXT = { x: 60, y: 40, w: 13, h: 11 };
paths.implText = await makePng("impl-text.png", W, H, (x, y) =>
  x >= TEXT.x && x < TEXT.x + TEXT.w && y >= TEXT.y && y < TEXT.y + TEXT.h
    ? (x + y) % 2 === 0
      ? [0, 0, 0, 255]
      : [255, 255, 255, 255]
    : basePixel(x, y),
);
// C11: 縦長画面 (120x480)、先頭 20px は固定ヘッダー相当で完全一致、下部に欠陥。
const TALL_DEFECT = { x: 30, y: 300, w: 20, h: 15 };
const tallPaint = (x, y) => [(x * 3 + y) % 256, (y * 2) % 256, (x * y) % 256, 255];
paths.designTall = await makePng("design-tall.png", 120, 480, tallPaint);
paths.implTallDefect = await makePng(
  "impl-tall-defect.png",
  120,
  480,
  withDefect(tallPaint, TALL_DEFECT),
);
paths.impl1px = await makePng("impl-1px.png", 1, 1, () => [200, 30, 30, 255]);
paths.implCorrupt = join(fixtureDir, "impl-corrupt.png");
await writeFile(
  paths.implCorrupt,
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24)]),
);
// C13: 2x 寸法の実装画像 + 既知マーカー (物理 48,64,16x16 → 設計座標 24,32)。
const MARKER = { x: 48, y: 64, w: 16, h: 16 };
paths.impl2xMarker = await makePng(
  "impl-2x-marker.png",
  W * 2,
  H * 2,
  withDefect((x, y) => basePixel(x >> 1, y >> 1), MARKER, [255, 0, 255, 255]),
);

// ---------- 案件 seed ----------

const sources = [
  ["c01", "C01 identical", paths.base],
  ["c02", "C02 shifted", paths.base],
  ["c03", "C03 defect", paths.base],
  ["c04", "C04 dpr", paths.design2x],
  ["c05", "C05 size mismatch", paths.base],
  ["c06", "C06 crop", paths.base],
  ["c08", "C08 transparency", paths.designAlpha],
  ["c10", "C10 text defect", paths.base],
  ["c11", "C11 tall page", paths.designTall],
  ["c12", "C12 edge inputs", paths.base],
  ["c13", "C13 scaled marker", paths.base],
].map(([id, label, filePath]) => ({ id, type: "local_image", label, filePath }));

await writeFile(
  join(projectsDirectory, "c-cases", "project.json"),
  JSON.stringify({
    id: "c-cases",
    name: "C cases",
    implementationUrl: "http://localhost:3000",
    pages: [{ id: "p1", name: "Page", path: "/", designSources: sources }],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  }),
);

// ---------- Electron 起動 ----------

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
const application = await electron.launch({
  executablePath: process.env.FIGDIFF_ELECTRON_EXECUTABLE ?? requireFromDesktop("electron"),
  args: [bootstrap, `--user-data-dir=${userData}`],
  env: environment,
  timeout: 30_000,
});

const evidence = { schemaVersion: 1, results: {}, pageErrors };

const scrape = async (page) => {
  const matchRate = Number.parseFloat(
    (await page.locator(".mono.font-bold.text-3xl").first().textContent()) ?? "",
  );
  const values = await page.locator(".mono.font-bold.text-lg").allTextContents();
  const report = page.locator('[data-testid="compare-diff-report"]');
  // regionScores のグリッドセルと issue の bbox は同じ `x:N, y:N, w:N, h:N`
  // 書式で並ぶ。issue 行だけ `severity:` を含むのでそれで絞る。
  const bboxes = (
    await report
      .locator("div.flex", { hasText: /severity:/ })
      .locator("span.text-muted-foreground")
      .allTextContents()
  )
    .map((t) => t.trim())
    .filter((t) => /^x:\s*-?\d+, y:\s*-?\d+, w:\s*\d+, h:\s*\d+$/.test(t));
  // regionScores 行: `top-left` 形式の regionId + bbox + 4スコア。issue 行は
  // `severity:` を持ち、`structure:` を持たないのでそれで区別する。
  const regionScores = await report.evaluate((el) => {
    const rows = [...el.querySelectorAll("div.rounded-lg")].filter((row) =>
      row.textContent.includes("structure:"),
    );
    return rows.map((row) => {
      const texts = [...row.querySelectorAll("span")].map((s) => s.textContent.trim());
      const bboxText = texts.find((t) => /^x:-?\d+, y:-?\d+, w:\d+, h:\d+$/.test(t));
      const bm = bboxText?.match(/x:(-?\d+), y:(-?\d+), w:(\d+), h:(\d+)/);
      const scores = {};
      for (const t of texts) {
        const m = t.match(/^(structure|color|shape|layout):\s*([\d.]+)$/);
        if (m) scores[m[1]] = Number(m[2]);
      }
      return {
        id: row.querySelector("span.font-medium").textContent.trim(),
        bbox: bm ? { x: +bm[1], y: +bm[2], w: +bm[3], h: +bm[4] } : null,
        scores,
      };
    });
  });
  const kinds = await report
    .locator("span.font-medium")
    .allTextContents()
    .then((xs) => xs.filter((t) => !/^region-\d+$/.test(t.trim())));
  const img = report.locator('img[src^="data:image/"]');
  const dims = (await img.count())
    ? await img.first().evaluate((el) => ({ w: el.naturalWidth, h: el.naturalHeight }))
    : null;
  const cropChip = await page.locator(".fd-chip", { hasText: /x:-?\d+ y:-?\d+/ }).allTextContents();
  return {
    matchRate,
    diffRegions: Number.parseInt(values[0] ?? "", 10),
    diffPixels: Number.parseInt(values[1] ?? "", 10),
    issues: Number.parseInt(values[2] ?? "", 10),
    bboxes,
    issueKinds: kinds,
    regionScores,
    diffImageDims: dims,
    cropChip,
  };
};

const bboxContains = (bboxes, x, y) =>
  bboxes.some((t) => {
    const m = t.match(/x:\s*(-?\d+), y:\s*(-?\d+), w:\s*(\d+), h:\s*(\d+)/);
    if (!m) return false;
    const [, bx, by, bw, bh] = m.map(Number);
    return x >= bx && x < bx + bw && y >= by && y < by + bh;
  });
// 点 (x,y) を含む regionScore セルを返す。欠陥の局在はセルスコアで見る
// (issue 行は閾値超えの時だけ出るので頼れない)。スコア意味は混在:
// structure=SSIM(1で一致), color=DeltaE(0で一致), shape=Hausdorff(0で一致)。
const cellContaining = (regionScores, x, y) =>
  regionScores.find(
    (r) =>
      r.bbox &&
      x >= r.bbox.x &&
      x < r.bbox.x + r.bbox.w &&
      y >= r.bbox.y &&
      y < r.bbox.y + r.bbox.h,
  );
const isDegraded = (r) => r.scores.structure < 1 || r.scores.color > 0 || r.scores.shape > 0;
const isPerfect = (r) => r.scores.structure === 1 && r.scores.color === 0 && r.scores.shape === 0;
const bboxInRect = (t, rect) => {
  const m = t.match(/x:\s*(-?\d+), y:\s*(-?\d+), w:\s*(\d+), h:\s*(\d+)/);
  if (!m) return false;
  const [, bx, by, bw, bh] = m.map(Number);
  return bx >= rect.x && by >= rect.y && bx + bw <= rect.x + rect.w && by + bh <= rect.y + rect.h;
};

const gotoCompare = async (page, label) => {
  // 開いたことのある案件 tab は最後の page を記憶していて、再オープンでは
  // project_view に戻れない。毎回 tab を閉じてから開き直す。
  const close = page.getByRole("button", { name: "C cases を閉じる", exact: true });
  if (await close.count()) await close.click();
  await page
    .locator("article", { has: page.locator("h3", { hasText: "C cases" }) })
    .first()
    .click();
  const card = page.locator("article", { hasText: label });
  try {
    await card.waitFor({ timeout: 10_000 });
  } catch (error) {
    await page.screenshot({ path: join(evidenceDir, `stuck-${label.replace(/\W+/g, "_")}.png`) });
    await writeFile(join(evidenceDir, "stuck-dom.txt"), await page.content());
    throw error;
  }
  await card.getByRole("button", { name: "Compare" }).click();
  // screenshotImage は store に残り得る — 残っていれば input は隠れて
  // 「変更」が出る。どちらかが出れば compare 画面への遷移は完了。
  try {
    await page
      .getByPlaceholder("URL またはファイルパス（例: http://localhost:3000）")
      .or(page.getByRole("button", { name: "変更", exact: true }))
      .first()
      .waitFor({ timeout: 15_000 });
  } catch (error) {
    await page.screenshot({
      path: join(evidenceDir, `stuck-load-${label.replace(/\W+/g, "_")}.png`),
    });
    await writeFile(join(evidenceDir, "stuck-load-dom.txt"), await page.content());
    throw error;
  }
};

const loadScreenshot = async (page, path, { expectError = false } = {}) => {
  // 既に screenshot が載っていると input は隠れて「変更」ボタンになる。
  const change = page.getByRole("button", { name: "変更", exact: true });
  if (await change.count()) await change.click();
  const input = page.getByPlaceholder("URL またはファイルパス（例: http://localhost:3000）");
  await input.fill(path);
  await page.getByRole("button", { name: "実装スクリーンショット", exact: true }).click();
  if (expectError) {
    await page.getByText(/画像の読み込みに失敗しました/, { exact: false }).waitFor();
    return (
      (await page
        .locator("div", { hasText: "画像の読み込みに失敗しました" })
        .last()
        .textContent()) ?? ""
    );
  }
  // design 側にも「読み込み済み」pill が常時あるので、2個目の出現を待つ。
  await page.locator("span.fd-pill", { hasText: "読み込み済み" }).nth(1).waitFor();
  return null;
};

const runCompare = async (page) => {
  const report = page.locator('[data-testid="compare-diff-report"]');
  const before = (await report.count()) ? await report.innerText() : null;
  const run = page.getByRole("button", { name: "差分を検出", exact: true });
  await run.waitFor({ state: "visible" });
  assert.ok(await run.isEnabled(), "差分を検出 must be enabled");
  await run.click();
  if (before !== null) {
    // 前回結果が残っている再比較では、新しい結果の反映を待つ。
    await page.waitForFunction(
      (prev) => {
        const el = document.querySelector('[data-testid="compare-diff-report"]');
        return !el || el.innerText !== prev;
      },
      before,
      { timeout: 30_000 },
    );
  }
  await report.waitFor({ timeout: 30_000 });
  // DOM 反映の安定待ち。
  await page.locator(".mono.font-bold.text-3xl").first().waitFor();
  return scrape(page);
};

try {
  const page = await application.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.getByText("C cases", { exact: true }).first().waitFor();

  // C01: 同一画像。存在しない欠陥が報告されない。
  await gotoCompare(page, "C01 identical");
  await loadScreenshot(page, paths.implIdentical);
  const c01 = await runCompare(page);
  evidence.results.C01 = { ...c01, bboxes: undefined };
  assert.equal(c01.matchRate, 100, "C01 identical pair must match 100%");
  assert.equal(c01.diffPixels, 0, "C01 identical pair must have 0 diff pixels");
  assert.equal(c01.diffRegions, 0, "C01 identical pair must have 0 regions");

  // C02: 各方向の移動を補正なしで比較。desktop には補正トグルがなく、
  // 移動量は差分として追跡できることを記録する。
  await gotoCompare(page, "C02 shifted");
  const shifts = [
    ["e1", paths.shiftE1],
    ["e2", paths.shiftE2],
    ["s1", paths.shiftS1],
    ["w2", paths.shiftW2],
  ];
  const c02 = {};
  for (const [name, impl] of shifts) {
    await loadScreenshot(page, impl);
    c02[name] = await runCompare(page);
    assert.ok(c02[name].diffPixels > 0, `C02 ${name} shift must produce diff`);
    assert.ok(c02[name].matchRate < 100, `C02 ${name} shift must lower matchRate`);
  }
  evidence.results.C02 = {
    shifts: Object.fromEntries(
      Object.entries(c02).map(([k, v]) => [
        k,
        { matchRate: v.matchRate, diffPixels: v.diffPixels, diffRegions: v.diffRegions },
      ]),
    ),
    note: "desktop exposes no alignment correction toggle; shift tracked as diff",
  };
  assert.ok(
    c02.e2.diffPixels > c02.e1.diffPixels,
    "2px shift must produce more diff than 1px shift",
  );

  // C03: 移動 + 既知矩形欠陥。欠陥を含む regionScore セルだけ低下するはず。
  await gotoCompare(page, "C03 defect");
  await loadScreenshot(page, paths.implDefect);
  const c03 = await runCompare(page);
  evidence.results.C03 = c03;
  assert.ok(c03.diffRegions >= 1, `C03 must report >=1 diff region: ${c03.diffRegions}`);
  const c03cell = cellContaining(
    c03.regionScores,
    DEFECT.x + DEFECT.w / 2,
    DEFECT.y + DEFECT.h / 2,
  );
  assert.ok(
    c03cell && isDegraded(c03cell),
    `C03 defect cell must have degraded score: ${JSON.stringify(c03cell)}`,
  );

  // C04: DPR 1/2/3 の同じ論理内容。比較 canvas が物理寸法を保持する。
  await gotoCompare(page, "C04 dpr");
  const c04 = {};
  await loadScreenshot(page, paths.impl2x);
  c04.dpr2 = await runCompare(page);
  assert.equal(c04.dpr2.matchRate, 100, "C04 dpr2 identical logical content must match");
  await loadScreenshot(page, paths.impl3x);
  c04.dpr3 = await runCompare(page);
  evidence.results.C04 = {
    dpr2: { matchRate: c04.dpr2.matchRate, diffImageDims: c04.dpr2.diffImageDims },
    dpr3: { matchRate: c04.dpr3.matchRate, diffImageDims: c04.dpr3.diffImageDims },
  };
  assert.equal(c04.dpr2.diffImageDims?.w, W * 2, "C04 canvas must keep physical width");
  assert.equal(c04.dpr3.diffImageDims?.w, W * 3, "C04 canvas must keep physical width");

  // C05: 余白・幅・高さの異なる実装。引き伸ばしで消さず条件が分かる。
  await gotoCompare(page, "C05 size mismatch");
  const c05 = {};
  const dimsFor = [
    ["padded", paths.implPadded, 140, 100],
    ["wide", paths.implWide, 140, 80],
    ["tall", paths.implTall, 120, 100],
  ];
  for (const [name, impl, w, h] of dimsFor) {
    await loadScreenshot(page, impl);
    c05[name] = await runCompare(page);
    assert.equal(c05[name].diffImageDims?.w, w, `C05 ${name} canvas width`);
    assert.equal(c05[name].diffImageDims?.h, h, `C05 ${name} canvas height`);
    assert.ok(c05[name].diffPixels > 0, `C05 ${name} must show real diff`);
  }
  evidence.results.C05 = Object.fromEntries(
    Object.entries(c05).map(([k, v]) => [
      k,
      {
        matchRate: v.matchRate,
        diffPixels: v.diffPixels,
        diffImageDims: v.diffImageDims,
      },
    ]),
  );

  // C06: crop を canvas drag で指定。crop 内の欠陥だけが採点され、
  // 解除後は外側の欠陥も検出される。
  await gotoCompare(page, "C06 crop");
  await loadScreenshot(page, paths.implTwoDefects);
  const canvas = page.getByRole("img", { name: "範囲選択キャンバス" });
  await canvas.scrollIntoViewIfNeeded();
  const fire = async (type, x, y) => {
    await canvas.evaluate(
      (el, [type, x, y]) =>
        el.dispatchEvent(
          new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }),
        ),
      [type, x, y],
    );
    // React の isSelecting 反映を待つ。
    await page.waitForTimeout(150);
  };
  // 初回 drag 中に canvas が画像サイズへリサイズされ座標系がずれるので、
  // warm-up drag で先にリサイズを起こしてから本 drag を行う。
  const warm = await canvas.boundingBox();
  await fire("mousedown", warm.x + 4, warm.y + 4);
  await fire("mousemove", warm.x + 20, warm.y + 20);
  await fire("mouseup", warm.x + 20, warm.y + 20);
  const warmClear = page.getByRole("button", { name: "クリア", exact: true });
  if (await warmClear.count()) await warmClear.click();
  const box = await canvas.boundingBox();
  assert.ok(box, "crop canvas must be visible");
  await fire("mousedown", box.x + CROP.x, box.y + CROP.y);
  await fire("mousemove", box.x + CROP.x + CROP.w / 2, box.y + CROP.y + CROP.h / 2);
  await fire("mousemove", box.x + CROP.x + CROP.w, box.y + CROP.y + CROP.h);
  await fire("mouseup", box.x + CROP.x + CROP.w, box.y + CROP.y + CROP.h);
  const cropLabel = page.locator("span.text-muted-foreground", {
    hasText: /x: \d+, y: \d+, w: \d+, h: \d+/,
  });
  await cropLabel.waitFor();
  const cropText = (await cropLabel.first().textContent()) ?? "";
  const cm = cropText.match(/x: (\d+), y: (\d+), w: (\d+), h: (\d+)/);
  assert.ok(cm, `crop region label must appear, got ${cropText}`);
  const cropActual = { x: +cm[1], y: +cm[2], w: +cm[3], h: +cm[4] };
  const c06cropped = await runCompare(page);
  // crop 後は crop 領域だけが比較対象。低下セルは全て crop 内の欠陥
  // (crop 相対座標の INNER 中心) を含むはずで、外側欠陥は見えない。
  const innerRel = {
    x: INNER.x + INNER.w / 2 - cropActual.x,
    y: INNER.y + INNER.h / 2 - cropActual.y,
  };
  const c06degraded = c06cropped.regionScores.filter((r) => isDegraded(r));
  assert.ok(
    c06cropped.diffRegions >= 1 && c06cropped.diffPixels > 0,
    "C06 crop must detect inner defect",
  );
  assert.ok(
    c06degraded.length > 0 &&
      c06degraded.every(
        (r) =>
          r.bbox &&
          innerRel.x >= r.bbox.x &&
          innerRel.x < r.bbox.x + r.bbox.w &&
          innerRel.y >= r.bbox.y &&
          innerRel.y < r.bbox.y + r.bbox.h,
      ),
    `C06 degraded cells must all contain the in-crop defect: ${JSON.stringify(c06degraded)}`,
  );
  assert.ok(
    c06cropped.diffImageDims?.w === cropActual.w && c06cropped.diffImageDims?.h === cropActual.h,
    `C06 crop canvas must equal crop region ${cropActual.w}x${cropActual.h}, got ${JSON.stringify(c06cropped.diffImageDims)}`,
  );
  await page.getByRole("button", { name: "クリア", exact: true }).click();
  const c06full = await runCompare(page);
  const c06outerCell = cellContaining(c06full.regionScores, OUTER.x + 6, OUTER.y + 5);
  assert.ok(
    c06outerCell && isDegraded(c06outerCell),
    `C06 cleared crop must reveal outer defect cell: ${JSON.stringify(c06outerCell)}`,
  );
  evidence.results.C06 = { cropped: c06cropped, full: c06full };

  // C08: 透明背景と不透明背景。意図した透明と背景欠落を区別する。
  await gotoCompare(page, "C08 transparency");
  await loadScreenshot(page, paths.designAlpha);
  const c08same = await runCompare(page);
  await loadScreenshot(page, paths.implAlphaOnWhite);
  const c08white = await runCompare(page);
  await loadScreenshot(page, paths.implRectOnBlack);
  const c08black = await runCompare(page);
  // 製品意味論 (pixel-compare.ts checkerboard=false): 透明画素は白へ blend して
  // 比較する。意図した透明=白合成なので onWhite は高一致、背景欠落=黒は差分検出。
  evidence.results.C08 = {
    semantics: "transparent pixels blend onto white (checkerboard=false, v5 compat)",
    sameAlpha: c08same,
    onWhite: c08white,
    onBlack: c08black,
  };
  assert.ok(
    c08same.matchRate === 100 && c08white.matchRate >= 99,
    `C08 intended transparency must match white composite: same=${c08same.matchRate} white=${c08white.matchRate}`,
  );
  assert.ok(c08black.diffPixels > 0, "C08 missing background (black) must be detected");

  // C10: 13x11 の局所文字差分。局所領域として報告される。
  await gotoCompare(page, "C10 text defect");
  await loadScreenshot(page, paths.implText);
  const c10 = await runCompare(page);
  evidence.results.C10 = c10;
  const c10cell = cellContaining(c10.regionScores, TEXT.x + 6, TEXT.y + 5);
  assert.ok(
    c10.diffRegions >= 1 && c10cell && isDegraded(c10cell),
    `C10 text defect must localize in its cell: ${JSON.stringify(c10cell)}`,
  );

  // C11: 固定ヘッダー相当部が一致する縦長画面。下部欠陥だけが指摘され、
  // ヘッダー帯に偽の領域が出ない。
  await gotoCompare(page, "C11 tall page");
  await loadScreenshot(page, paths.implTallDefect);
  const c11 = await runCompare(page);
  evidence.results.C11 = c11;
  assert.ok(c11.diffRegions >= 1, `C11 must detect the defect: ${c11.diffRegions}`);
  const c11defectCell = cellContaining(c11.regionScores, TALL_DEFECT.x + 10, TALL_DEFECT.y + 7);
  assert.ok(
    c11defectCell && isDegraded(c11defectCell),
    `C11 tall defect must degrade its cell: ${JSON.stringify(c11defectCell)}`,
  );
  // ヘッダー帯 (y<20) を覆うセルは全て満点のはず — 偽差分があれば低下する。
  const c11headerCells = c11.regionScores.filter((r) => r.bbox && r.bbox.y < 160);
  assert.ok(
    c11headerCells.length > 0 && c11headerCells.every((r) => isPerfect(r)),
    `C11 header cells must stay perfect: ${JSON.stringify(c11headerCells.map((r) => r.scores))}`,
  );

  // C12: 1px 画像・不存在パス・破損画像。クラッシュせず失敗理由が出る。
  await gotoCompare(page, "C12 edge inputs");
  await loadScreenshot(page, paths.impl1px);
  const c12one = await runCompare(page).catch((error) => ({ failed: String(error) }));
  // 不存在パス: readLocalImage が拒否 → 即エラーバナー。
  const c12missing = await loadScreenshot(page, join(fixtureDir, "no-such-image.png"), {
    expectError: true,
  });
  // 破損PNG: バイト読みは成功するので load は通るが、画像 decode が
  // preview/compare 時に失敗してエラーバナーが出る。表示内容を採録する。
  await loadScreenshot(page, paths.implCorrupt);
  const bannerSel = 'div[style*="var(--diff-soft)"]';
  await page.getByRole("button", { name: "差分を検出", exact: true }).click();
  await page.waitForTimeout(3_000);
  const c12corruptError = (await page.locator(bannerSel).first().textContent()) ?? "";
  assert.ok(c12corruptError.length > 0, "C12 corrupt file must surface an error");
  evidence.results.C12 = {
    onePixel: c12one,
    missingError: c12missing,
    corruptError: c12corruptError,
    pageErrors,
  };
  assert.match(c12missing, /画像の読み込みに失敗しました/, "C12 missing file must show load error");
  assert.ok(c12corruptError.length > 0, "C12 corrupt file must surface an error at compare time");

  // C13: 2x 寸法の実装 + 既知マーカー。regionScore は design 空間なので
  // マーカーの design 座標 (物理の半分) を含むセルが低下するはず。
  await gotoCompare(page, "C13 scaled marker");
  await loadScreenshot(page, paths.impl2xMarker);
  const c13 = await runCompare(page);
  evidence.results.C13 = c13;
  const markerDesign = { x: MARKER.x / 2 + MARKER.w / 4, y: MARKER.y / 2 + MARKER.h / 4 };
  const c13cell = cellContaining(c13.regionScores, markerDesign.x, markerDesign.y);
  assert.ok(
    c13.diffRegions >= 1 && c13cell && isDegraded(c13cell),
    `C13 marker cell must degrade: ${JSON.stringify(c13cell)}`,
  );
} finally {
  await application.close();
}

// ---------- C09: figma 経路 (非表示フレーム) ----------

const figmaSandbox = await mkdtemp(join(tmpdir(), "figdiff-c09-"));
const fUserData = join(figmaSandbox, "user-data");
const fHome = join(figmaSandbox, "home");
const fProjects = join(figmaSandbox, "projects");
await mkdir(fUserData, { recursive: true });
await mkdir(fHome, { recursive: true });
await mkdir(join(fProjects, "c09"), { recursive: true });
const fFixtures = join(fHome, "fixtures");
await mkdir(fFixtures, { recursive: true });
// 非表示ノードは Figma export では空白が返る、という観測を合成する。
const blankPng = join(fFixtures, "hidden-blank.png");
await sharp({
  create: { width: W, height: H, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 255 } },
})
  .png()
  .toFile(blankPng);
const implForC09 = join(fFixtures, "impl-c09.png");
await sharp(await readFile(paths.implIdentical)).toFile(implForC09);

await writeFile(
  join(fProjects, "c09", "project.json"),
  JSON.stringify({
    id: "c09",
    name: "C09 hidden frame",
    implementationUrl: "http://localhost:3000",
    pages: [
      {
        id: "p1",
        name: "Page",
        path: "/",
        designSources: [
          {
            id: "figma-hidden",
            type: "figma",
            label: "C09 hidden node",
            figmaUrl: "https://www.figma.com/design/FIGDIFFC09/Fixture?node-id=9-9",
            fileKey: "FIGDIFFC09",
            nodeId: "9:9",
          },
          {
            id: "figma-visible",
            type: "figma",
            label: "C09 visible node",
            figmaUrl: "https://www.figma.com/design/FIGDIFFC09/Fixture?node-id=9-8",
            fileKey: "FIGDIFFC09",
            nodeId: "9:8",
          },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  }),
);

const requestLog = join(evidenceDir, "c09-figma-requests.jsonl");
const figmaBootstrap = join(figmaSandbox, "bootstrap.mjs");
await writeFile(
  figmaBootstrap,
  `
import os from "node:os";
import { appendFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { app } from "electron";
os.homedir = () => ${JSON.stringify(fHome)};
syncBuiltinESMExports();
app.setPath("home", ${JSON.stringify(fHome)});
app.setPath("userData", ${JSON.stringify(fUserData)});
const requestLog = ${JSON.stringify(requestLog)};
const visiblePng = Buffer.from(${JSON.stringify((await readFile(paths.implIdentical)).toString("base64"))}, "base64");
const hiddenPng = Buffer.from(${JSON.stringify((await readFile(blankPng)).toString("base64"))}, "base64");
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  appendFileSync(requestLog, JSON.stringify({ url }) + "\\n");
  const parsed = new URL(url);
  if (parsed.origin === "https://api.figma.com" && parsed.pathname === "/v1/images/FIGDIFFC09") {
    const id = parsed.searchParams.get("ids");
    if (!["9:8", "9:9"].includes(id)) throw new Error("unexpected node export: " + id);
    return Response.json({ images: { [id]: "https://figma-fixture.invalid/" + id.replace(":", "_") + ".png" } });
  }
  if (parsed.origin === "https://figma-fixture.invalid") {
    return new Response(parsed.pathname.includes("9_9") ? hiddenPng : visiblePng, {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  }
  throw new Error("C09 synthetic boundary forbids unexpected network access: " + url);
};
const credentials = await import(${JSON.stringify(pathToFileURL(join(repository, "package/credential-store/dist/index.js")).href)});
credentials.selectFileCredentialBackend();
credentials.savePat("figd_artificial_c09_fixture");
await import(${JSON.stringify(pathToFileURL(join(repository, "app/desktop/dist/main/main.js")).href)});
`,
);

const fApp = await electron.launch({
  executablePath: process.env.FIGDIFF_ELECTRON_EXECUTABLE ?? requireFromDesktop("electron"),
  args: [figmaBootstrap, `--user-data-dir=${fUserData}`],
  env: {
    ...environment,
    FIGDIFF_PROJECTS_DIR: fProjects,
    FIGDIFF_HOME: join(figmaSandbox, "figdiff-home"),
  },
  timeout: 30_000,
});

try {
  const page = await fApp.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.getByText("C09 hidden frame", { exact: true }).first().waitFor();

  let c09Opened = false;
  const gotoSource = async (label) => {
    if (c09Opened) {
      // 開いたことのある案件 tab は最後の page を記憶してる。毎回 tab を
      // 閉じてから開き直す。
      const close = page.getByRole("button", {
        name: "C09 hidden frame を閉じる",
        exact: true,
      });
      if (await close.count()) await close.click();
    }
    await page
      .locator("article", { has: page.locator("h3", { hasText: "C09 hidden frame" }) })
      .first()
      .click();
    c09Opened = true;
    const card = page.locator("article", { hasText: label });
    await card.waitFor();
    await card.getByRole("button", { name: "Compare" }).click();
    await page
      .getByPlaceholder("URL またはファイルパス（例: http://localhost:3000）")
      .or(page.getByRole("button", { name: "変更", exact: true }))
      .first()
      .waitFor({ timeout: 15_000 });
  };

  await gotoSource("C09 hidden node");
  await loadScreenshot(page, implForC09);
  const c09hidden = await runCompare(page);
  await gotoSource("C09 visible node");
  await loadScreenshot(page, implForC09);
  const c09visible = await runCompare(page);
  evidence.results.C09 = {
    hidden: c09hidden,
    visible: c09visible,
    requestLog: "c09-figma-requests.jsonl",
  };
  assert.ok(
    c09visible.matchRate > c09hidden.matchRate,
    `C09 visible node must outscore hidden node (${c09visible.matchRate} vs ${c09hidden.matchRate})`,
  );
} finally {
  await fApp.close();
}

evidence.results.C07 = {
  coveredBy: "app/desktop/e2e/native-ignore-region.mjs",
  note: "除外領域の追加・編集・削除後再比較は専用 driver が実 UI で検証済み",
};

assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join(" | ")}`);
await writeFile(join(evidenceDir, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
console.info(join(evidenceDir, "evidence.json"));

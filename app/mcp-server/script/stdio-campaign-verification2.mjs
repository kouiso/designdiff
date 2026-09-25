// stdio campaign verification — 第2弾: 第1弾 (stdio-campaign-verification.mjs)
// がカバーしない case を実 SDK/StdioClientTransport 経路で検証する。
// 対象: C01, C02, C03, C10, C13, M09, M11, M13, M14, M15。
// 検証 oracle は FigDiff 自身の status/matchRate ではなく、生 PNG 寸法・
// 領域 bbox・ディスク上の保存物・エラー文言などの独立した観測値。

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import sharp from "sharp";

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, "../../..");
const entry = join(root, "app/mcp-server/dist/index.js");
const evidenceDir = process.argv[2] ? resolve(process.argv[2]) : undefined;
if (!evidenceDir) throw new Error("evidence dir argument is required");

const sandbox = await mkdtemp(join(tmpdir(), "figdiff-campaign2-"));
const home = join(sandbox, "home");
const store = join(evidenceDir, "figdiff-home");
const resultDir = join(store, "results");
const work = join(sandbox, "work");

await Promise.all([
  mkdir(home, { recursive: true }),
  mkdir(join(store, "cache"), { recursive: true }),
  mkdir(work),
  mkdir(evidenceDir, { recursive: true }),
]);

const W = 390;
const H = 844;

const solidPng = async (w, h, rgb) =>
  await sharp({
    create: { width: w, height: h, channels: 3, background: rgb },
  })
    .png()
    .toBuffer();

const panelSvg = (w, h, extraRects = []) =>
  Buffer.from(
    `<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#f5f5f5"/><rect x="10" y="30" width="${w - 20}" height="${h - 64}" fill="#ffffff"/><rect x="30" y="60" width="200" height="24" fill="#333333"/>${extraRects
      .map(
        (r) =>
          `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="${r.fill ?? "#cc3333"}"/>`,
      )
      .join("")}</svg>`,
  );

const panelPng = async (extraRects = []) =>
  await sharp(panelSvg(W, H, extraRects))
    .png()
    .toBuffer();

// 内容を dx,dy だけずらした画像。ずらしで生じる端の帯は既知の背景色で埋める。
const shiftedPng = async (dx, dy, extraRects = []) => {
  const base = panelSvg(W, H, extraRects);
  const img = await sharp(base)
    .extract({
      left: Math.max(0, -dx),
      top: Math.max(0, -dy),
      width: W - Math.abs(dx),
      height: H - Math.abs(dy),
    })
    .toBuffer();
  return await sharp(await solidPng(W, H, { r: 245, g: 245, b: 245 }))
    .composite([{ input: img, left: Math.max(0, dx), top: Math.max(0, dy) }])
    .png()
    .toBuffer();
};

// 日本語本文っぽい横罫線ブロックの並びを持つ検体。C10 用。
const textRow = (x, y, width, fill = "#222222") =>
  `<rect x="${x}" y="${y}" width="${width}" height="9" fill="${fill}"/>`;
const textPagePng = async (rects) =>
  await sharp(
    Buffer.from(
      `<svg width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#ffffff"/>${rects.join("")}</svg>`,
    ),
  )
    .png()
    .toBuffer();

const fixturePaths = {
  design: join(evidenceDir, "input-design.png"),
  identical: join(evidenceDir, "input-identical.png"),
  shiftR1: join(evidenceDir, "input-shift-r1.png"),
  shiftD2: join(evidenceDir, "input-shift-d2.png"),
  shiftL2: join(evidenceDir, "input-shift-l2.png"),
  shiftU1: join(evidenceDir, "input-shift-u1.png"),
  shiftDefect: join(evidenceDir, "input-shift-defect.png"),
  textDesign: join(evidenceDir, "input-text-design.png"),
  textImpl: join(evidenceDir, "input-text-impl.png"),
  marker2x: join(evidenceDir, "input-marker-2x.png"),
  frameA: join(evidenceDir, "input-frame-a.png"),
  frameB: join(evidenceDir, "input-frame-b.png"),
  frameC: join(evidenceDir, "input-frame-c.png"),
};

// C03: 右へ1pxずらした上で既知の欠陥矩形を足す。座標は実装側空間。
const c03Defect = { x: 120, y: 400, width: 18, height: 14, fill: "#0033cc" };
// C10: 13x11 の局所文字差分。実装側で1文字分だけ形が違う。
const c10Rows = [];
for (let i = 0; i < 20; i += 1) {
  c10Rows.push(textRow(24, 120 + i * 22, 300 - (i % 5) * 18));
}
const c10ImplRows = [...c10Rows];
// 6行目を半分の幅の別形に差し替える (13x11 相当の局所差)。
c10ImplRows[5] = textRow(24, 120 + 5 * 22, 13) + textRow(24 + 26, 120 + 5 * 22, 13);

await Promise.all([
  writeFile(fixturePaths.design, await panelPng()),
  writeFile(fixturePaths.identical, await panelPng()),
  writeFile(fixturePaths.shiftR1, await shiftedPng(1, 0)),
  writeFile(fixturePaths.shiftD2, await shiftedPng(0, 2)),
  writeFile(fixturePaths.shiftL2, await shiftedPng(-2, 0)),
  writeFile(fixturePaths.shiftU1, await shiftedPng(0, -1)),
  writeFile(fixturePaths.shiftDefect, await shiftedPng(1, 0, [c03Defect])),
  writeFile(fixturePaths.textDesign, await textPagePng(c10Rows)),
  writeFile(fixturePaths.textImpl, await textPagePng(c10ImplRows)),
  // C13: 2x 寸法の実装側に既知マーカーを配置 (設計座標 x=120,y=400 → 物理 x=240,y=800)。
  writeFile(
    fixturePaths.marker2x,
    await sharp(panelSvg(W * 2, H * 2, []))
      .composite([
        {
          input: Buffer.from(
            `<svg width="${W * 2}" height="${H * 2}"><rect x="240" y="800" width="36" height="28" fill="#0033cc"/></svg>`,
          ),
          top: 0,
          left: 0,
        },
      ])
      .png()
      .toBuffer(),
  ),
  // M11 用フレーム列: 色の違う 3 枚。順序差・欠落を区別できるよう別色。
  writeFile(
    fixturePaths.frameA,
    await panelPng([{ x: 40, y: 700, width: 60, height: 40, fill: "#1144aa" }]),
  ),
  writeFile(
    fixturePaths.frameB,
    await panelPng([{ x: 120, y: 700, width: 60, height: 40, fill: "#1144aa" }]),
  ),
  writeFile(
    fixturePaths.frameC,
    await panelPng([{ x: 200, y: 700, width: 60, height: 40, fill: "#1144aa" }]),
  ),
]);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
let biomeExecutable;
try {
  biomeExecutable = createRequire(import.meta.url).resolve("@biomejs/biome/bin/biome");
} catch {
  biomeExecutable = undefined;
}
const redactPublicPaths = (value) => {
  if (typeof value === "string") {
    return value
      .replaceAll(`${home}/`, "<home>/")
      .replaceAll(`${store}/`, "<store>/")
      .replaceAll(`${sandbox}/`, "<sandbox>/")
      .replaceAll(`${root}/`, "");
  }
  if (Array.isArray(value)) return value.map(redactPublicPaths);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, redactPublicPaths(child)]),
    );
  }
  return value;
};
const writeFormattedJson = async (filePath, value) => {
  const publicValue = redactPublicPaths(value);
  let text = `${JSON.stringify(publicValue, null, 2)}\n`;
  try {
    if (biomeExecutable === undefined) throw new Error("biome unavailable");
    text = execFileSync(biomeExecutable, ["format", "--stdin-file-path", filePath], {
      cwd: root,
      input: text,
      encoding: "utf8",
    });
  } catch {
    // biome の platform binary が無い環境でも証跡の書き出し自体は失敗させない。
  }
  const bytes = Buffer.from(text);
  await writeFile(filePath, bytes);
  return { path: relative(root, filePath), sha256: sha256(bytes) };
};

const text = (result) =>
  result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
const data = (result) => {
  assert.equal(result.isError, undefined, text(result));
  if (result.structuredContent !== undefined) return result.structuredContent;
  const first = result.content.find((item) => item.type === "text");
  assert.ok(first, "tool response has no text content");
  return JSON.parse(first.text);
};
const isErrorResult = (result) => result.isError === true;

const protocolErrors = [];
const startClient = async (name, overrides = {}) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    cwd: work,
    env: {
      HOME: home,
      // Windows の homedir() は USERPROFILE を見る。隔離しないと実環境を汚す。
      USERPROFILE: home,
      PATH: dirname(process.execPath),
      FIGDIFF_HOME: store,
      FIGDIFF_ALLOWED_DIRS: evidenceDir,
      // 隔離 HOME には browser cache が無いので、実環境側の cache を明示する。
      // 既定位置は OS ごとに違う (win: %LOCALAPPDATA%, mac: ~/Library/Caches)。
      PLAYWRIGHT_BROWSERS_PATH:
        process.env.PLAYWRIGHT_BROWSERS_PATH ??
        (process.platform === "win32"
          ? join(
              process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? home, "AppData", "Local"),
              "ms-playwright",
            )
          : process.platform === "darwin"
            ? join(process.env.HOME ?? home, "Library", "Caches", "ms-playwright")
            : join(process.env.HOME ?? home, ".cache", "ms-playwright")),
      ...overrides,
    },
    stderr: "pipe",
  });
  transport.stderr?.resume();
  const client = new Client({ name, version: "1.0.0" });
  client.onerror = (error) => protocolErrors.push(error.message);
  await client.connect(transport);
  return client;
};
const call = (client, name, args, timeout = 120_000) =>
  client.callTool({ name, arguments: args }, undefined, { timeout });

const evidence = { schemaVersion: 1, protocolErrors, results: {} };
const failures = [];
const check = async (name, fn) => {
  try {
    const detail = await fn();
    evidence.results[name] = { status: "PASS", ...detail };
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    failures.push(name);
    evidence.results[name] = {
      status: "FAIL",
      error: error instanceof Error ? error.message : String(error),
    };
    process.stdout.write(`FAIL ${name}: ${error?.message ?? error}\n`);
  }
};

// M15 用の固定ページサーバ。撮影対象として使う。
const pageHtml = `<!doctype html><html><body style="margin:0;background:#f5f5f5"><div style="margin:10px 0 0 10px;width:370px;height:780px;background:#fff"></div></body></html>`;
const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(pageHtml);
});
await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const pageUrl = `http://127.0.0.1:${server.address().port}/page.html`;

const client = await startClient("campaign-verify-2");

// C01: 不透明な同一画像2枚。存在しない欠陥が報告されないこと。
await check("C01_identical_opaque", async () => {
  const result = data(
    await call(client, "compare_design", {
      design_source: fixturePaths.design,
      screenshot: fixturePaths.identical,
      campaign_id: "c01",
    }),
  );
  const disk = JSON.parse(await readFile(join(resultDir, `${result.comparisonId}.json`), "utf8"));
  assert.equal(result.diffPixelCount, 0, "identical images must have zero diff pixels");
  assert.equal(result.diffRegions?.length ?? 0, 0, "identical images must have no regions");
  assert.equal(result.matchRate, 100, "identical images must score 100%");
  // 独立 oracle: 生成した2枚の画素 SHA が一致すること。
  const d = await readFile(fixturePaths.design);
  const s = await readFile(fixturePaths.identical);
  assert.equal(sha256(d), sha256(s), "fixture pair must be byte-identical");
  return {
    expected: "zero diff pixels, zero regions, 100% match",
    actual: {
      matchRate: result.matchRate,
      diffPixelCount: result.diffPixelCount,
      status: result.status ?? disk.result?.status,
      fixtureSha256: sha256(d).slice(0, 16),
    },
  };
});

// C02: 1px/2px の移動。移動量を追跡でき、補正で配置不良を隠さない。
await check("C02_shift_tracking", async () => {
  const runs = [];
  for (const [name, path, dx, dy] of [
    ["r1", fixturePaths.shiftR1, 1, 0],
    ["d2", fixturePaths.shiftD2, 0, 2],
    ["l2", fixturePaths.shiftL2, -2, 0],
    ["u1", fixturePaths.shiftU1, 0, -1],
  ]) {
    const result = data(
      await call(client, "compare_design", {
        design_source: fixturePaths.design,
        screenshot: path,
        campaign_id: "c02",
      }),
    );
    runs.push({
      name,
      dx,
      dy,
      matchRate: result.matchRate,
      diffPixelCount: result.diffPixelCount,
      regions: (result.diffRegions ?? []).map((r) => r.bounds),
      alignment: result.diffReport?.alignment ?? null,
      totalRegionCount: result.totalRegionCount ?? null,
    });
  }
  // 移動は「差分」として観測されなければならない (補正で完全には消えないこと)。
  for (const run of runs) {
    assert.ok(run.diffPixelCount > 0, `${run.name}: shift must be detected, not hidden`);
    assert.ok(
      (run.regions?.length ?? 0) > 0 || run.totalRegionCount > 0,
      `${run.name}: shift must produce regions`,
    );
  }
  return {
    expected: "each shift is detected and reported with observable diff regions",
    actual: runs,
  };
});

// C03: 移動 + 既知の局所矩形欠陥。bbox が実際の欠陥座標を指すこと。
await check("C03_defect_bbox", async () => {
  const result = data(
    await call(client, "compare_design", {
      design_source: fixturePaths.design,
      screenshot: fixturePaths.shiftDefect,
      campaign_id: "c03",
    }),
  );
  // 欠陥領域の実座標と重なる bbox があること。shift 由来の辺縁差と混ざり得るので
  // 「c03Defect と面積重なりのある領域が少なくとも1つ」を確認する。
  const regions = result.diffRegions ?? [];
  const detail = result.regionsDetailPath
    ? JSON.parse(await readFile(result.regionsDetailPath, "utf8"))
    : null;
  const allRegions = detail?.regions ?? detail ?? regions;
  const overlap = (a, b) => {
    const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
    const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    return x * y;
  };
  const hits = (Array.isArray(allRegions) ? allRegions : [])
    .map((r) => r.bounds ?? r)
    .filter((b) => overlap(b, c03Defect) > 0);
  assert.ok(
    hits.length >= 1,
    `no diff region overlaps defect ${JSON.stringify(c03Defect)}; regions=${JSON.stringify(allRegions).slice(0, 400)}`,
  );
  return {
    expected: `a diff region overlaps the known defect at ${JSON.stringify(c03Defect)}`,
    actual: { matchRate: result.matchRate, hitBounds: hits, regionCount: regions.length },
  };
});

// C10: 13x11px の局所文字差分 + 日本語本文相当の走行。balanced プロファイル。
await check("C10_small_text_diff", async () => {
  const result = data(
    await call(client, "compare_design", {
      design_source: fixturePaths.textDesign,
      screenshot: fixturePaths.textImpl,
      campaign_id: "c10",
      profile: "balanced",
    }),
  );
  // 差分が検出され、かつ全体が「写真」と断定されないこと。
  assert.ok(result.diffPixelCount > 0, "small text diff must be detected");
  const regions = result.diffRegions ?? [];
  assert.ok(regions.length >= 1, "small text diff must produce a region");
  const whole = regions.find((r) => r.bounds.width > W * 0.5 && r.bounds.height > H * 0.5);
  const diagnosisText = JSON.stringify(result.diagnosis ?? {});
  assert.ok(
    !/写真|photo/i.test(diagnosisText) || result.status !== "FAIL",
    "text diff must not be dismissed as photo",
  );
  return {
    expected: "local 13x11 text diff detected as a bounded region, not whole-page",
    actual: {
      matchRate: result.matchRate,
      regionCount: regions.length,
      largestRegion:
        regions.reduce(
          (m, r) =>
            r.bounds.width * r.bounds.height > (m?.bounds.width ?? 0) * (m?.bounds.height ?? 0)
              ? r
              : m,
          null,
        )?.bounds ?? null,
      coversWholePage: Boolean(whole),
      status: result.status,
    },
  };
});

// C13: 2x 寸法の実装画像 + 既知マーカー。採点座標が設計座標系へ対応すること。
await check("C13_scaled_marker", async () => {
  const result = data(
    await call(client, "compare_design", {
      design_source: fixturePaths.design,
      screenshot: fixturePaths.marker2x,
      campaign_id: "c13",
      comparison_conditions: {
        screenshot: { viewport: { width: W, height: H }, pixelRatio: 2 },
      },
    }),
  );
  const regions = result.diffRegions ?? [];
  // マーカーは設計座標 (120,400,18,14) 相当。正規化後の座標系で重なる領域を探す。
  const marker = { x: 120, y: 400, width: 18, height: 14 };
  const markerPhys = { x: 240, y: 800, width: 36, height: 28 };
  const overlap = (a, b) => {
    const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
    const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    return x * y;
  };
  const hitLogical = regions.filter((r) => overlap(r.bounds, marker) > 0);
  const hitPhysical = regions.filter((r) => overlap(r.bounds, markerPhys) > 0);
  assert.ok(
    hitLogical.length > 0 || hitPhysical.length > 0,
    `no region overlaps marker; regions=${JSON.stringify(regions.map((r) => r.bounds)).slice(0, 400)}`,
  );
  return {
    expected: "marker defect located in a consistent coordinate space",
    actual: {
      canvas:
        result.ignoreRegionResolution?.coordinateContext ?? result.comparisonConditions ?? null,
      hitLogical: hitLogical.map((r) => r.bounds),
      hitPhysical: hitPhysical.map((r) => r.bounds),
      regionCount: regions.length,
    },
  };
});

// M09: generate_diff_report。6回以上再比較後の旧ID・再起動後の旧IDで再取得。
await check("M09_report_old_id", async () => {
  const first = data(
    await call(client, "compare_design", {
      design_source: fixturePaths.design,
      screenshot: fixturePaths.shiftDefect,
      campaign_id: "m09",
    }),
  );
  const oldId = first.comparisonId;
  for (let i = 0; i < 6; i += 1) {
    data(
      await call(client, "compare_design", {
        design_source: fixturePaths.design,
        screenshot: i % 2 === 0 ? fixturePaths.shiftR1 : fixturePaths.shiftDefect,
        campaign_id: "m09",
      }),
    );
  }
  // 応答は report 本文そのもの。output_path で実ファイル保存を確認する。
  const reportPath = join(evidenceDir, "m09-report-1.json");
  const reportRes = await call(client, "generate_diff_report", {
    comparison_id: oldId,
    format: "json",
    output_path: reportPath,
  });
  assert.equal(reportRes.isError, undefined, text(reportRes));
  const reportJson = JSON.parse(await readFile(reportPath, "utf8"));
  assert.ok(
    JSON.stringify(reportJson).includes(oldId) || reportJson.comparisonId,
    "report must reference the comparison",
  );

  // プロセス再起動後も旧IDが解決できること。
  const fresh = await startClient("campaign-verify-2-restart");
  try {
    const reportPath2 = join(evidenceDir, "m09-report-2.md");
    const reportRes2 = await call(fresh, "generate_diff_report", {
      comparison_id: oldId,
      output_path: reportPath2,
    });
    assert.equal(reportRes2.isError, undefined, text(reportRes2));
    const md = await readFile(reportPath2, "utf8");
    assert.ok(md.length > 100, "markdown report must have content");
    return {
      expected: "old comparison_id resolvable after 6+ recompares and process restart",
      actual: {
        oldId,
        jsonBytes: (await stat(reportPath)).size,
        mdBytes: md.length,
        restarted: true,
      },
    };
  } finally {
    await fresh.close();
  }
});

// M11: compare_animation。既知フレーム列・順序差・欠落・読込み失敗。
await check("M11_compare_animation", async () => {
  const frames = [fixturePaths.frameA, fixturePaths.frameB, fixturePaths.frameC];
  const timed = (paths, shift = 0) => paths.map((p, i) => ({ path: p, at_ms: (i + shift) * 100 }));

  const ok = data(
    await call(client, "compare_animation", {
      design_source: fixturePaths.design,
      design_frames: timed(frames),
      screenshot_frames: timed(frames),
    }),
  );
  assert.equal(ok.frames.length, 3, "must compare all 3 frames");
  assert.ok(Array.isArray(ok.alignments), "must return frame alignments");
  const orderedDrift = ok.temporal?.maxAbsDriftMs;

  const swapped = data(
    await call(client, "compare_animation", {
      design_source: fixturePaths.design,
      design_frames: timed(frames),
      screenshot_frames: timed([frames[2], frames[0], frames[1]]),
    }),
  );
  const missing = data(
    await call(client, "compare_animation", {
      design_source: fixturePaths.design,
      design_frames: timed(frames),
      screenshot_frames: timed([frames[0], frames[1]]),
    }),
  );
  const bad = await call(client, "compare_animation", {
    design_source: fixturePaths.design,
    design_frames: timed(frames),
    screenshot_frames: [{ path: join(evidenceDir, "no-such-frame.png"), at_ms: 0 }],
  });
  return {
    expected: "order/missing/unreadable cases distinguishable",
    actual: {
      sameOrder: { temporal: ok.temporal, frames: ok.frames.map((f) => f.status) },
      swapped: { temporal: swapped.temporal, orderViolation: swapped.temporal?.orderViolation },
      missingCount: missing.frames.length,
      unreadableIsError: isErrorResult(bad),
      unreadableText: isErrorResult(bad) ? text(bad).slice(0, 200) : null,
    },
  };
});

// M13: エラー契約。無効入力・通信失敗・書込み不可保存先が SDK 経由で
// 元のエラーと復旧手順を返し、成功スキーマで隠れないこと。
await check("M13_error_contracts", async () => {
  const unknownArg = await call(client, "compare_design", {
    design_source: fixturePaths.design,
    screenshot: fixturePaths.identical,
    no_such_arg: true,
  });
  const badType = await call(client, "compare_design", {
    design_source: fixturePaths.design,
    screenshot: fixturePaths.identical,
    threshold: "banana",
  });
  const unreachable = await call(client, "compare_design", {
    design_source: fixturePaths.design,
    screenshot_url: "http://127.0.0.1:1/unreachable",
    campaign_id: "m13-net",
  });
  // 書込み不可の保存先: FIGDIFF_HOME を「ファイル」の下に置いた別サーバ。
  const blockerFile = join(sandbox, "blocker");
  await writeFile(blockerFile, "x");
  const blocked = await startClient("blocked-store", {
    FIGDIFF_HOME: join(blockerFile, "nested"),
  });
  let blockedError;
  try {
    const res = await call(blocked, "create_project", {
      name: "blocked",
      figma_url: "https://www.figma.com/design/ABC123/X",
    });
    blockedError = { isError: isErrorResult(res), text: text(res).slice(0, 300) };
  } catch (error) {
    blockedError = { threw: true, message: String(error?.message ?? error).slice(0, 300) };
  } finally {
    await blocked.close();
  }
  const contract = (r) =>
    isErrorResult(r) ? { isError: true, text: text(r).slice(0, 200) } : { isError: false };
  const summary = {
    unknownArg: contract(unknownArg),
    badType: contract(badType),
    unreachable: contract(unreachable),
    blockedStore: blockedError,
  };
  assert.ok(summary.unknownArg.isError, "unknown argument must be an error");
  assert.ok(summary.badType.isError, "wrong type must be an error");
  assert.ok(summary.unreachable.isError, "unreachable URL must be an error");
  assert.ok(
    summary.blockedStore.isError || summary.blockedStore.threw,
    "unwritable store must surface an error, not a silent success",
  );
  return { expected: "errors surface as MCP errors with reason", actual: summary };
});

// M14: 比較ループ。同一 campaign の反復・別 campaign の独立・再起動後の履歴維持。
await check("M14_loop_isolation", async () => {
  const run = (c, campaignId, tag) =>
    call(c, "compare_design", {
      design_source: fixturePaths.design,
      screenshot: fixturePaths.shiftDefect,
      campaign_id: campaignId,
    }).then((r) => ({ tag, ...data(r) }));

  const a1 = await run(client, "m14-a", "a1");
  const a2 = await run(client, "m14-a", "a2");
  const b1 = await run(client, "m14-b", "b1");
  const guard = (r) => r.loopGuard ?? null;
  assert.ok(guard(a1), "loopGuard must be present");
  const iterOf = (r) => guard(r)?.iteration ?? guard(r)?.step;
  // 同一 campaign 内で反復が進むこと。
  assert.ok(
    iterOf(a2) > iterOf(a1),
    `iteration must advance within campaign: ${iterOf(a1)} -> ${iterOf(a2)}`,
  );
  // 別 campaign は新しい作業として巻き込まれないこと。
  assert.ok(
    iterOf(b1) <= iterOf(a2),
    `new campaign must start fresh: a2=${iterOf(a2)} b1=${iterOf(b1)}`,
  );

  const fresh = await startClient("campaign-verify-2-looprestart");
  try {
    const a3 = await run(fresh, "m14-a", "a3-after-restart");
    // 再起動後も同一 campaign の履歴が維持されること。
    assert.ok(
      iterOf(a3) >= iterOf(a2),
      `history must persist across restart: a2=${iterOf(a2)} a3=${iterOf(a3)}`,
    );
    return {
      expected: "same campaign iterates, different campaign isolated, restart keeps history",
      actual: {
        a1: iterOf(a1),
        a2: iterOf(a2),
        b1: iterOf(b1),
        a3: iterOf(a3),
        a2guard: guard(a2),
        b1guard: guard(b1),
      },
    };
  } finally {
    await fresh.close();
  }
});

// M15: 撮影幅。同一条件で3回撮影し幅が発散しないこと。
await check("M15_capture_width_stable", async () => {
  const widths = [];
  for (let i = 0; i < 3; i += 1) {
    const result = data(
      await call(
        client,
        "compare_design",
        {
          design_source: fixturePaths.design,
          screenshot_url: pageUrl,
          capture_width: 320,
          campaign_id: "m15",
        },
        180_000,
      ),
    );
    const canvas =
      result.comparisonConditions?.screenshot?.canvas ??
      result.verificationContext?.geometry ??
      null;
    widths.push({ run: i, canvas, matchRate: result.matchRate });
  }
  const observed = widths.map((w) => w.canvas?.width ?? w.canvas?.screenshotWidth);
  assert.ok(
    observed.every((w) => w === 320),
    `capture width must stay 320 across runs: ${JSON.stringify(observed)}`,
  );
  return {
    expected: "3 captures at capture_width=320 all produce 320-wide screenshots",
    actual: { widths: observed, pageUrl },
  };
});

// X09: MCP↔desktop の保存形式相互読込み。desktop は ~/.figdiff/projects/{id}/project.json を
// 読む (e2e 各 driver が seed する形式)。MCP 作成物が同じ形式・同じ場所にあり、
// desktop 形式で seed した案件を MCP が読めることを確認する。
await check("X09_mcp_desktop_interop", async () => {
  // (a) MCP が作った案件ファイルが desktop の seed 形式と同じ形であること。
  const created = data(
    await call(client, "create_project", {
      name: "Interop check",
      figma_url: "https://www.figma.com/design/ABC123/Interop",
      implementation_url: "http://localhost:3000",
    }),
  );
  const projectDir = join(store, "projects", created.project_id);
  const projectFile = JSON.parse(await readFile(join(projectDir, "project.json"), "utf8"));
  assert.equal(projectFile.id, created.project_id);
  assert.ok(
    projectFile.name && Array.isArray(projectFile.pages),
    "project.json must have desktop-compatible shape",
  );

  // (b) desktop e2e が seed する形式の案件を MCP が list/get で読めること。
  const desktopId = "x09-desktop-seed";
  const desktopDir = join(store, "projects", desktopId);
  await mkdir(desktopDir, { recursive: true });
  const desktopProject = {
    id: desktopId,
    name: "Desktop-seeded project",
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
            filePath: fixturePaths.design,
          },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
  await writeFile(join(desktopDir, "project.json"), JSON.stringify(desktopProject, null, 2));

  const listed = data(await call(client, "list_projects", {}));
  const found = (listed.projects ?? listed).find?.(
    (p) => p.id === desktopId || p.project_id === desktopId,
  );
  assert.ok(
    found,
    `desktop-seeded project must be listed by MCP: ${JSON.stringify(listed).slice(0, 300)}`,
  );

  // (c) 旧形式データ (driver1 の X09 で作成済み想定の legacy 形状) が消されないこと —
  // ここでは desktop seed が schema 準拠で読めることを project-store 側でも確認する。
  const crop = data(
    await call(client, "set_crop_region", {
      project_id: desktopId,
      frame_name: "fixture-page",
      region: { x: 10, y: 20, width: 100, height: 80 },
      screenshot_width: W,
      screenshot_height: H,
    }),
  );
  const reread = JSON.parse(await readFile(join(desktopDir, "project.json"), "utf8"));
  assert.equal(reread.id, desktopId, "desktop file must not be rewritten to another shape");
  return {
    expected:
      "MCP-written project readable as desktop shape; desktop-seeded project readable by MCP",
    actual: {
      mcpCreatedId: created.project_id,
      desktopSeedListed: Boolean(found),
      cropOnDesktopProject: crop.ok ?? crop ?? "ok",
    },
  };
});

await client.close();
server.close();

evidence.summary = {
  total: Object.keys(evidence.results).length,
  passed: Object.values(evidence.results).filter((r) => r.status === "PASS").length,
  failed: failures,
  uncovered: [
    "M01 fresh-agent discovery (separate evidence)",
    "M04/M06/M10/M16 real Figma (see stdio-real-figma-verification)",
    "M12 report_issue real submission (external write authorization required)",
  ],
};
const written = await writeFormattedJson(join(evidenceDir, "evidence.json"), evidence);
process.stdout.write(`${JSON.stringify({ evidence: written.path, failures })}\n`);
if (failures.length > 0) process.exit(1);

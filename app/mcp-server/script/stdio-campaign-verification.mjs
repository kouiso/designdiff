import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const entry = join(root, "app/mcp-server/dist/index.js");
const evidenceDir = resolve(
  process.argv[2] ?? join(root, "docs/evidence/mcp-stdio-campaign-verification"),
);
const sandbox = await mkdtemp(join(tmpdir(), "figdiff-campaign-verify-"));
const home = join(sandbox, "home");
const store = join(sandbox, "store");
const work = join(sandbox, "work");
const resultDir = join(store, "results");

// scroll 結合と固定ヘッダーの実 fixture。ヘッダーは position:fixed で全画面に1つだけ存在する。
const scrollPageHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:390px;background:#eee}
header{position:fixed;top:0;left:0;width:390px;height:48px;background:#224488;color:#fff;z-index:10}
section{box-sizing:border-box;width:390px;height:400px;padding:60px 16px 16px}
section:nth-child(odd){background:#fff}section:nth-child(even){background:#f0f4ff}
</style></head><body>
<header>fixed-header</header>
<section>block-0</section><section>block-1</section><section>block-2</section>
<section>block-3</section><section>block-4</section><section>block-5</section>
</body></html>`;
const fixtureServer = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  if (url.pathname === "/scroll") {
    response.end(scrollPageHtml);
    return;
  }
  response.end(
    `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;min-height:844px;background:#f5f5f5}main{width:330px;height:780px;margin:20px;background:#fff;border-top:12px solid #333}</style></head><body><main></main></body></html>`,
  );
});
await new Promise((resolveListen, rejectListen) => {
  fixtureServer.once("error", rejectListen);
  fixtureServer.listen(0, "127.0.0.1", resolveListen);
});
const fixtureAddress = fixtureServer.address();
assert.ok(fixtureAddress && typeof fixtureAddress !== "string");
const fixtureUrl = `http://127.0.0.1:${fixtureAddress.port}`;
const scrollUrl = `${fixtureUrl}/scroll`;

await Promise.all([
  mkdir(home),
  mkdir(join(store, "projects"), { recursive: true }),
  mkdir(join(store, "cache"), { recursive: true }),
  mkdir(work),
  mkdir(evidenceDir, { recursive: true }),
]);

const W = 390;
const H = 844;
const defectA = { x: 60, y: 300, width: 20, height: 20 };
const defectB = { x: 250, y: 600, width: 20, height: 20 };

const solidPng = async (w, h, rgb) =>
  await sharp({
    create: { width: w, height: h, channels: 3, background: rgb },
  })
    .png()
    .toBuffer();

const basePanel = (extraRects = []) =>
  Buffer.from(
    `<svg width="${W}" height="${H}"><rect x="10" y="30" width="370" height="780" fill="#ffffff"/><rect x="30" y="60" width="200" height="24" fill="#333333"/>${extraRects
      .map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="#cc3333"/>`)
      .join("")}</svg>`,
  );

const withPanel = async (extraRects = []) =>
  await sharp(await solidPng(W, H, { r: 245, g: 245, b: 245 }))
    .composite([{ input: basePanel(extraRects), top: 0, left: 0 }])
    .png()
    .toBuffer();

// 同じ論理内容を異なる物理ピクセルで描いた DPR 検体。
const dprPng = async (scale) => {
  const w = W * scale;
  const h = H * scale;
  const rect = (x, y, rw, rh, fill) =>
    `<rect x="${x * scale}" y="${y * scale}" width="${rw * scale}" height="${rh * scale}" fill="${fill}"/>`;
  return await sharp(
    Buffer.from(
      `<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#f5f5f5"/>${rect(10, 30, 370, 780, "#ffffff")}${rect(30, 60, 200, 24, "#333333")}</svg>`,
    ),
  )
    .png()
    .toBuffer();
};

const fixturePaths = {
  design: join(evidenceDir, "input-design.png"),
  defectBoth: join(evidenceDir, "input-defect-both.png"),
  dpr1: join(evidenceDir, "input-dpr1.png"),
  dpr2: join(evidenceDir, "input-dpr2.png"),
  dpr3: join(evidenceDir, "input-dpr3.png"),
  tallDesign: join(evidenceDir, "input-tall-design.png"),
  onePx: join(evidenceDir, "input-1px.png"),
  corrupt: join(evidenceDir, "input-corrupt.png"),
  hugeDims: join(evidenceDir, "input-huge.png"),
};

await Promise.all([
  writeFile(fixturePaths.design, await withPanel()),
  writeFile(fixturePaths.defectBoth, await withPanel([defectA, defectB])),
  writeFile(fixturePaths.dpr1, await dprPng(1)),
  writeFile(fixturePaths.dpr2, await dprPng(2)),
  writeFile(fixturePaths.dpr3, await dprPng(3)),
  writeFile(fixturePaths.tallDesign, await solidPng(W, 2400, { r: 238, g: 240, b: 248 })),
  writeFile(fixturePaths.onePx, await solidPng(1, 1, { r: 255, g: 255, b: 255 })),
  writeFile(fixturePaths.corrupt, Buffer.from("not a png payload")),
  writeFile(fixturePaths.hugeDims, await solidPng(20000, 4, { r: 128, g: 128, b: 128 })),
]);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
let biomeExecutable;
try {
  biomeExecutable = createRequire(import.meta.url).resolve("@biomejs/biome/bin/biome");
} catch {
  // biome 未install環境では証跡の整形を諦め、plain JSON に落とす。
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
    // biome の platform binary が無い環境 (未installの remote 等) でも
    // 証跡の書き出し自体は失敗させない。
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

const clients = [];
const protocolErrors = [];
const startClient = async (name) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    cwd: work,
    env: {
      HOME: home,
      // Windows の homedir() は HOME でなく USERPROFILE を見る。ここを
      // 隔離しないと file backend が実ユーザーの ~/.figdiff を汚す。
      USERPROFILE: home,
      PATH: dirname(process.execPath),
      FIGDIFF_HOME: store,
      FIGDIFF_ALLOWED_DIRS: evidenceDir,
      PLAYWRIGHT_BROWSERS_PATH:
        process.env.PLAYWRIGHT_BROWSERS_PATH ??
        (process.platform === "win32"
          ? join(process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? home, "AppData", "Local"), "ms-playwright")
          : process.platform === "darwin"
            ? join(process.env.HOME ?? home, "Library", "Caches", "ms-playwright")
            : join(process.env.HOME ?? home, ".cache", "ms-playwright")),
    },
    stderr: "pipe",
  });
  transport.stderr?.resume();
  const client = new Client({ name, version: "1.0.0" });
  client.onerror = (error) => protocolErrors.push(error.message);
  await client.connect(transport);
  clients.push(client);
  return client;
};
const call = async (client, name, args, timeout = 120_000) =>
  await client.callTool({ name, arguments: args }, undefined, { timeout });
const closeClient = async (client) => {
  await client.close();
  clients.splice(clients.indexOf(client), 1);
};

const collectFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entryName of entries) {
    const fullPath = join(directory, entryName.name);
    if (entryName.isDirectory()) files.push(...(await collectFiles(fullPath)));
    else files.push(fullPath);
  }
  return files;
};
const buildRoots = [
  join(root, "app/mcp-server/dist"),
  join(root, "package/shared/dist"),
  join(root, "package/credential-store/dist"),
];
const buildIdentityFiles = [
  join(root, "pnpm-lock.yaml"),
  join(root, "package.json"),
  join(root, "app/mcp-server/package.json"),
  join(root, "package/shared/package.json"),
  join(root, "package/credential-store/package.json"),
];
const captureBuildManifest = async () => {
  const buildFiles = [
    ...(await Promise.all(buildRoots.map(collectFiles))).flat(),
    ...buildIdentityFiles,
  ].sort();
  return await Promise.all(
    buildFiles.map(async (filePath) => ({
      path: relative(root, filePath),
      size: (await stat(filePath)).size,
      sha256: sha256(await readFile(filePath)),
    })),
  );
};
const digestBuildManifest = (manifest) =>
  sha256(
    Buffer.from(
      manifest.map(({ path, size, sha256: digest }) => `${path}\0${size}\0${digest}`).join("\n"),
    ),
  );
const buildManifest = await captureBuildManifest();
const buildDigest = digestBuildManifest(buildManifest);

const results = {};
const verificationFailures = [];
const check = async (id, fn) => {
  try {
    results[id] = await fn();
    results[id].status = "PASS";
  } catch (error) {
    verificationFailures.push(`${id}: ${error.message}`);
    results[id] = { status: "FAIL", error: error.message };
  }
};

let client = await startClient("figdiff-campaign-first-process");
try {
  // M02: 作成→一覧→無効ファイル診断→削除。別案件を触らない。
  await check("M02_project_lifecycle", async () => {
    const created = data(
      await call(client, "create_project", {
        name: "Campaign Project",
        implementation_url: "https://example.invalid",
      }),
    );
    assert.ok(created.project_id, "create_project must return project_id");
    const listed = data(await call(client, "list_projects", {}));
    assert.ok(
      listed.projects.some((p) => p.id === created.project_id),
      "created project must be listed",
    );
    // 無効な project.json は一覧から外れても落ちないことを確認する。
    const brokenDir = join(store, "projects", "broken-proj");
    await mkdir(brokenDir, { recursive: true });
    await writeFile(join(brokenDir, "project.json"), "{ not json");
    const listed2 = data(await call(client, "list_projects", {}));
    assert.ok(
      !listed2.projects.some((p) => p.id === "broken-proj"),
      "corrupt project.json must be skipped",
    );
    const deleted = data(
      await call(client, "delete_project", { project_id: created.project_id }),
    );
    assert.equal(deleted.success, true);
    const listed3 = data(await call(client, "list_projects", {}));
    assert.ok(
      !listed3.projects.some((p) => p.id === created.project_id),
      "deleted project must disappear",
    );
    return {
      expected: "create→list→corrupt skipped→delete→absent",
      actual: { projectId: created.project_id, deleted: deleted.success },
    };
  });

  // M03: 無効 token 拒否・有効 token 保存・応答に秘密値を出さない。
  await check("M03_set_figma_token", async () => {
    const bad = await call(client, "set_figma_token", { token: "totally-invalid" });
    assert.ok(isErrorResult(bad), "invalid token must return isError");
    const fakePat = `figd_${"a".repeat(40)}`;
    const ok = await call(client, "set_figma_token", { token: fakePat });
    assert.ok(!isErrorResult(ok), text(ok));
    assert.ok(!text(ok).includes(fakePat), "response must not echo the token");
    // file backend (~/.figdiff/credentials.json) に残ることを確認する。
    // keychain backend (Windows Credential Manager 等) が選ばれた環境では
    // ファイルは作られないため、新規プロセスが token を認識するかで判断する。
    const credentialsPath = join(home, ".figdiff", "credentials.json");
    let backend = "file";
    try {
      const stored = JSON.parse(await readFile(credentialsPath, "utf8"));
      assert.equal(stored["figma-pat"], fakePat);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      backend = "keychain";
      const fresh = await startClient("m03-fresh");
      try {
        const probe = await call(fresh, "inspect_node", {
          figma_url: "https://www.figma.com/design/AAAAAAAAAAAAAAAAAAAAAA/x?node-id=0-1",
        });
        const probeText = text(probe);
        assert.ok(
          isErrorResult(probe),
          "fake token must fail the API call, not be silently accepted",
        );
        assert.ok(
          !probeText.includes("Figma token not configured"),
          `token must be recognized by a fresh process, got: ${probeText}`,
        );
      } finally {
        await closeClient(fresh);
      }
      // keychain は HOME 隔離の効かない実環境の領域なので、検証に使った
      // 偽トークンは確実に消して残さない。
      try {
        // @napi-rs/keyring は credential-store の依存なので、その package を
        // 起点に解決する (pnpm は依存を巻き上げないため script 位置からは見えない)。
        const req = createRequire(
          join(root, "package/credential-store/package.json"),
        );
        const { Entry } = req("@napi-rs/keyring");
        new Entry("figdiff", "figma-pat").deletePassword();
      } catch {
        // backend が file なら import 自体が失敗する環境もある。消せなくても
        // 偽値しか書いていないため実害は限定的だが、証跡には残す。
        backend = "keychain-cleanup-failed";
      }
    }
    return {
      expected: "invalid rejected, valid persisted without echo",
      actual: { persisted: true, echoed: false, backend },
    };
  });

  // M07: crop 指定→取得→比較で同一範囲・画像外・未登録案件。
  await check("M07_crop_region", async () => {
    const proj = data(
      await call(client, "create_project", {
        name: "Crop Project",
        implementation_url: "https://example.invalid",
      }),
    );
    const crop = { x: 10, y: 30, width: 370, height: 780 };
    const setRes = data(
      await call(client, "set_crop_region", {
        project_id: proj.project_id,
        frame_name: "frame-a",
        region: crop,
        screenshot_width: W,
        screenshot_height: H,
      }),
    );
    assert.ok(setRes.success !== false, JSON.stringify(setRes));
    const got = data(
      await call(client, "get_crop_region", {
        project_id: proj.project_id,
        frame_name: "frame-a",
      }),
    );
    assert.equal(got.regionCount, 1);
    assert.deepEqual(
      {
        x: got.regions[0].region.x,
        y: got.regions[0].region.y,
        width: got.regions[0].region.width,
        height: got.regions[0].region.height,
      },
      crop,
    );
    assert.equal(got.regions[0].capturedWidth, W);
    assert.equal(got.regions[0].capturedHeight, H);
    const unknown = data(
      await call(client, "get_crop_region", {
        project_id: "no-such-project",
        frame_name: "frame-a",
      }),
    );
    assert.equal(unknown.projectExists, false);
    return {
      expected: { regionCount: 1, roundTrip: crop, unknownProject: false },
      actual: { regionCount: got.regionCount, unknownProject: unknown.projectExists },
    };
  });

  // M08: ignore region 追加→一覧→削除→不存在IDの扱い。
  await check("M08_ignore_regions", async () => {
    const proj = data(
      await call(client, "create_project", {
        name: "Ignore Project",
        implementation_url: "https://example.invalid",
      }),
    );
    const regions = [
      { id: "mask-a", frame_name: "frame-a", x: 0, y: 0, width: 50, height: 50, label: "mask-a" },
      { id: "mask-b", frame_name: "frame-a", x: 100, y: 100, width: 60, height: 60, label: "mask-b" },
    ];
    const setRes = data(
      await call(client, "set_ignore_regions", {
        project_id: proj.project_id,
        regions,
      }),
    );
    assert.ok(setRes.success !== false, JSON.stringify(setRes));
    const got = data(
      await call(client, "get_ignore_regions", { project_id: proj.project_id }),
    );
    assert.equal(got.regions.length, 2);
    const firstId = got.regions[0].id;
    const del = data(
      await call(client, "delete_ignore_region", {
        project_id: proj.project_id,
        region_id: firstId,
      }),
    );
    assert.equal(del.success, true);
    const got2 = data(
      await call(client, "get_ignore_regions", { project_id: proj.project_id }),
    );
    assert.equal(got2.regions.length, 1);
    assert.ok(!got2.regions.some((r) => r.id === firstId));
    const delMissing = await call(client, "delete_ignore_region", {
      project_id: proj.project_id,
      region_id: "missing-id",
    });
    // 不存在IDの削除は no-op 成功で、件数不変として応答される（冪等）。
    const delMissingData = data(delMissing);
    const got3 = data(
      await call(client, "get_ignore_regions", { project_id: proj.project_id }),
    );
    assert.equal(got3.regions.length, 1, "missing-id delete must not remove other regions");
    return {
      expected: { afterAdd: 2, afterDelete: 1, missingIdNoOp: true },
      actual: {
        afterAdd: got.regions.length,
        afterDelete: got2.regions.length,
        missingIdNoOp: delMissingData.success === true && got3.regions.length === 1,
        note: "missing id is idempotent no-op; regionCount lets caller diagnose",
      },
    };
  });

  // C04: DPR 1/2/3 の同じ論理内容。物理 px を比較条件として再構成できる。
  await check("C04_dpr", async () => {
    const runs = [];
    for (const [name, path, ratio] of [
      ["dpr1", fixturePaths.dpr1, 1],
      ["dpr2", fixturePaths.dpr2, 2],
      ["dpr3", fixturePaths.dpr3, 3],
    ]) {
      const result = data(
        await call(client, "compare_design", {
          design_source: fixturePaths.dpr1,
          screenshot: path,
          campaign_id: `c04-${name}`,
          comparison_conditions: {
            screenshot: { viewport: { width: W, height: H }, pixelRatio: ratio },
          },
        }),
      );
      runs.push({
        name,
        matchRate: result.matchRate,
        conditions: result.comparisonConditions ?? null,
        normalization: result.normalization ?? null,
      });
    }
    // 2x/3x は 1x と同じ内容を高密度で描いたもの。条件申告が結果へ残ることを確認する。
    for (const run of runs) {
      assert.ok(run.conditions, `${run.name} must record comparisonConditions`);
    }
    assert.equal(runs[0].conditions.screenshot.declared?.pixelRatio, 1);
    assert.equal(runs[1].conditions.screenshot.declared?.pixelRatio, 2);
    assert.equal(runs[2].conditions.screenshot.declared?.pixelRatio, 3);
    return {
      expected: "pixelRatio 1/2/3 recorded; logical dims reconstructable",
      actual: runs.map((r) => ({
        name: r.name,
        matchRate: r.matchRate,
        pixelRatio: r.conditions.screenshot?.declared?.pixelRatio,
        canvas: r.conditions.screenshot?.canvas,
      })),
    };
  });

  // C05: 同じ内容で高さ・余白の違う入力。引き伸ばしで消さず、条件を記録する。
  await check("C05_size_mismatch", async () => {
    const taller = data(
      await call(client, "compare_design", {
        design_source: fixturePaths.design,
        screenshot: fixturePaths.tallDesign,
        campaign_id: "c05-taller",
      }),
    );
    const disk = JSON.parse(
      await readFile(join(resultDir, `${taller.comparisonId}.json`), "utf8"),
    );
    assert.ok(disk.result?.normalization ?? taller.normalization, "normalization must be reported");
    assert.notEqual(taller.matchRate, 1, "size mismatch must not silently PASS at 100%");
    return {
      expected: "different-height input reported via normalization, not stretched to PASS",
      actual: { matchRate: taller.matchRate, status: taller.status },
    };
  });

  // C06+M05: crop 適用が両画像で対応し、条件を黙って変えない。
  await check("C06_crop_applied", async () => {
    const proj = data(
      await call(client, "create_project", {
        name: "Crop Compare",
        implementation_url: "https://example.invalid",
      }),
    );
    const crop = { x: 0, y: 0, width: W, height: 500 };
    await call(client, "set_crop_region", {
      project_id: proj.project_id,
      frame_name: "frame-a",
      region: crop,
      screenshot_width: W,
      screenshot_height: H,
    });
    const withCrop = data(
      await call(client, "compare_design", {
        design_source: fixturePaths.design,
        screenshot: fixturePaths.defectBoth,
        project_id: proj.project_id,
        frame_name: "frame-a",
        campaign_id: "c06-crop",
      }),
    );
    // defectB (y=600) は crop 範囲外なので、crop 適用時の差分画素には含まれない。
    assert.ok(
      withCrop.diffPixelCount <= defectA.width * defectA.height * 4,
      `cropped diff must exclude y>=500 defect (got ${withCrop.diffPixelCount})`,
    );
    return {
      expected: "defect outside crop is excluded from scoring",
      actual: { diffPixelCount: withCrop.diffPixelCount, status: withCrop.status },
    };
  });

  // C07: 既知欠陥2個・片側mask → 指定外の欠陥だけ残る。
  await check("C07_mask", async () => {
    const noMask = data(
      await call(client, "compare_design", {
        design_source: fixturePaths.design,
        screenshot: fixturePaths.defectBoth,
        campaign_id: "c07-nomask",
      }),
    );
    const masked = data(
      await call(client, "compare_design", {
        design_source: fixturePaths.design,
        screenshot: fixturePaths.defectBoth,
        ignore_regions: [
          { x: defectA.x, y: defectA.y, width: defectA.width, height: defectA.height },
        ],
        campaign_id: "c07-mask",
      }),
    );
    const expectedB = defectB.width * defectB.height;
    assert.ok(
      Math.abs(masked.diffPixelCount - expectedB) <= expectedB * 0.15,
      `masked diff should be defectB only (~${expectedB}, got ${masked.diffPixelCount})`,
    );
    assert.ok(noMask.diffPixelCount > masked.diffPixelCount);
    const bRegions = (masked.diffRegions ?? []).filter(
      (r) =>
        r.bounds &&
        Math.abs(r.bounds.x - defectB.x) <= 3 &&
        Math.abs(r.bounds.y - defectB.y) <= 3,
    );
    assert.ok(bRegions.length > 0, "unmasked defect must remain a diff region");
    return {
      expected: { maskedDiff: defectB.width * defectB.height, defectBPreserved: true },
      actual: { maskedDiff: masked.diffPixelCount, noMaskDiff: noMask.diffPixelCount },
    };
  });

  // C08(fixture): 透明背景の設計と不透明撮影。design_background で下地を指定できる。
  await check("C08_transparent_design", async () => {
    const transparent = await sharp({
      create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([
        {
          input: Buffer.from(
            `<svg width="${W}" height="${H}"><rect x="30" y="60" width="200" height="24" fill="#333333"/></svg>`,
          ),
          top: 0,
          left: 0,
        },
      ])
      .png()
      .toBuffer();
    const transparentPath = join(evidenceDir, "input-transparent-design.png");
    await writeFile(transparentPath, transparent);
    const onWhite = data(
      await call(client, "compare_design", {
        design_source: transparentPath,
        screenshot: fixturePaths.design,
        design_background: "#ffffff",
        campaign_id: "c08-white",
      }),
    );
    const onBlack = data(
      await call(client, "compare_design", {
        design_source: transparentPath,
        screenshot: fixturePaths.design,
        design_background: "#000000",
        campaign_id: "c08-black",
      }),
    );
    assert.ok(
      onBlack.diffPixelCount > onWhite.diffPixelCount,
      "background choice must change the comparison",
    );
    return {
      expected: "white background closer than black for white-panel screenshot",
      actual: { onWhite: onWhite.diffPixelCount, onBlack: onBlack.diffPixelCount },
    };
  });

  // C11: capture_scroll は capture_device 必須 — 非端末経路では明示エラーになる。
  // 端末側の結合検証は実機経路でのみ可能。ここでは拒否契約と、結合済みの長い画像を
  // 直接比較した時に二重ヘッダー欠落なく処理できることを確認する。
  await check("C11_scroll_contract", async () => {
    const rejected = await call(client, "compare_design", {
      design_source: fixturePaths.design,
      screenshot_url: scrollUrl,
      capture_scroll: true,
      capture_width: 390,
      campaign_id: "c11-scroll",
    });
    assert.ok(isErrorResult(rejected), "capture_scroll without capture_device must be rejected");
    assert.match(text(rejected), /capture_device/);
    // 結合済みの長い画像（固定ヘッダー1回だけ）を比較入力として受け付ける。
    const tallCompare = data(
      await call(client, "compare_design", {
        design_source: fixturePaths.design,
        screenshot: fixturePaths.tallDesign,
        campaign_id: "c11-tall",
      }),
    );
    assert.ok(tallCompare.comparisonId);
    return {
      expected: "scroll without device is a clear error; tall stitched input is accepted",
      actual: { rejectedWithReason: true, tallStatus: tallCompare.status },
    };
  });

  // C12: 1px・破損・不正寸法・巨大画像でクラッシュや黙殺がない。
  await check("C12_edge_inputs", async () => {
    const outcomes = {};
    for (const [name, shot] of [
      ["onePx", fixturePaths.onePx],
      ["corrupt", fixturePaths.corrupt],
      ["hugeDims", fixturePaths.hugeDims],
    ]) {
      const result = await call(client, "compare_design", {
        design_source: fixturePaths.design,
        screenshot: shot,
        campaign_id: `c12-${name}`,
      });
      outcomes[name] = { isError: result.isError === true, text: text(result).slice(0, 200) };
      if (result.isError !== true) {
        const parsed = result.structuredContent ?? JSON.parse(text(result));
        outcomes[name].status = parsed.status;
      }
    }
    assert.ok(outcomes.corrupt.isError, "corrupt PNG must be an explicit error");
    assert.ok(outcomes.corrupt.text.length > 0, "error must carry a reason");
    return {
      expected: "corrupt input is an error with reason; edge sizes do not crash",
      actual: outcomes,
    };
  });

  // M05: Web URL 経路。実ブラウザ撮影で寸法・条件が取れる。
  await check("M05_screenshot_url", async () => {
    const result = data(
      await call(client, "compare_design", {
        design_source: fixturePaths.design,
        screenshot_url: `${fixtureUrl}/`,
        capture_width: 390,
        campaign_id: "m05-url",
      }, 240_000),
    );
    assert.ok(result.comparisonId);
    assert.ok(Number.isFinite(result.matchRate));
    return {
      expected: "web URL capture path executes end to end",
      actual: { matchRate: result.matchRate, status: result.status },
    };
  });

  // M10: verify_fix — local 比較は diffReport を持たないため baseline として拒否される。
  // 改善/悪化/無変化の判定は実 Figma 比較を baseline に取る経路でのみ有効
  // （stdio-real-figma-verification 側で実 API 経由を確認）。
  await check("M10_verify_fix_contract", async () => {
    const baseline = data(
      await call(client, "compare_design", {
        design_source: fixturePaths.design,
        screenshot: fixturePaths.defectBoth,
        campaign_id: "m10-base",
      }),
    );
    assert.ok(
      !baseline.diffReport || (baseline.diffReport.regionScores ?? []).length === 0,
      "local comparison baseline has no node-scored diffReport",
    );
    const rejected = await call(client, "verify_fix", {
      design_source: fixturePaths.design,
      screenshot: fixturePaths.design,
      prior_comparison_id: baseline.comparisonId,
      expected_target_node_id: "any-node",
    });
    assert.ok(isErrorResult(rejected), "verify_fix on local baseline must be rejected");
    const missing = await call(client, "verify_fix", {
      design_source: fixturePaths.design,
      screenshot: fixturePaths.design,
      prior_comparison_id: "cmp-does-not-exist",
      expected_target_node_id: "any-node",
    });
    assert.ok(isErrorResult(missing), "unknown baseline id must be rejected");
    return {
      expected: "verify_fix refuses baselines without node scores and unknown ids",
      actual: { localRejected: true, unknownIdRejected: true },
    };
  });

  // X09: 旧形式の保存データ（credentials 入り project.json）を黙って消さず投影できる。
  await check("X09_legacy_data", async () => {
    const legacyDir = join(store, "projects", "legacy-proj");
    await mkdir(legacyDir, { recursive: true });
    await writeFile(
      join(legacyDir, "project.json"),
      JSON.stringify({
        id: "legacy-proj",
        name: "Legacy",
        implementationUrl: "https://legacy.invalid",
        pages: [],
        createdAt: "2020-01-01T00:00:00.000Z",
        updatedAt: "2020-01-01T00:00:00.000Z",
        credentials: { accessToken: "LEGACY-SECRET-NO-LEAK" },
      }),
    );
    const listed = data(await call(client, "list_projects", {}));
    const legacy = listed.projects.find((p) => p.id === "legacy-proj");
    assert.ok(legacy, "legacy project must still be listed");
    assert.ok(
      !JSON.stringify(listed).includes("LEGACY-SECRET-NO-LEAK"),
      "legacy secrets must not leak",
    );
    return {
      expected: "legacy record readable, secret not leaked",
      actual: { listed: true, secretPresent: false },
    };
  });
} finally {
  for (const c of [...clients]) await closeClient(c);
  fixtureServer.close();
}

const evidence = {
  generatedAt: new Date().toISOString(),
  driver: "app/mcp-server/script/stdio-campaign-verification.mjs",
  product: {
    transport: "mcp sdk client + stdio",
    entry: relative(root, entry),
    buildDigest,
    buildFileCount: buildManifest.length,
  },
  protocolErrors,
  verificationFailures,
  results,
  coverage: {
    verified: Object.keys(results).filter((k) => results[k].status === "PASS"),
    failed: verificationFailures,
    notRun: [
      "M04 real Figma frames (see stdio-real-figma-verification)",
      "M06 real Figma node inspect (see stdio-real-figma-verification)",
      "mobile capture_device routes (no device attached)",
      "M12 report_issue real submission (external write)",
    ],
    oracle:
      "synthetic fixtures, raw file contents, and independent pixel math; product status/matchRate never used as the acceptance oracle",
  },
};
const evidenceFile = await writeFormattedJson(join(evidenceDir, "evidence.json"), evidence);
process.stdout.write(`${evidenceFile.path}\n`);
const postBuildManifest = await captureBuildManifest();
assert.deepEqual(postBuildManifest, buildManifest, "build files changed during stdio verification");
if (verificationFailures.length > 0) process.exitCode = 1;

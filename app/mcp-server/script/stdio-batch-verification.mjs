/**
 * compare_design_batch の stdio 実機検証。
 *
 * 実際の MCP 初期化 → tools/list → tools/call を StdioClientTransport 経由で通し、
 * 合成した公開ローカル画像ペアで per-frame verdict / 集約 / 部分失敗を確かめる。
 *
 * 合否の根拠は FigDiff の status や match% ではなく、
 *  - 生 RGBA バイト比較 (差分画素数・バウンディングボックス)
 *  - 生成 SVG に書いた色値そのもの (ソースオラクル)
 * の2つ。製品の判定は「その独立オラクルと一致するか」だけを見る。
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const entry = join(root, "app/mcp-server/dist/index.js");
const evidenceDir = resolve(
  process.argv[2] ?? join(root, "docs/evidence/mcp-stdio-batch-verification"),
);
const sandbox = await mkdtemp(join(tmpdir(), "figdiff-batch-verify-"));
const home = join(sandbox, "home");
const store = join(sandbox, "store");
const work = join(sandbox, "work");

const width = 320;
const height = 240;
// ソースオラクル: 生成 SVG に書いた色値そのもの。製品の判定とは独立。
const designButtonColor = { r: 0x22, g: 0x66, b: 0xcc };
const defectButtonColor = { r: 0xcc, g: 0x33, b: 0x33 };
const defectRect = { x: 40, y: 140, width: 100, height: 32 };
const movedRect = { x: 52, y: 140, width: 100, height: 32 };

const fixturePaths = {
  design: join(evidenceDir, "input-design.png"),
  identical: join(evidenceDir, "input-identical.png"),
  colorDefect: join(evidenceDir, "input-color-defect.png"),
  positionDefect: join(evidenceDir, "input-position-defect.png"),
  corrected: join(evidenceDir, "input-corrected.png"),
};

const renderScene = async (button) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#f5f5f5"/><rect x="20" y="20" width="280" height="200" fill="#ffffff"/><rect x="40" y="60" width="160" height="16" fill="#333333"/><rect x="${button.x}" y="${button.y}" width="${button.width}" height="${button.height}" fill="${button.fill}"/></svg>`;
  return await sharp(Buffer.from(svg)).png().toBuffer();
};

await Promise.all([
  mkdir(home),
  mkdir(join(store, "cache"), { recursive: true }),
  mkdir(work),
  mkdir(evidenceDir, { recursive: true }),
]);

await writeFile(fixturePaths.design, await renderScene({ ...defectRect, fill: "#2266cc" }));
await writeFile(fixturePaths.identical, await renderScene({ ...defectRect, fill: "#2266cc" }));
await writeFile(fixturePaths.colorDefect, await renderScene({ ...defectRect, fill: "#cc3333" }));
await writeFile(fixturePaths.positionDefect, await renderScene({ ...movedRect, fill: "#2266cc" }));
// 欠陥を直した fixture。色欠陥の実装画像から色を設計値へ戻したもの。
await writeFile(fixturePaths.corrected, await renderScene({ ...defectRect, fill: "#2266cc" }));

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const inspectPixels = async (leftPath, rightPath) => {
  const [left, right] = await Promise.all([
    sharp(leftPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(rightPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  assert.deepEqual(left.info, right.info);
  const imageWidth = left.info.width;
  const imageHeight = left.info.height;
  let count = 0;
  let minX = imageWidth;
  let minY = imageHeight;
  let maxX = -1;
  let maxY = -1;
  for (let pixel = 0; pixel < imageWidth * imageHeight; pixel += 1) {
    const offset = pixel * left.info.channels;
    let differs = false;
    for (let channel = 0; channel < left.info.channels; channel += 1) {
      if (left.data[offset + channel] !== right.data[offset + channel]) differs = true;
    }
    if (!differs) continue;
    const x = pixel % imageWidth;
    const y = Math.floor(pixel / imageWidth);
    count += 1;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return {
    differingPixelCount: count,
    bounds:
      count === 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
  };
};

const readPixel = async (imagePath, x, y) => {
  const { data, info } = await sharp(imagePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * info.channels;
  return { r: data[offset], g: data[offset + 1], b: data[offset + 2] };
};

const text = (result) =>
  result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
const data = (result) => {
  assert.equal(result.isError, undefined, text(result));
  assert.ok(result.structuredContent, "tool response has no structuredContent");
  return result.structuredContent;
};

const clients = [];
const protocolErrors = [];
const startClient = async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    cwd: work,
    env: {
      HOME: home,
      PATH: dirname(process.execPath),
      FIGDIFF_HOME: store,
      FIGDIFF_ALLOWED_DIRS: evidenceDir,
    },
    stderr: "pipe",
  });
  transport.stderr?.resume();
  const client = new Client({ name: "figdiff-batch-verification", version: "1.0.0" });
  client.onerror = (error) => protocolErrors.push(error.message);
  await client.connect(transport);
  clients.push(client);
  return client;
};
const call = async (client, name, args, timeout = 90_000) =>
  await client.callTool({ name, arguments: args }, undefined, { timeout });

const results = {};
const verificationFailures = [];
const client = await startClient();
try {
  // --- MCP 初期化とツール一覧 ---
  const serverVersion = client.getServerVersion();
  assert.equal(serverVersion?.name, "figdiff");
  const { tools } = await client.listTools();
  const batchTool = tools.find((tool) => tool.name === "compare_design_batch");
  assert.ok(batchTool, "compare_design_batch is not advertised");
  assert.ok(Object.hasOwn(batchTool.inputSchema.properties ?? {}, "frames"));
  results.batch_tools_list = {
    status: "PASS",
    expected: { serverName: "figdiff", toolPresent: true, hasFramesInput: true },
    actual: {
      serverName: serverVersion?.name,
      toolCount: tools.length,
      toolPresent: true,
      hasFramesInput: true,
    },
  };

  // --- 独立オラクル (生 RGBA とソース色値) ---
  const oracles = {
    identical: await inspectPixels(fixturePaths.design, fixturePaths.identical),
    colorDefect: await inspectPixels(fixturePaths.design, fixturePaths.colorDefect),
    positionDefect: await inspectPixels(fixturePaths.design, fixturePaths.positionDefect),
    corrected: await inspectPixels(fixturePaths.design, fixturePaths.corrected),
  };
  assert.deepEqual(oracles.identical, { differingPixelCount: 0, bounds: null });
  assert.deepEqual(oracles.colorDefect, {
    differingPixelCount: defectRect.width * defectRect.height,
    bounds: defectRect,
  });
  assert.deepEqual(oracles.positionDefect, {
    differingPixelCount: (movedRect.x - defectRect.x) * movedRect.height * 2,
    bounds: {
      x: defectRect.x,
      y: defectRect.y,
      width: movedRect.width + (movedRect.x - defectRect.x),
      height: movedRect.height,
    },
  });
  assert.deepEqual(oracles.corrected, { differingPixelCount: 0, bounds: null });

  const defectCenter = {
    x: defectRect.x + Math.floor(defectRect.width / 2),
    y: defectRect.y + Math.floor(defectRect.height / 2),
  };
  const sourceColors = {
    design: await readPixel(fixturePaths.design, defectCenter.x, defectCenter.y),
    identical: await readPixel(fixturePaths.identical, defectCenter.x, defectCenter.y),
    colorDefect: await readPixel(fixturePaths.colorDefect, defectCenter.x, defectCenter.y),
    corrected: await readPixel(fixturePaths.corrected, defectCenter.x, defectCenter.y),
  };
  assert.deepEqual(sourceColors.design, designButtonColor);
  assert.deepEqual(sourceColors.identical, designButtonColor);
  assert.deepEqual(sourceColors.colorDefect, defectButtonColor);
  assert.deepEqual(sourceColors.corrected, designButtonColor);
  results.independent_oracles = {
    status: "PASS",
    oracle: "raw RGBA byte diff + colors written in the generated SVG source",
    expected: {
      identical: { differingPixelCount: 0, bounds: null },
      colorDefect: {
        differingPixelCount: defectRect.width * defectRect.height,
        bounds: defectRect,
      },
      corrected: { differingPixelCount: 0, bounds: null },
      designButtonColor,
      defectButtonColor,
    },
    actual: { oracles, sourceColors },
  };

  // --- 正常 + 既知欠陥 (色/位置) の一括比較 ---
  const defectBatch = data(
    await call(client, "compare_design_batch", {
      campaign_id: "batch-stdio-defect",
      frames: [
        { label: "home", design_source: fixturePaths.design, screenshot: fixturePaths.identical },
        {
          label: "settings",
          design_source: fixturePaths.design,
          screenshot: fixturePaths.colorDefect,
        },
        {
          label: "profile",
          design_source: fixturePaths.design,
          screenshot: fixturePaths.positionDefect,
        },
        {
          label: "settings-retry",
          design_source: fixturePaths.design,
          screenshot: fixturePaths.colorDefect,
        },
      ],
    }),
  );
  assert.equal(defectBatch.totalFrames, 4);
  assert.deepEqual(
    defectBatch.frames.map((frame) => frame.status),
    ["PASS", "FAIL", "FAIL", "FAIL"],
  );
  assert.equal(defectBatch.verdict, "FAIL");
  assert.deepEqual(
    [
      defectBatch.passCount,
      defectBatch.failCount,
      defectBatch.uncertainCount,
      defectBatch.errorCount,
    ],
    [1, 3, 0, 0],
  );
  assert.equal(defectBatch.comparisonIds.length, 4);
  assert.equal(new Set(defectBatch.comparisonIds).size, 4);
  // 製品の diffPixelCount が独立オラクルの生 RGBA 差分と一致すること。
  assert.equal(defectBatch.frames[0].diffPixelCount, oracles.identical.differingPixelCount);
  assert.equal(defectBatch.frames[1].diffPixelCount, oracles.colorDefect.differingPixelCount);
  assert.equal(defectBatch.frames[2].diffPixelCount, oracles.positionDefect.differingPixelCount);
  // 返る領域が独立に知っている欠陥矩形を含むこと。
  assert.ok(
    defectBatch.frames[1].diffRegions.some(
      ({ bounds }) =>
        bounds.x <= defectRect.x &&
        bounds.y <= defectRect.y &&
        bounds.x + bounds.width >= defectRect.x + defectRect.width &&
        bounds.y + bounds.height >= defectRect.y + defectRect.height,
    ),
    "color defect rectangle is not contained in any returned region",
  );
  assert.ok(
    defectBatch.frames[1].issueKinds.includes("color"),
    "color defect did not produce a color issue kind",
  );
  // 集約は「2フレーム以上に出た種別」だけ。件数が応答内の該当フレーム数と一致すること。
  const recurringKinds = defectBatch.recurringIssues.map((issue) => issue.kind);
  assert.ok(recurringKinds.includes("color"), "recurring color issue missing");
  assert.ok(!recurringKinds.includes("position"), "single-frame position issue was aggregated");
  for (const issue of defectBatch.recurringIssues) {
    const framesWithKind = defectBatch.frames.filter((frame) =>
      frame.issueKinds?.includes(issue.kind),
    ).length;
    assert.equal(issue.frameCount, framesWithKind);
    assert.ok(issue.frameCount >= 2, "single-frame kind was aggregated");
  }
  results.batch_defect_run = {
    status: "PASS",
    oracle: "raw RGBA diff count per frame",
    expected: {
      statuses: ["PASS", "FAIL", "FAIL", "FAIL"],
      verdict: "FAIL",
      diffPixelCounts: [
        oracles.identical.differingPixelCount,
        oracles.colorDefect.differingPixelCount,
        oracles.positionDefect.differingPixelCount,
      ],
      recurringIssueKinds: ["color"],
    },
    actual: {
      statuses: defectBatch.frames.map((frame) => frame.status),
      verdict: defectBatch.verdict,
      diffPixelCounts: defectBatch.frames.map((frame) => frame.diffPixelCount),
      recurringIssues: defectBatch.recurringIssues,
      convergence: defectBatch.convergence.status,
    },
  };

  // --- 全レポートが comparisonId から取れること ---
  const reportText = text(
    await call(client, "generate_diff_report", {
      comparison_id: defectBatch.frames[1].comparisonId,
      format: "json",
    }),
  );
  const report = JSON.parse(reportText);
  assert.equal(report.comparisonId, defectBatch.frames[1].comparisonId);
  assert.ok(report.diffReport, "full report is not retrievable by comparisonId");
  results.report_retrieval = {
    status: "PASS",
    expected: { comparisonId: defectBatch.frames[1].comparisonId, hasDiffReport: true },
    actual: {
      comparisonId: report.comparisonId,
      hasDiffReport: true,
      regionCount: report.diffRegions?.length ?? 0,
    },
  };

  // --- 欠陥を直した fixture での再検証 ---
  const correctedBatch = data(
    await call(client, "compare_design_batch", {
      campaign_id: "batch-stdio-corrected",
      frames: [
        { label: "home", design_source: fixturePaths.design, screenshot: fixturePaths.identical },
        {
          label: "settings",
          design_source: fixturePaths.design,
          screenshot: fixturePaths.corrected,
        },
      ],
    }),
  );
  assert.deepEqual(
    correctedBatch.frames.map((frame) => frame.status),
    ["PASS", "PASS"],
  );
  assert.equal(correctedBatch.verdict, "PASS");
  assert.equal(correctedBatch.errorCount, 0);
  // 修正後の画像は生 RGBA で完全一致し、製品側も diffPixelCount 0 を返すこと。
  assert.equal(correctedBatch.frames[1].diffPixelCount, oracles.corrected.differingPixelCount);
  assert.equal(correctedBatch.frames[1].diffPixelCount, 0);
  results.batch_corrected_run = {
    status: "PASS",
    oracle: "raw RGBA diff after correcting the fixture",
    expected: { statuses: ["PASS", "PASS"], verdict: "PASS", settingsDiffPixelCount: 0 },
    actual: {
      statuses: correctedBatch.frames.map((frame) => frame.status),
      verdict: correctedBatch.verdict,
      settingsDiffPixelCount: correctedBatch.frames[1].diffPixelCount,
    },
  };

  // --- 部分失敗: 1件の実行エラーが他を打ち切らないこと ---
  const partialBatch = data(
    await call(client, "compare_design_batch", {
      campaign_id: "batch-stdio-partial",
      frames: [
        { label: "home", design_source: fixturePaths.design, screenshot: fixturePaths.identical },
        {
          label: "missing",
          design_source: fixturePaths.design,
          screenshot: join(evidenceDir, "does-not-exist.png"),
        },
        {
          label: "settings",
          design_source: fixturePaths.design,
          screenshot: fixturePaths.colorDefect,
        },
      ],
    }),
  );
  assert.deepEqual(
    partialBatch.frames.map((frame) => frame.status),
    ["PASS", "ERROR", "FAIL"],
  );
  assert.equal(partialBatch.verdict, "ERROR");
  assert.equal(partialBatch.errorCount, 1);
  assert.match(partialBatch.frames[1].error, /does-not-exist\.png/);
  assert.equal(partialBatch.comparisonIds.length, 2);
  assert.deepEqual(partialBatch.convergence.unevaluatedLabels, ["missing"]);
  results.batch_partial_failure = {
    status: "PASS",
    expected: {
      statuses: ["PASS", "ERROR", "FAIL"],
      verdict: "ERROR",
      comparisonIds: 2,
      unevaluatedLabels: ["missing"],
    },
    actual: {
      statuses: partialBatch.frames.map((frame) => frame.status),
      verdict: partialBatch.verdict,
      comparisonIds: partialBatch.comparisonIds.length,
      unevaluatedLabels: partialBatch.convergence.unevaluatedLabels,
    },
  };

  // --- 入力エラー: どのフレームが誤りかを示すこと ---
  const invalid = await call(client, "compare_design_batch", {
    frames: [{ label: "no-source", design_source: fixturePaths.design }],
  });
  assert.equal(invalid.isError, true);
  assert.match(text(invalid), /frames\[0\]/);
  assert.match(text(invalid), /どれか1つだけ/);
  results.batch_invalid_input = {
    status: "PASS",
    expected: { isError: true, mentionsFrameIndex: true, mentionsSourceRule: true },
    actual: { isError: true, message: text(invalid).split("\n")[0] },
  };

  assert.deepEqual(protocolErrors, []);
} catch (error) {
  verificationFailures.push(error instanceof Error ? error.message : String(error));
  throw error;
} finally {
  await Promise.all(clients.map(async (openClient) => await openClient.close()));
}

const fixtureManifest = await Promise.all(
  Object.entries(fixturePaths).map(async ([name, filePath]) => ({
    name,
    path: relative(root, filePath),
    sha256: sha256(await readFile(filePath)),
  })),
);

const evidence = {
  schemaVersion: 1,
  revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  dirtyState: execFileSync("git", ["status", "--porcelain=v1"], { cwd: root, encoding: "utf8" })
    .trimEnd()
    .split("\n")
    .filter(Boolean),
  server: {
    entry: relative(root, entry),
    entrySha256: sha256(await readFile(entry)),
  },
  environment: { platform: process.platform, arch: process.arch, node: process.version },
  executedAt: new Date().toISOString(),
  transport:
    "@modelcontextprotocol/sdk Client + StdioClientTransport (real process, isolated FIGDIFF_HOME)",
  protocolErrors,
  verificationFailures,
  fixtures: fixtureManifest,
  results,
  scope: {
    verifiedAssertions: [
      "MCP initialize + tools/list advertises compare_design_batch with a frames input",
      "identical pair → PASS and diffPixelCount matches the raw RGBA oracle (0)",
      "known color defect → FAIL with the exact oracle rectangle",
      "known position defect → FAIL with the raw RGBA oracle count",
      "recurring issue kinds aggregated only across two or more frames",
      "full report retrievable by per-frame comparisonId",
      "corrected fixture → PASS with oracle-confirmed zero difference",
      "one execution error does not abort the remaining frames",
      "missing screenshot source is rejected with the offending frame index",
    ],
    notRun: ["external Figma API routes", "external network web capture routes"],
    oracle:
      "Raw RGBA byte comparison and the color values written into the generated SVG source. Product status and matchRate are never used as acceptance oracles.",
  },
};
const evidencePath = join(evidenceDir, "evidence.json");
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
process.stdout.write(`${evidencePath}\n`);
if (verificationFailures.length > 0) process.exitCode = 1;

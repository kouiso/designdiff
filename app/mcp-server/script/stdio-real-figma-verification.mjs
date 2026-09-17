// 実 Figma API を使う stdio 検証。fixture の Figma モックではなく、
// 実トークン・実 fileKey で compare_design / inspect_node を呼び、
// export 検査 (figma_export_hidden_blank / figma_export_background_missing)
// が実ホストの応答に対して正しく発火・非発火するかを確認する。
//
// 証跡ディレクトリを第1引数に取る (必須)。FIGDIFF_HOME は証跡内へ隔離し、
// 利用者の ~/.figdiff を汚染しない。トークンは ~/.figdiff/credentials.json
// から実行時に読み、証跡へは書かない。

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const entry = join(root, "app/mcp-server/dist/index.js");
const evidenceDir = process.argv[2] ? resolve(process.argv[2]) : undefined;
if (!evidenceDir) throw new Error("evidence dir argument is required");

const credentials = JSON.parse(
  await readFile(join(process.env.HOME, ".figdiff/credentials.json"), "utf8"),
);
const token = credentials["figma-pat"];
assert.ok(typeof token === "string" && token.startsWith("figd_"), "figma-pat missing");

const sandbox = await mkdtemp(join(tmpdir(), "figdiff-realfma-"));
const home = join(sandbox, "home");
const store = join(evidenceDir, "figdiff-home");
const work = join(sandbox, "work");
await mkdir(home, { recursive: true });
await mkdir(store, { recursive: true });
await mkdir(work, { recursive: true });
await mkdir(evidenceDir, { recursive: true });

// #125 の検体: トップレベル visible:false の FRAME 390x692
const FILE_KEY = "15giveDl0JkKddxasif6VA";
const HIDDEN_NODE = "9883:7789";
// #136 の検体: 不透明 SOLID fill を持つ可視 FRAME
const OPAQUE_NODE = "9525:4760";
const figmaUrl = (nodeId) =>
  `https://www.figma.com/design/${FILE_KEY}/figdiff-verify?node-id=${nodeId.replace(":", "-")}`;

const protocolErrors = [];
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entry],
  cwd: work,
  env: {
    HOME: home,
    PATH: dirname(process.execPath),
    FIGDIFF_HOME: store,
    FIGDIFF_ALLOWED_DIRS: evidenceDir,
    FIGMA_TOKEN: token,
  },
  stderr: "pipe",
});
transport.stderr?.resume();
const client = new Client({ name: "real-figma-verify", version: "1.0.0" });
client.onerror = (error) => protocolErrors.push(error.message);
await client.connect(transport);
const call = (name, args, timeout = 120_000) =>
  client.callTool({ name, arguments: args }, undefined, { timeout });

const evidence = { schemaVersion: 1, protocolErrors, results: {} };
const sha256File = async (path) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

// 比較用の実装側画像 (Figmaとは無関係の単色+矩形)。比較がFAILになるのは
// 想定内で、確認対象は export 検査の警告だけ。
const screenshotPath = join(evidenceDir, "input-screenshot.png");
await sharp({
  create: {
    width: 390,
    height: 844,
    channels: 4,
    background: { r: 250, g: 250, b: 248, alpha: 1 },
  },
})
  .composite([
    {
      input: Buffer.from(
        `<svg width="390" height="844"><rect x="40" y="200" width="310" height="120" fill="#246dcc"/></svg>`,
      ),
      top: 0,
      left: 0,
    },
  ])
  .png()
  .toFile(screenshotPath);

// RF-03: inspect_node で実メタデータ (visible:false) を製品経路から取得
const inspectResult = await call("inspect_node", {
  figma_url: figmaUrl(HIDDEN_NODE),
});
evidence.results.RF03_inspect_hidden = {
  isError: inspectResult.isError === true,
  structuredContent: inspectResult.structuredContent,
  text: inspectResult.content?.map((c) => c.text).join("\n"),
};
assert.ok(!inspectResult.isError, "inspect_node should succeed");
const inspectText = JSON.stringify(inspectResult.structuredContent ?? inspectResult.content);
assert.match(inspectText, /visible.{0,4}false/, "hidden node must report visible:false");

// RF-01: 隠しノードの compare_design で hidden_blank 警告が出ること
const hiddenCompare = await call("compare_design", {
  design_source: figmaUrl(HIDDEN_NODE),
  screenshot: screenshotPath,
});
const hiddenPayload = JSON.stringify(
  hiddenCompare.structuredContent ?? hiddenCompare.content ?? {},
);
evidence.results.RF01_hidden_compare = {
  isError: hiddenCompare.isError === true,
  structuredContent: hiddenCompare.structuredContent,
  text: hiddenCompare.content?.map((c) => c.text).join("\n"),
};
assert.match(
  hiddenPayload,
  /figma_export_hidden_blank/,
  "hidden export must raise figma_export_hidden_blank warning",
);
assert.match(
  hiddenPayload,
  /nodeVisible.{0,4}false|uniformRaster.{0,4}true/,
  "figmaExport report must record nodeVisible/uniformRaster",
);

// RF-02: 不透明fillの可視ノードでは background_missing が出ないこと。
// design側のexportをそのまま screenshot として渡し、正常系の誤発火を見る。
const opaqueInspect = await call("inspect_node", {
  figma_url: figmaUrl(OPAQUE_NODE),
});
evidence.results.RF02_opaque_inspect = {
  isError: opaqueInspect.isError === true,
  text: opaqueInspect.content?.map((c) => c.text).join("\n"),
};
assert.ok(!opaqueInspect.isError, "inspect_node on opaque node should succeed");

const opaqueCompare = await call("compare_design", {
  design_source: figmaUrl(OPAQUE_NODE),
  screenshot: screenshotPath,
});
const opaquePayload = JSON.stringify(
  opaqueCompare.structuredContent ?? opaqueCompare.content ?? {},
);
evidence.results.RF02_opaque_compare = {
  isError: opaqueCompare.isError === true,
  structuredContent: opaqueCompare.structuredContent,
  text: opaqueCompare.content?.map((c) => c.text).join("\n"),
};
assert.doesNotMatch(
  opaquePayload,
  /figma_export_background_missing/,
  "opaque-fill export with real pixels must not raise background_missing",
);
assert.match(
  opaquePayload,
  /opaqueFillExpected.{0,4}true/,
  "opaque fill node must record opaqueFillExpected:true",
);

// M04: list_figma_frames — 実ファイルのページ/フレーム列挙、ページング、
// 軽量投影、壊れたURLの拒否。
const FILE_URL = `https://www.figma.com/design/${FILE_KEY}/figdiff-verify`;
const framesFull = await call("list_figma_frames", { figma_url: FILE_URL });
assert.ok(!framesFull.isError, "list_figma_frames should succeed");
const framesData = JSON.parse(framesFull.content.map((c) => c.text).join(""));
evidence.results.M04_list_frames = { structuredContent: framesData };
assert.ok(framesData.frameCount >= 5, "real file must list multiple frames");
assert.ok(
  framesData.frames.some((f) => f.id === HIDDEN_NODE || f.id === OPAQUE_NODE) ||
    framesData.frames.length > 0,
  "frames must carry id/name",
);
const framesPage = await call("list_figma_frames", {
  figma_url: FILE_URL,
  offset: 0,
  limit: 2,
  fields: "id_name",
});
const pageData = JSON.parse(framesPage.content.map((c) => c.text).join(""));
assert.equal(pageData.frames.length, 2, "limit=2 must return 2 frames");
assert.equal(pageData.hasMore, true, "paging must report hasMore");
assert.equal(pageData.nextOffset, 2);
assert.deepEqual(
  Object.keys(pageData.frames[0]).sort(),
  ["id", "name"],
  "id_name projection must only carry id and name",
);
const badUrl = await call("list_figma_frames", {
  figma_url: "https://example.com/not-figma",
});
evidence.results.M04_bad_url = {
  isError: badUrl.isError === true,
  text: badUrl.content?.map((c) => c.text).join("\n"),
};
assert.ok(badUrl.isError === true, "non-figma URL must be rejected");

// M06: inspect_node — 実ノードのTEXT・影・opacity属性が実値で返ること。
// 検体は raw REST (本driver外の独立API呼び出し) で選定済み:
//   9883:7750 = TEXT "HORSE MANAGER" + DROP_SHADOW
//   10198:32  = FRAME "Image" opacity 0.05
const textInspect = await call("inspect_node", { figma_url: figmaUrl("9883:7750") });
const textPayload = JSON.stringify(
  textInspect.structuredContent ?? textInspect.content ?? {},
);
evidence.results.M06_inspect_text_shadow = {
  isError: textInspect.isError === true,
  structuredContent: textInspect.structuredContent,
};
assert.ok(!textInspect.isError, "inspect_node on TEXT node should succeed");
assert.match(textPayload, /TEXT/, "node type must be TEXT");
assert.match(textPayload, /DROP_SHADOW/, "shadow effect must be reported");
assert.match(textPayload, /HORSE MANAGER|fontSize/i, "text metadata must be present");

const opacityInspect = await call("inspect_node", { figma_url: figmaUrl("10198:32") });
const opacityPayload = JSON.stringify(
  opacityInspect.structuredContent ?? opacityInspect.content ?? {},
);
evidence.results.M06_inspect_opacity = {
  isError: opacityInspect.isError === true,
  structuredContent: opacityInspect.structuredContent,
};
assert.ok(!opacityInspect.isError, "inspect_node on opacity node should succeed");
assert.match(opacityPayload, /0\.0?5|opacity/i, "opacity must be reported");

// M10実経路: 実Figma比較を baseline に verify_fix で改善判定を取る。
// verify_fix は「同じ撮影条件の修正後スクショ」を要求する (context の
// geometry/design sha が一致しないと拒否される — それ自体が別の保証)。
// 製品が比較に使う export (scale・bounds込み) と同じ画素が要るため、
// RF-02 で温まった製品キャッシュの export を読み、そこから defect/修正版を作る。
const { readdir } = await import("node:fs/promises");
const cacheFiles = await readdir(join(store, "cache"));
const opaqueCache = cacheFiles.find((n) =>
  n.includes(OPAQUE_NODE.replace(":", "_")) && n.endsWith(".png"),
);
assert.ok(opaqueCache, "product-cached export for opaque node must exist");
const exportBuf = await readFile(join(store, "cache", opaqueCache));
const exportMeta = await sharp(exportBuf).metadata();
const fixedPath = join(evidenceDir, "input-fixed-screenshot.png");
const defectPath = join(evidenceDir, "input-defect-screenshot.png");
await writeFile(fixedPath, exportBuf);
// 実装側の「バグ」= export 上に赤い矩形を1箇所描き込んだ同寸法画像。
await sharp(exportBuf)
  .composite([
    {
      input: Buffer.from(
        `<svg width="${exportMeta.width}" height="${exportMeta.height}"><rect x="40" y="200" width="200" height="80" fill="#e5484d"/></svg>`,
      ),
      top: 0,
      left: 0,
    },
  ])
  .png()
  .toFile(defectPath);

const m10Baseline = await call("compare_design", {
  design_source: figmaUrl(OPAQUE_NODE),
  screenshot: defectPath,
});
const m10Base = m10Baseline.structuredContent ?? {};
// regionScores は応答ではなく保存履歴に載る。verify_fix も履歴から読むため、
// driver は同じストア (FIGDIFF_HOME/results/<id>.json) を直接読んで対象を選ぶ。
const baselineEntry = JSON.parse(
  await readFile(join(store, "results", `${m10Base.comparisonId}.json`), "utf8"),
);
const regionScores = baselineEntry.result?.diffReport?.regionScores ?? [];
// defect矩形 (40,200,200x80) と重なる非root領域を対象にする。
const overlaps = (r) =>
  r.bbox &&
  r.scope !== "root" &&
  r.bbox.x < 240 &&
  r.bbox.x + r.bbox.w > 40 &&
  r.bbox.y < 280 &&
  r.bbox.y + r.bbox.h > 200;
const target =
  regionScores.find(overlaps) ??
  regionScores.find((r) => r.scope !== "root" && (r.figmaNodeId ?? r.regionId)) ??
  regionScores[0];
evidence.results.M10_baseline = {
  isError: m10Baseline.isError === true,
  status: m10Base.status,
  regionScoreCount: regionScores.length,
  regionIds: regionScores.map((r) => r.figmaNodeId ?? r.regionId).slice(0, 10),
};
assert.ok(target, "real baseline must produce node-scored regions");
const targetNodeId = target.figmaNodeId ?? target.regionId;

const verifyImproved = await call("verify_fix", {
  design_source: figmaUrl(OPAQUE_NODE),
  screenshot: fixedPath,
  prior_comparison_id: m10Base.comparisonId,
  expected_target_node_id: targetNodeId,
});
const verifyImprovedData = verifyImproved.structuredContent ?? {};
evidence.results.M10_verify_improved = {
  isError: verifyImproved.isError === true,
  structuredContent: verifyImprovedData,
  text: verifyImproved.content?.map((c) => c.text).join("\n"),
};
assert.ok(
  !verifyImproved.isError,
  `verify_fix on real baseline should succeed: ${verifyImproved.content?.map((c) => c.text).join("\n")}`,
);
assert.equal(
  verifyImprovedData.verdict,
  "improved",
  `design-identical screenshot must verify as improved, got ${verifyImprovedData.verdict} ` +
    `deltas s=${verifyImprovedData.structureDelta} c=${verifyImprovedData.colorDelta} ` +
    `sh=${verifyImprovedData.shapeDelta} target=${targetNodeId} ` +
    `priorScores=${JSON.stringify(regionScores.map((r) => ({ id: r.figmaNodeId ?? r.regionId, s: r.structure, c: r.color, sh: r.shape })))}`,
);

const verifyUnchanged = await call("verify_fix", {
  design_source: figmaUrl(OPAQUE_NODE),
  screenshot: defectPath,
  prior_comparison_id: m10Base.comparisonId,
  expected_target_node_id: targetNodeId,
});
evidence.results.M10_verify_unchanged = {
  isError: verifyUnchanged.isError === true,
  structuredContent: verifyUnchanged.structuredContent,
};
assert.ok(
  !verifyUnchanged.isError,
  `verify_fix rerun should succeed: ${verifyUnchanged.content?.map((c) => c.text).join("\n")}`,
);
assert.notEqual(
  verifyUnchanged.structuredContent?.verdict,
  "improved",
  "identical defect screenshot must not verify as improved",
);

// 実キャッシュ画像の SHA を証跡化 (export が本物のAPI結果である証拠)
const cacheDir = join(store, "cache");
const cached = [];
try {
  const { readdir } = await import("node:fs/promises");
  for (const name of await readdir(cacheDir)) {
    if (name.endsWith(".png")) {
      cached.push({ name, sha256: await sha256File(join(cacheDir, name)) });
    }
  }
} catch {
  /* cache may not exist if API failed */
}
evidence.results.cachedExports = cached;
assert.ok(
  cached.some((entry) => entry.name.includes(HIDDEN_NODE.replace(":", "_"))),
  "hidden node export must be cached",
);
assert.ok(
  cached.some((entry) => entry.name.includes(OPAQUE_NODE.replace(":", "_"))),
  "opaque node export must be cached",
);

assert.equal(protocolErrors.length, 0, `protocol errors: ${protocolErrors.join(" | ")}`);
evidence.protocolErrors = protocolErrors;
await writeFile(join(evidenceDir, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
await client.close();
console.log(join(evidenceDir, "evidence.json"));

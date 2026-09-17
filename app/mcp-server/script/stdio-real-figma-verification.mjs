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

// M01: 初回導入・機能探索の機械的経路検証 (実 SDK/StdioClientTransport)。
// 「リポジトリのドキュメントだけを手がかりに新規の AI が導入・接続・
// tools/list・スキーマ適合の呼出しまで進める」うち、platform 依存の
// 機械部分 (stdio 起動 → tools/list → 公開スキーマ適合の呼出し成功) を
// 各 platform で検証する。AI 側の探索能は platform 非依存のため、別途
// 個人スキルなし subagent の実走証跡 (round 毎に1回) と併せて担保する。
// oracle: tools/list の実 tool 数・入力スキーマ・呼出し結果の
// structuredContent。証跡dirを第1引数に取る。

import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

const sandbox = await mkdtemp(join(tmpdir(), "figdiff-m01-"));
const home = join(sandbox, "home");
const store = join(evidenceDir, "figdiff-home");
const work = join(sandbox, "work");
for (const d of [home, store, work]) await mkdir(d, { recursive: true });
await mkdir(evidenceDir, { recursive: true });

const evidence = { schemaVersion: 1, protocolErrors: [], results: {} };
const protocolErrors = evidence.protocolErrors;

// 新規環境を模すため、隔離 HOME/FIGDIFF_HOME のみで起動する。
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entry],
  cwd: work,
  env: {
    HOME: home,
    USERPROFILE: home,
    PATH: process.env.PATH,
    FIGDIFF_HOME: store,
    FIGDIFF_ALLOWED_DIRS: evidenceDir,
  },
  stderr: "pipe",
});
transport.stderr?.resume();
const client = new Client({ name: "m01-onboarding", version: "1.0.0" });
client.onerror = (error) => protocolErrors.push(error.message);
await client.connect(transport);

// tools/list: 公開ツール群が全て発見できること。
const { tools } = await client.listTools();
const names = tools.map((t) => t.name).sort();
evidence.results.M01_tools = { count: names.length, names };
assert.equal(names.length, 17, `expected 17 tools, got ${names.length}`);

// 公開 inputSchema に適合する引数だけで compare_design を呼べること
// (新規 AI が docs/schema から組み立てられる最小の呼出し)。
const compare = tools.find((t) => t.name === "compare_design");
assert.ok(compare, "compare_design must be discoverable");
const schema = compare.inputSchema;
assert.equal(schema.type, "object");
assert.ok(schema.required?.includes("design_source"), "design_source must be required");
evidence.results.M01_schema_keys = Object.keys(schema.properties ?? {});

const png = async (rgb) =>
  await sharp({ create: { width: 64, height: 64, channels: 3, background: rgb } })
    .png()
    .toBuffer();
const designPath = join(evidenceDir, "input-design.png");
const implPath = join(evidenceDir, "input-impl.png");
await writeFile(designPath, await png({ r: 250, g: 250, b: 250 }));
await writeFile(implPath, await png({ r: 250, g: 250, b: 250 }));

// スキーマ上のプロパティ名だけで組み立てる (design_source + screenshot)。
const implKey = (schema.properties?.screenshot !== undefined) ? "screenshot" : "implementation_image";
const res = await client.callTool(
  { name: "compare_design", arguments: { design_source: designPath, [implKey]: implPath } },
  undefined,
  { timeout: 120_000 },
);
evidence.results.M01_first_call = {
  isError: res.isError === true,
  status: res.structuredContent?.status,
  matchRate: res.structuredContent?.matchRate,
};
assert.ok(!res.isError, `first schema-conformant call failed: ${JSON.stringify(res.content)}`);

assert.equal(protocolErrors.length, 0, `protocol errors: ${protocolErrors.join(" | ")}`);
await writeFile(join(evidenceDir, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
await client.close();
console.log(join(evidenceDir, "evidence.json"));

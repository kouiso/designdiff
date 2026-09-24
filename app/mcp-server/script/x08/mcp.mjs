// X08 MCP 面: 実 SDK + StdioClientTransport で compare_design を呼び、
// 同一検体に対する差分画素数・領域・diff画像を x08-mcp.json に書く。

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { writeX08Fixture } from "./fixture.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const entry = join(root, "app/mcp-server/dist/index.js");
const evidenceDir = process.argv[2] ? resolve(process.argv[2]) : undefined;
if (!evidenceDir) throw new Error("evidence dir argument is required");
await mkdir(evidenceDir, { recursive: true });

const sandbox = await mkdtemp(join(tmpdir(), "figdiff-x08-mcp-"));
const home = join(sandbox, "home");
const store = join(evidenceDir, "figdiff-home");
const work = join(sandbox, "work");
await mkdir(home, { recursive: true });
await mkdir(join(store, "cache"), { recursive: true });
await mkdir(work);

const { designPath, screenshotPath, expectedDiffPixelCount, expectedRegions } =
  await writeX08Fixture(evidenceDir);

const protocolErrors = [];
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entry],
  cwd: work,
  env: {
    HOME: home,
    USERPROFILE: home,
    PATH: dirname(process.execPath),
    FIGDIFF_HOME: store,
    FIGDIFF_ALLOWED_DIRS: evidenceDir,
  },
  stderr: "pipe",
});
transport.stderr?.resume();
const client = new Client({ name: "x08-mcp", version: "1.0.0" });
client.onerror = (error) => protocolErrors.push(error.message);
await client.connect(transport);

const result = await client.callTool(
  {
    name: "compare_design",
    arguments: {
      design_source: designPath,
      screenshot: screenshotPath,
      campaign_id: "x08-mcp",
    },
  },
  undefined,
  { timeout: 120_000 },
);
if (result.isError) throw new Error(JSON.stringify(result.content));

const data = result.structuredContent ??
  JSON.parse(result.content.find((i) => i.type === "text").text);

// diff 画像のデコード後画素 SHA (PNG encoder 差を排除するため画素で比較)。
const diffImagePath = data.diffImagePath;
let diffPixelsSha256 = null;
if (diffImagePath) {
  const { default: sharp } = await import("sharp");
  const raw = await sharp(diffImagePath).ensureAlpha().raw().toBuffer();
  diffPixelsSha256 = createHash("sha256").update(raw).digest("hex");
}

const out = {
  surface: "mcp",
  diffPixelCount: data.diffPixelCount,
  matchRate: data.matchRate,
  regions: (data.diffRegions ?? []).map((r) => r.bounds),
  diffPixelsSha256,
  diffImagePath,
  expectedDiffPixelCount,
  expectedRegions,
  protocolErrors,
};
// face レベルの自己検査: 計測値・diff画像・protocol 健全性が揃わなければ
// 台帳側の「capture 完了」も成立しないためここで落とす。
assert.equal(typeof out.diffPixelCount, "number", "diffPixelCount missing");
assert.ok(out.diffPixelsSha256, "diff image pixels missing");
assert.deepEqual(out.protocolErrors, [], "protocol errors on mcp face");
out.results = {
  X08: {
    status: "PASS",
    expected: `mcp 面が同一検体で diffPixelCount=${expectedDiffPixelCount}・領域=${expectedRegions.length} を返す`,
    actual: {
      diffPixelCount: out.diffPixelCount,
      matchRate: out.matchRate,
      regionCount: out.regions.length,
      diffPixelsSha256: out.diffPixelsSha256,
      protocolErrors: out.protocolErrors.length,
    },
  },
};
await writeFile(join(evidenceDir, "x08-mcp.json"), `${JSON.stringify(out, null, 2)}\n`);
await client.close();
process.stdout.write(`${JSON.stringify({ ok: true, diffPixelCount: data.diffPixelCount, regions: out.regions.length })}\n`);

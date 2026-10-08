// designdiff#218 repro: 影のぼかし半径差 (blur sigma 8 vs 10) を持つ2枚の PNG を
// 生成し、実ビルド済み mcp-server (dist/index.js) を stdio MCP で起動して
// compare_design を呼ぶ。diffPixelCount=0 / status=PASS でサマリーに未満差分
// 警告が出ることを確認する。
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

const width = 480;
const height = 480;
const dir = mkdtempSync(join(tmpdir(), "figdiff-218-"));
const designPath = join(dir, "design.png");
const implPath = join(dir, "impl.png");

const makeCard = async (shadowSigma) => {
  // 白背景 + 黒い矩形をブラーした影レイヤ + 上に白いカード。
  // sharp の .blur は composite より先の段階で適用されるため、矩形を先に
  // PNG へ平坦化してからブラーしないと縁が広がらない。
  const flat = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: {
          create: {
            width: 300,
            height: 200,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0.28 },
          },
        },
        top: 160,
        left: 100,
      },
    ])
    .png()
    .toBuffer();
  const shadow = await sharp(flat).blur(shadowSigma).png().toBuffer();
  return sharp({
    create: { width, height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .composite([
      { input: shadow, top: 0, left: 0 },
      {
        input: {
          create: {
            width: 300,
            height: 200,
            channels: 4,
            background: { r: 255, g: 255, b: 255, alpha: 1 },
          },
        },
        top: 140,
        left: 90,
      },
    ])
    .png()
    .toBuffer();
};

const design = await makeCard(8);
const impl = await makeCard(10);
await sharp(design).toFile(designPath);
await sharp(impl).toFile(implPath);

const server = spawn("node", ["app/mcp-server/dist/index.js"], {
  env: { ...process.env, FIGDIFF_HOME: join(dir, "store"), FIGDIFF_ALLOWED_DIRS: dir },
  stdio: ["pipe", "pipe", "inherit"],
});

let buffer = "";
const pending = new Map();
let nextId = 1;
server.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let idx = buffer.indexOf("\n");
  while (idx >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    idx = buffer.indexOf("\n");
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});
const send = (method, params) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });

await send("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "repro-218", version: "1" },
});
server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

const call = async (threshold) => {
  const res = await send("tools/call", {
    name: "compare_design",
    arguments: { design_source: designPath, screenshot: implPath, threshold },
  });
  if (res.result?.isError) throw new Error(JSON.stringify(res.result));
  return res.result;
};

// リポジトリの noConsole ルールに合わせ、報告出力は stdout 直書きにする。
const out = (text) => process.stdout.write(`${text}\n`);

const r1 = await call(0.1);
const j1 = r1.structuredContent;

out("=== threshold=0.1 ===");
out(
  `status=${j1.status} diffPixelCount=${j1.diffPixelCount} subThresholdDiffPixelCount=${j1.subThresholdDiffPixelCount} stop=${j1.loopGuard?.stop}`,
);
out("--- summary ---");
out(r1.content?.[1]?.text ?? "(no summary)");
out("--- suggestion ---");
out(j1.suggestion ?? "");

const r2 = await call(0);
const j2 = r2.structuredContent;
out("=== threshold=0 ===");
out(
  `status=${j2.status} diffPixelCount=${j2.diffPixelCount} subThresholdDiffPixelCount=${j2.subThresholdDiffPixelCount}`,
);

server.kill();
rmSync(dir, { recursive: true, force: true });

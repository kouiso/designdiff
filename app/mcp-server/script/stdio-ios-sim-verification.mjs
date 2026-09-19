// iOS Simulator 実機撮影の検証 (macOS専用)。
// xcrun simctl で boot 済みシミュレータから compare_design の
// capture_device:"ios-sim" 経路が実画像を取り込めるかを見る。
// 判定は撮れた PNG の実寸と、scroll 非対応の明示拒否で行う
// (FigDiff の status/matchRate はオラクルにしない)。
//
// 前提: boot 済みシミュレータが1台存在すること。証跡ディレクトリを第1引数に取る。

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import sharp from "sharp";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const entry = join(root, "app/mcp-server/dist/index.js");
const evidenceDir = process.argv[2] ? resolve(process.argv[2]) : undefined;
if (!evidenceDir) throw new Error("evidence dir argument is required");
if (process.platform !== "darwin") throw new Error("ios-sim verification requires macOS");

const sandbox = await mkdtemp(join(tmpdir(), "figdiff-iossim-"));
const home = join(sandbox, "home");
const store = join(evidenceDir, "figdiff-home");
const work = join(sandbox, "work");
for (const d of [home, store, work]) await mkdir(d, { recursive: true });
await mkdir(evidenceDir, { recursive: true });

const evidence = { schemaVersion: 1, protocolErrors: [], results: {} };
const protocolErrors = evidence.protocolErrors;

// 独立オラクル: simctl 直接撮影との突き合わせ用に boot 端末情報を取る。
const { stdout: devList } = await execFileAsync("xcrun", [
  "simctl",
  "list",
  "devices",
  "booted",
  "-j",
]);
const booted = JSON.parse(devList).devices;
const bootedList = Object.values(booted).flat();
assert.equal(bootedList.length, 1, "exactly one booted simulator is required");
const simDevice = bootedList[0];
evidence.results.simDevice = { name: simDevice.name, udid: simDevice.udid };

// simctl 直接撮影 (製品を通さない基準画像)
const directPath = join(evidenceDir, "simctl-direct.png");
await execFileAsync("xcrun", ["simctl", "io", "booted", "screenshot", directPath]);
const directMeta = await sharp(directPath).metadata();
evidence.results.directCapture = {
  width: directMeta.width,
  height: directMeta.height,
};
assert.ok(directMeta.width >= 600, "simulator screenshot must be device-scale");

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
const client = new Client({ name: "ios-sim-verify", version: "1.0.0" });
client.onerror = (error) => protocolErrors.push(error.message);
await client.connect(transport);
const call = (name, args) =>
  client.callTool({ name, arguments: args }, undefined, { timeout: 120_000 });
const text = (result) =>
  result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");

// 検体: シミュレータ画面と無関係な単色デザイン。FAIL は想定内、確認対象は
// 撮影経路・寸法・system UI マスクの挙動。
const designPath = join(evidenceDir, "input-design.png");
await sharp({
  create: {
    width: 390,
    height: 844,
    channels: 4,
    background: { r: 240, g: 244, b: 250, alpha: 1 },
  },
})
  .png()
  .toFile(designPath);

const captureResult = await call("compare_design", {
  design_source: designPath,
  capture_device: "ios-sim",
});
const payload = captureResult.structuredContent ?? {};
evidence.results.X06_ios_sim_capture = {
  isError: captureResult.isError === true,
  status: captureResult.isError ? "FAIL" : "PASS",
  comparisonStatus: payload.status,
  verificationContext: payload.verificationContext
    ? {
        screenshot: payload.verificationContext.screenshot,
        geometry: payload.verificationContext.comparison?.geometry,
      }
    : undefined,
  ignoreRegionResolution: payload.ignoreRegionResolution,
  toastBandCandidates: payload.toastBandCandidates,
  comparisonConditions: payload.comparisonConditions,
};
assert.ok(!captureResult.isError, `capture via ios-sim failed: ${text(captureResult)}`);
// 撮影画像は mobile-capture が homedir 側 (~/.figdiff/cache/capture) に
// 書く。HOME を隔離した sandbox 配下なので実ユーザーの store は汚れない。
const captureDir = join(home, ".figdiff", "cache", "capture");
const captured = await readdir(captureDir).catch(() => []);
assert.ok(captured.length > 0, "captured screenshot must be stored under cache/capture");
const capturedMeta = await sharp(join(captureDir, captured[0])).metadata();
evidence.results.capturedImage = {
  name: captured[0],
  width: capturedMeta.width,
  height: capturedMeta.height,
  sha256Prefix: undefined,
};
assert.equal(capturedMeta.width, directMeta.width, "captured width must match simctl direct capture");
assert.equal(
  capturedMeta.height,
  directMeta.height,
  "captured height must match simctl direct capture",
);

// capture_scroll は ios-sim 非対応 — 嘘の結合を返さず明示拒否すること。
const scrollAttempt = await call("compare_design", {
  design_source: designPath,
  capture_device: "ios-sim",
  capture_scroll: true,
});
evidence.results.X06_scroll_rejected = {
  isError: scrollAttempt.isError === true,
  text: text(scrollAttempt),
};
assert.ok(scrollAttempt.isError === true, "ios-sim scroll capture must be rejected explicitly");
assert.match(text(scrollAttempt), /not supported|ios-sim/i);

assert.equal(protocolErrors.length, 0, `protocol errors: ${protocolErrors.join(" | ")}`);
await writeFile(join(evidenceDir, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
await client.close();
console.log(join(evidenceDir, "evidence.json"));

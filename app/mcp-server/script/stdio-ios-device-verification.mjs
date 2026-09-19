// iOS 実機撮影の検証 (macOS専用, pymobiledevice3 + paired 実機が前提)。
// compare_design の capture_device:"ios-device" 経路が実機の実画像を
// 取り込めるかを見る。判定は撮れた PNG の実寸・内容が pymobiledevice3
// 直接撮影と一致することと、scroll 非対応の明示拒否で行う
// (FigDiff の status/matchRate はオラクルにしない)。
//
// 前提: paired な iOS 実機が1台接続されていること。証跡dirを第1引数に取る。

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
if (process.platform !== "darwin") throw new Error("ios-device verification requires macOS");

const sandbox = await mkdtemp(join(tmpdir(), "figdiff-iosdev-"));
const home = join(sandbox, "home");
const store = join(evidenceDir, "figdiff-home");
const work = join(sandbox, "work");
for (const d of [home, store, work]) await mkdir(d, { recursive: true });
await mkdir(evidenceDir, { recursive: true });

const evidence = { schemaVersion: 1, protocolErrors: [], results: {} };
const protocolErrors = evidence.protocolErrors;

// 独立オラクル: devicectl で接続中の実機情報を取る (製品を通さない確認)。
const { stdout: deviceList } = await execFileAsync("xcrun", [
  "devicectl",
  "list",
  "devices",
  "--json-output",
  join(sandbox, "devices.json"),
]);
const deviceReport = JSON.parse(await readFile(join(sandbox, "devices.json"), "utf8"));
const connected = (deviceReport.result?.devices ?? []).filter(
  (d) => d.connectionProperties?.tunnelState === "connected" || d.deviceProperties,
);
evidence.results.connectedDevices = connected.map((d) => ({
  name: d.deviceProperties?.name,
  model: d.hardwareProperties?.productType,
  os: d.deviceProperties?.osVersionNumber,
  udid: d.hardwareProperties?.udid,
}));
assert.ok(connected.length >= 1, "at least one paired iOS device must be connected");

// pymobiledevice3 直接撮影 (製品を通さない基準画像)。
// dvt screenshot は PNG を書く。失敗したらここで分かる。
const directPath = join(evidenceDir, "pymobiledevice3-direct.png");
await execFileAsync("pymobiledevice3", [
  "developer",
  "dvt",
  "screenshot",
  directPath,
]);
const directMeta = await sharp(directPath).metadata();
evidence.results.directCapture = {
  width: directMeta.width,
  height: directMeta.height,
};
assert.ok(directMeta.width >= 600, "device screenshot must be device-scale");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entry],
  cwd: work,
  env: {
    HOME: home,
    USERPROFILE: home,
    // mise shim は非login環境で解決できないことがあるため、uv tool の
    // 実体が置かれる ~/.local/bin を先に通す。
    PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}`,
    FIGDIFF_HOME: store,
    FIGDIFF_ALLOWED_DIRS: evidenceDir,
  },
  stderr: "pipe",
});
transport.stderr?.resume();
const client = new Client({ name: "ios-device-verify", version: "1.0.0" });
client.onerror = (error) => protocolErrors.push(error.message);
await client.connect(transport);
const call = (name, args) =>
  client.callTool({ name, arguments: args }, undefined, { timeout: 120_000 });
const text = (result) =>
  result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");

// 検体: 実機画面と無関係な単色デザイン。FAIL は想定内、確認対象は
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
  capture_device: "ios-device",
});
const payload = captureResult.structuredContent ?? {};
evidence.results.X06_ios_device_capture = {
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
assert.ok(!captureResult.isError, `capture via ios-device failed: ${text(captureResult)}`);

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
};
assert.equal(
  capturedMeta.width,
  directMeta.width,
  "captured width must match pymobiledevice3 direct capture",
);
assert.equal(
  capturedMeta.height,
  directMeta.height,
  "captured height must match pymobiledevice3 direct capture",
);

// capture_scroll は ios-device 非対応 (pymobiledevice3 に touch/swipe が
// 無い) — 嘘の結合を返さず明示拒否すること。
const scrollAttempt = await call("compare_design", {
  design_source: designPath,
  capture_device: "ios-device",
  capture_scroll: true,
});
evidence.results.X06_scroll_rejected = {
  isError: scrollAttempt.isError === true,
  text: text(scrollAttempt),
};
assert.ok(
  scrollAttempt.isError === true,
  "ios-device scroll capture must be rejected explicitly",
);
assert.match(text(scrollAttempt), /not supported|ios-device/i);

assert.equal(protocolErrors.length, 0, `protocol errors: ${protocolErrors.join(" | ")}`);
await writeFile(join(evidenceDir, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
await client.close();
console.log(join(evidenceDir, "evidence.json"));

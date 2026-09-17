// Android 実機/エミュレータ撮影の検証 (adb 前提)。
// X05: 複数端末が繋がっている状態で対象端末の指定が効き、誤端末へ
//      黙って切り替わらないこと。不存在 serial は明示拒否。
// X07: capture_scroll で実 swipe → 分割撮影 → 結合し、system UI マスクの
//      根拠が追跡できること。
// 判定は adb 直接撮影・実 PNG 寸法・scrollCapture 報告で行う
// (FigDiff の status/matchRate はオラクルにしない)。
//
// 前提: `adb devices` に ready な端末が2台以上あること (X05 検証のため)。
// 証跡dirを第1引数に取る。

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
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

const sandbox = await mkdtemp(join(tmpdir(), "figdiff-android-"));
const home = join(sandbox, "home");
const store = join(evidenceDir, "figdiff-home");
const work = join(sandbox, "work");
for (const d of [home, store, work]) await mkdir(d, { recursive: true });
await mkdir(evidenceDir, { recursive: true });

const evidence = { schemaVersion: 1, protocolErrors: [], results: {} };
const protocolErrors = evidence.protocolErrors;

const adb = async (args, opts = {}) =>
  (await execFileAsync("adb", args, { timeout: 60_000, maxBuffer: 64 * 1024 * 1024, ...opts }));

// 独立オラクル: adb devices -l を製品を通さず読む。
const { stdout: devicesOut } = await adb(["devices", "-l"]);
const devices = devicesOut
  .split(/\r?\n/)
  .slice(1)
  .map((line) => line.trim())
  .filter((line) => line !== "")
  .map((line) => {
    const [serial, state, ...rest] = line.split(/\s+/);
    const model = rest.find((f) => f.startsWith("model:"))?.slice(6) ?? null;
    return { serial, state, model };
  });
evidence.results.connectedDevices = devices;
const ready = devices.filter((d) => d.state === "device");
assert.ok(ready.length >= 2, `X05 needs >=2 ready android devices, got ${ready.length}`);
const [emulator, physical] = [
  ready.find((d) => d.serial.startsWith("emulator-")) ?? ready[0],
  ready.find((d) => !d.serial.startsWith("emulator-")) ?? ready[1],
];
assert.ok(emulator && physical && emulator.serial !== physical.serial, "need two distinct devices");

// adb 直接撮影 (製品を通さない基準画像)。
const directShots = {};
for (const dev of [emulator, physical]) {
  const p = join(evidenceDir, `adb-direct-${dev.serial}.png`);
  const { stdout } = await execFileAsync(
    "adb",
    ["-s", dev.serial, "exec-out", "screencap", "-p"],
    { encoding: "buffer", maxBuffer: 64 * 1024 * 1024, timeout: 60_000 },
  );
  await writeFile(p, stdout);
  const meta = await sharp(p).metadata();
  directShots[dev.serial] = { width: meta.width, height: meta.height, model: dev.model };
}
evidence.results.directCaptures = directShots;

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
const client = new Client({ name: "android-verify", version: "1.0.0" });
client.onerror = (error) => protocolErrors.push(error.message);
await client.connect(transport);
const call = (name, args, timeout = 300_000) =>
  client.callTool({ name, arguments: args }, undefined, { timeout });
const text = (result) =>
  result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");

// 検体: 端末画面と無関係な単色デザイン。
const designPath = join(evidenceDir, "input-design.png");
await sharp({
  create: { width: 360, height: 800, channels: 3, background: { r: 240, g: 244, b: 250 } },
})
  .png()
  .toFile(designPath);

// X05a: serial 未指定 + 2台接続 → どちらかへ黙って切り替わらず明示拒否。
const ambiguous = await call("compare_design", {
  design_source: designPath,
  capture_device: "android",
});
evidence.results.X05_ambiguous_rejected = {
  isError: ambiguous.isError === true,
  text: text(ambiguous).slice(0, 500),
};
assert.ok(ambiguous.isError === true, "two devices without serial must be rejected, not silently picked");
assert.match(text(ambiguous), /serial|device|ANDROID_SERIAL/i);

// X05b: emulator serial 指定 → 撮れる画像がその端末の寸法と一致。
const emuCapture = await call("compare_design", {
  design_source: designPath,
  capture_device: "android",
  capture_device_serial: emulator.serial,
});
assert.ok(!emuCapture.isError, `emulator capture failed: ${text(emuCapture)}`);
const captureDir = join(home, ".figdiff", "cache", "capture");
const emuShots = (await readdir(captureDir)).sort();
const emuLatest = emuShots.at(-1);
const emuMeta = await sharp(join(captureDir, emuLatest)).metadata();
evidence.results.X05_emulator_capture = {
  serial: emulator.serial,
  captured: emuLatest,
  width: emuMeta.width,
  height: emuMeta.height,
};
assert.equal(emuMeta.width, directShots[emulator.serial].width, "emulator capture width must match adb direct");
assert.equal(emuMeta.height, directShots[emulator.serial].height, "emulator capture height must match adb direct");

// X05c: physical serial 指定 → その端末の寸法の画像が来る。
const phyCapture = await call("compare_design", {
  design_source: designPath,
  capture_device: "android",
  capture_device_serial: physical.serial,
});
assert.ok(!phyCapture.isError, `physical capture failed: ${text(phyCapture)}`);
const phyShots = (await readdir(captureDir)).sort();
const phyLatest = phyShots.at(-1);
const phyMeta = await sharp(join(captureDir, phyLatest)).metadata();
evidence.results.X05_physical_capture = {
  serial: physical.serial,
  captured: phyLatest,
  width: phyMeta.width,
  height: phyMeta.height,
};
assert.equal(phyMeta.width, directShots[physical.serial].width, "physical capture width must match adb direct");
assert.equal(phyMeta.height, directShots[physical.serial].height, "physical capture height must match adb direct");
assert.notEqual(phyLatest, emuLatest, "each device must produce its own capture file");

// X05d: 不存在 serial → 明示拒否。
const bogus = await call("compare_design", {
  design_source: designPath,
  capture_device: "android",
  capture_device_serial: "no-such-serial-000",
});
evidence.results.X05_bogus_serial = {
  isError: bogus.isError === true,
  text: text(bogus).slice(0, 400),
};
assert.ok(bogus.isError === true, "nonexistent serial must be an explicit error");
assert.match(text(bogus), /not connected|not found|no-such-serial/i);

// X07: emulator に長いページを開かせて capture_scroll → 分割撮影→結合。
// emulator からホスト loopback は 10.0.2.2 で届く。
const tallHtml = `<!doctype html><html><body style="margin:0"><div style="height:400px;background:#e33">top</div><div style="height:400px;background:#3e3">mid1</div><div style="height:400px;background:#33e">mid2</div><div style="height:400px;background:#ee3">bottom</div></body></html>`;
const pageServer = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(tallHtml);
});
await new Promise((r) => pageServer.listen(0, "127.0.0.1", r));
const pagePort = pageServer.address().port;
await adb(["-s", emulator.serial, "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", `http://10.0.2.2:${pagePort}/tall.html`]);
// ブラウザ描画待ち
await new Promise((r) => setTimeout(r, 8000));

const scrollResult = await call("compare_design", {
  design_source: designPath,
  capture_device: "android",
  capture_device_serial: emulator.serial,
  capture_scroll: true,
});
const scrollPayload = scrollResult.structuredContent ?? {};
evidence.results.X07_android_scroll = {
  isError: scrollResult.isError === true,
  status: scrollPayload.status,
  scrollCapture: scrollPayload.scrollCapture,
  ignoreRegionResolution: scrollPayload.ignoreRegionResolution
    ? {
        effectiveRegions: scrollPayload.ignoreRegionResolution.effectiveRegions,
        maskedPixelCount: scrollPayload.ignoreRegionResolution.maskedPixelCount,
        maskSha256: scrollPayload.ignoreRegionResolution.maskSha256,
      }
    : undefined,
  textHead: text(scrollResult).slice(0, 400),
};
if (!scrollResult.isError) {
  const sc = scrollPayload.scrollCapture;
  assert.ok(sc, "scroll capture must produce a scrollCapture report");
  assert.ok((sc.captureCount ?? 0) >= 2, `scroll must capture >=2 frames, got ${sc.captureCount}`);
  assert.ok(
    (sc.stitchedHeight ?? 0) > (sc.viewportHeight ?? 0),
    `stitched height ${sc.stitchedHeight} must exceed viewport ${sc.viewportHeight}`,
  );
} else {
  evidence.results.X07_android_scroll.note = "scroll capture returned error — see textHead";
}
pageServer.close();

assert.equal(protocolErrors.length, 0, `protocol errors: ${protocolErrors.join(" | ")}`);
await writeFile(join(evidenceDir, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
await client.close();
console.log(join(evidenceDir, "evidence.json"));

// Android 実機/エミュレータ撮影の検証 (adb 前提)。
// X05: 複数端末が繋がっている状態で対象端末の指定が効き、誤端末へ
//      黙って切り替わらないこと。不存在 serial は明示拒否。
// X07: capture_scroll で実 swipe → 分割撮影 → 結合し、system UI マスクの
//      根拠が追跡できること。
// 判定は adb 直接撮影・実 PNG 寸法・scrollCapture 報告で行う
// (FigDiff の status/matchRate はオラクルにしない)。
//
// 前提: `adb devices` に ready な端末が1台以上あること。
// X05 の複数台拒否は2台以上見える時のみ検証する (単端末環境では実機1台の
// 撮影・scroll のみを証跡化し、複数台ケースは複数台環境の証跡で担保する)。
// 環境変数:
//   ANDROID_EXPECT_SERIALS  見えているべき serial のカンマ区切り一覧
//   ANDROID_SCROLL_DEVICE   scroll 試験に使う serial (既定: emulator優先、
//                           無ければ先頭端末)
//   ANDROID_PAGE_URL        scroll 対象ページの URL。既定は driver が立てる
//                           ローカルサーバ (emulator は 10.0.2.2、実機は
//                           adb reverse + 127.0.0.1)。実機と driver ホストが
//                           別ネットワークの時は同一LAN上のURLを渡す —
//                           adb reverse は複数 adb ホスト接続下で不安定なため。
// 証跡dirを第1引数に取る。

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
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
assert.ok(ready.length >= 1, `X05 needs >=1 ready android device, got ${ready.length}`);
const expectedSerials = process.env.ANDROID_EXPECT_SERIALS?.split(",").map((s) => s.trim()).filter(Boolean);
if (expectedSerials) {
  assert.deepEqual(
    ready.map((d) => d.serial).sort(),
    [...expectedSerials].sort(),
    `ready devices ${ready.map((d) => d.serial)} must match ANDROID_EXPECT_SERIALS ${expectedSerials}`,
  );
}
evidence.results.deviceSelectionMode = ready.length >= 2 ? "multi-device" : "single-device";
const emulator = ready.find((d) => d.serial.startsWith("emulator-")) ?? null;
const physical = ready.find((d) => !d.serial.startsWith("emulator-")) ?? null;
const captureTargets = [emulator, physical].filter((d) => d !== null);

// adb 直接撮影 (製品を通さない基準画像)。
const directShots = {};
for (const dev of captureTargets) {
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
// 単端末環境では対象外 — serial 省略の自動選択が動くことだけ記録する。
if (ready.length >= 2) {
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
} else {
  const sole = await call("compare_design", {
    design_source: designPath,
    capture_device: "android",
  });
  evidence.results.X05_single_device_auto = {
    isError: sole.isError === true,
    note: "single-device environment: serial-less call must pick the only device",
    text: text(sole).slice(0, 500),
  };
  assert.ok(!sole.isError, `single-device serial-less capture failed: ${text(sole)}`);
}

const captureDir = join(home, ".figdiff", "cache", "capture");
evidence.results.X05_device_captures = {};
for (const dev of captureTargets) {
  // X05b/c: serial 指定 → 撮れる画像がその端末の寸法と一致。
  const res = await call("compare_design", {
    design_source: designPath,
    capture_device: "android",
    capture_device_serial: dev.serial,
  });
  assert.ok(!res.isError, `capture via ${dev.serial} failed: ${text(res)}`);
  const shots = (await readdir(captureDir)).sort();
  const latest = shots.at(-1);
  const meta = await sharp(join(captureDir, latest)).metadata();
  evidence.results.X05_device_captures[dev.serial] = {
    kind: dev === emulator ? "emulator" : "physical",
    captured: latest,
    width: meta.width,
    height: meta.height,
  };
  assert.equal(meta.width, directShots[dev.serial].width, `capture width must match adb direct for ${dev.serial}`);
  assert.equal(meta.height, directShots[dev.serial].height, `capture height must match adb direct for ${dev.serial}`);
}

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

// X05e: 切断済み端末。ANDROID_TCP_SERIAL に adb disconnect 可能な
// tcp serial を渡した時だけ検証する (USB serial は disconnect 不可、
// emulator は emu kill 以外の切断手段がない)。
const tcpSerial = process.env.ANDROID_TCP_SERIAL;
if (tcpSerial) {
  const waitState = async (want, timeout = 30_000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const { stdout } = await adb(["devices"]);
      const line = stdout.split(/\r?\n/).find((l) => l.startsWith(tcpSerial));
      const state = line?.split(/\s+/)[1] ?? "absent";
      if (want === "device" ? state === "device" : state !== "device") return state;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return "timeout";
  };
  await adb(["connect", tcpSerial]).catch(() => {});
  assert.equal(await waitState("device"), "device", `${tcpSerial} must be connected first`);
  await adb(["disconnect", tcpSerial]);
  const after = await waitState("gone");
  const gone = await call("compare_design", {
    design_source: designPath,
    capture_device: "android",
    capture_device_serial: tcpSerial,
  });
  evidence.results.X05_disconnected = {
    stateAfterDisconnect: after,
    isError: gone.isError === true,
    text: text(gone).slice(0, 400),
  };
  assert.ok(gone.isError === true, "disconnected serial must be an explicit error");
  await adb(["connect", tcpSerial]);
  assert.equal(await waitState("device"), "device", `${tcpSerial} must reconnect`);
}

// X07: 対象端末に長いページを開かせて capture_scroll → 分割撮影→結合。
// emulator はホスト loopback が 10.0.2.2、実機は adb reverse で
// 端末側 127.0.0.1 をホストのこのプロセスのポートへ向ける。
const scrollDevice =
  ready.find((d) => d.serial === process.env.ANDROID_SCROLL_DEVICE) ?? emulator ?? ready[0];
// 実機は CSS ピクセル換算でビューポートが狭いので、分割が確実に起きる
// 長さ (6000px超) にしておく。テキストは入れない — Chrome の翻訳
// ポップアップが出て swipe を食うのを防ぐため。全面ベタ塗りだと
// フレーム間の重なり判定が付かず縫い目が曖昧になるので、行毎に一意な
// 縞模様を敷く。
const stripe = (c, i) =>
  `height:800px;background:repeating-linear-gradient(0deg,${c},${c} ${40 + i * 8}px,#111 ${40 + i * 8}px,#111 ${80 + i * 8}px)`;
const tallHtml = `<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body style="margin:0">${["#e33", "#3e3", "#33e", "#ee3", "#3ee", "#e3e", "#963", "#369"].map((c, i) => `<div style="${stripe(c, i)}"></div>`).join("")}</body></html>`;
let pageServer;
let pageUrl;
if (process.env.ANDROID_PAGE_URL) {
  pageUrl = process.env.ANDROID_PAGE_URL;
} else {
  pageServer = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(tallHtml);
  });
  await new Promise((r) => pageServer.listen(0, "127.0.0.1", r));
  const pagePort = pageServer.address().port;
  if (scrollDevice.serial.startsWith("emulator-")) {
    pageUrl = `http://10.0.2.2:${pagePort}/tall.html`;
  } else {
    await adb(["-s", scrollDevice.serial, "reverse", `tcp:${pagePort}`, `tcp:${pagePort}`]);
    pageUrl = `http://127.0.0.1:${pagePort}/tall.html`;
  }
}
evidence.results.scrollTarget = { serial: scrollDevice.serial, pageUrl };
// cold boot 直後などは Chrome が古いタブの静止画を出したまま renderer が
// 生きておらず swipe を受け付けない。force-stop してから開き直して
// 確実に生きた renderer へ描画させる。
await adb(["-s", scrollDevice.serial, "shell", "am", "force-stop", "com.android.chrome"]).catch(
  () => {},
);
await adb(["-s", scrollDevice.serial, "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", pageUrl]);
// ブラウザ描画待ち
await new Promise((r) => setTimeout(r, 8000));

const scrollResult = await call("compare_design", {
  design_source: designPath,
  capture_device: "android",
  capture_device_serial: scrollDevice.serial,
  capture_scroll: true,
});
const scrollPayload = scrollResult.structuredContent ?? {};
evidence.results.X07_android_scroll = {
  isError: scrollResult.isError === true,
  status: scrollResult.isError ? "FAIL" : "PASS",
  comparisonStatus: scrollPayload.status,
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
pageServer?.close();

// X05f: 未認証端末。adbkey を未承認の別鍵へすり替えて adb server を
// 再起動すると、端末は unauthorized 状態になる — その状態での撮影が
// 明示エラーになることを検証する。adb server 再起動で全接続が切れる
// ため最後に実行する。ANDROID_UNAUTHORIZED_SERIAL に対象 serial を渡す。
const unauthSerial = process.env.ANDROID_UNAUTHORIZED_SERIAL;
if (unauthSerial?.includes(":")) {
  // tcpip の adbd はクライアント鍵の RSA 認証を強制しない — 実測で
  // rogue key にすり替えても `device` のままだった。クライアント側
  // では unauthorized 状態を作れない transport なので、この経路は
  // assert せず環境不適として記録する (USB/emulator serial で検証)。
  evidence.results.X05_unauthorized = {
    serial: unauthSerial,
    inapplicable: "tcpip adbd accepts rogue client key (measured: stays `device`)",
  };
} else if (unauthSerial) {
  const androidDir = join(homedir(), ".android");
  const keyBackup = join(sandbox, "adbkey-backup");
  const keyPubBackup = join(sandbox, "adbkey-pub-backup");
  const rogueKey = join(sandbox, "rogue-adbkey");
  await adb(["keygen", rogueKey]);
  const deviceState = async () => {
    const { stdout } = await adb(["devices"]);
    const line = stdout.split(/\r?\n/).find((l) => l.startsWith(unauthSerial));
    return line?.split(/\s+/)[1] ?? "absent";
  };
  try {
    await copyFile(join(androidDir, "adbkey"), keyBackup);
    await copyFile(join(androidDir, "adbkey.pub"), keyPubBackup);
    await copyFile(rogueKey, join(androidDir, "adbkey"));
    await copyFile(`${rogueKey}.pub`, join(androidDir, "adbkey.pub"));
    await adb(["kill-server"]);
    if (unauthSerial.includes(":")) await adb(["connect", unauthSerial]).catch(() => {});
    // unauthorized が現れるまで待つ (USB は自動再接続で handshake する)
    const deadline = Date.now() + 30_000;
    let state = await deviceState();
    while (state !== "unauthorized" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000));
      state = await deviceState();
    }
    const unauth = await call("compare_design", {
      design_source: designPath,
      capture_device: "android",
      capture_device_serial: unauthSerial,
    });
    evidence.results.X05_unauthorized = {
      deviceState: state,
      isError: unauth.isError === true,
      text: text(unauth).slice(0, 400),
    };
    assert.equal(state, "unauthorized", `${unauthSerial} must be unauthorized under rogue key`);
    assert.ok(unauth.isError === true, "unauthorized device must be an explicit error");
  } finally {
    // 必ず承認済み鍵へ戻す。戻せなければ後続の検証が全滅する。
    await copyFile(keyBackup, join(androidDir, "adbkey"));
    await copyFile(keyPubBackup, join(androidDir, "adbkey.pub"));
    await adb(["kill-server"]);
    if (unauthSerial.includes(":")) {
      await adb(["connect", unauthSerial]).catch(() => {});
    } else {
      await adb(["devices"]).catch(() => {});
    }
    const deadline = Date.now() + 30_000;
    let state = await deviceState();
    while (state !== "device" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000));
      state = await deviceState();
    }
    evidence.results.X05_unauthorized_recovery = { state };
    assert.equal(state, "device", `${unauthSerial} must be authorized again after key restore`);
  }
}

assert.equal(protocolErrors.length, 0, `protocol errors: ${protocolErrors.join(" | ")}`);
await writeFile(join(evidenceDir, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
await client.close();
console.log(join(evidenceDir, "evidence.json"));

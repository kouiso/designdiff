import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  clockStamp,
  createLineWriter,
  fileStamp,
  printSummary,
  processStartToken,
  pruneLogs,
  recoverStaleActiveLogs,
  runTee,
  sanitizeLogText,
} from "./dev-log.mjs";

const withTempDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), "figdiff-dev-log-"));
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  let result;
  try {
    result = fn(dir);
  } catch (error) {
    cleanup();
    throw error;
  }
  // async のときは終わるまで消さない (finally で即消すと子の書き込み先が消える)。
  if (result && typeof result.then === "function") return result.finally(cleanup);
  cleanup();
  return result;
};

test("clockStamp / fileStamp はゼロ埋めした固定幅", () => {
  const date = new Date(2026, 8, 2, 9, 5, 7);
  assert.equal(clockStamp(date), "09:05:07");
  assert.equal(fileStamp(date), "20260902-090507");
});

test("createLineWriter はチャンク途中で切れた行を結合し、時刻と stream 名を付ける", () => {
  const out = [];
  const writer = createLineWriter(
    (text) => out.push(text),
    "out",
    () => "10:00:00",
  );

  writer.write(Buffer.from("vite v6 ready"));
  writer.write(Buffer.from(" in 300ms\n  ➜  Local: http://localhost:5173/\npart"));
  assert.deepEqual(out, [
    "[10:00:00] [out] vite v6 ready in 300ms\n",
    "[10:00:00] [out]   ➜  Local: http://localhost:5173/\n",
  ]);

  writer.write(Buffer.from("ial\n"));
  assert.equal(out[2], "[10:00:00] [out] partial\n");

  writer.write(Buffer.from("no newline at exit"));
  writer.flush();
  assert.equal(out[3], "[10:00:00] [out] no newline at exit\n");
  writer.flush();
  assert.equal(out.length, 4);
});

test("createLineWriter は \\r と ANSI をそのまま残す (解析は digest の仕事)", () => {
  const out = [];
  const writer = createLineWriter(
    (text) => out.push(text),
    "err",
    () => "10:00:00",
  );
  writer.write("[33mwarning[0m 1\rwarning 2\n");
  assert.equal(out[0], "[10:00:00] [err] [33mwarning[0m 1\rwarning 2\n");
});

test("createLineWriter は分割UTF-8を壊さず、改行なしの残余を上限内に保つ", () => {
  const out = [];
  const writer = createLineWriter(
    (text) => out.push(text),
    "out",
    () => "10:00:00",
    32,
  );
  const encoded = Buffer.from("患者\n");
  writer.write(encoded.subarray(0, 2));
  writer.write(encoded.subarray(2));
  writer.write("x".repeat(100));
  writer.write("discarded until newline\nstill works\n");
  writer.flush();

  assert.match(out[0], /患者/);
  assert.doesNotMatch(out.join(""), /�/);
  assert.match(out[1], /\[truncated\]$/m);
  assert.ok(out.some((line) => line.endsWith("still works\n")));
  assert.doesNotMatch(out.join(""), /discarded/);
});

test("pruneLogs は本数と合計バイトの上限を超えた分だけ古い順に消す", () =>
  withTempDir((dir) => {
    for (let i = 1; i <= 5; i += 1) {
      writeFileSync(join(dir, `dev-20260902-10000${i}.log`), "x".repeat(100));
    }
    writeFileSync(join(dir, "unrelated.log"), "keep me");

    const removedByCount = pruneLogs(dir, { maxFiles: 3, maxTotalBytes: 10_000 });
    assert.equal(removedByCount.length, 2);
    assert.deepEqual(readdirSync(dir).sort(), [
      "dev-20260902-100003.log",
      "dev-20260902-100004.log",
      "dev-20260902-100005.log",
      "unrelated.log",
    ]);

    const removedByBytes = pruneLogs(dir, { maxFiles: 10, maxTotalBytes: 250 });
    assert.deepEqual(
      removedByBytes.map((p) => p.endsWith("100003.log")),
      [true],
    );
  }));

test("pruneLogs は dir が無くても落ちない", () => {
  assert.deepEqual(pruneLogs("/nonexistent/figdiff-logs"), []);
});

test("永続コピーはパス、各種トークン、長大行を伏せる", () => {
  const sanitized = sanitizeLogText(
    `failed \\\\server\\share\\Patient A\\scan.dcm FIGD_SECRET Authorization: bearer AbC.123 X-Figma-Token: abc access_token=xyz github_pat_123 ${"x".repeat(9000)}`,
  );
  assert.doesNotMatch(sanitized, /Patient A|SECRET|AbC\.123|abc|xyz|github_pat_123/);
  assert.match(sanitized, /scan\.dcm/);
  assert.match(sanitized, /\[truncated\]$/);
});

test("JSON形式のtokenを伏せ、URLを壊さない", () => {
  const sanitized = sanitizeLogText(
    '{"access_token":"secret value","X-Figma-Token":"figma secret"} https://example.test/a/b?q=1&token=figd_URL_SECRET',
  );
  assert.doesNotMatch(sanitized, /secret value|figma secret|URL_SECRET/);
  assert.match(sanitized, /https:\/\/example\.test\/a\/b\?q=1/);
});

test("TTYのSIGINTでも子が終了しなければ猶予後に強制終了する", async () =>
  withTempDir(async (dir) => {
    const done = runTee({
      command: process.execPath,
      args: ["-e", 'process.on("SIGINT", () => {}); setInterval(() => {}, 1000);'],
      cwd: dir,
      env: process.env,
      logDir: dir,
      stdin: { isTTY: true },
      signalGraceMs: 50,
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 300));
    process.emit("SIGINT");
    const { code } = await done;

    assert.equal(code, 130);
  }));

test("runTee は子の出力を画面とファイルの両方へ流し、終了コードを透過する", async () =>
  withTempDir(async (dir) => {
    const script =
      'process.stdout.write("hello\\n"); process.stderr.write("warning: careful\\n"); process.stdout.write("tail-no-newline"); process.exit(3);';
    const { code, logPath } = await runTee({
      command: process.execPath,
      args: ["-e", script],
      cwd: dir,
      env: process.env,
      logDir: dir,
      stdin: { isTTY: false },
    });

    assert.equal(code, 3);
    const lines = readFileSync(logPath, "utf8").trimEnd().split("\n");
    assert.match(
      lines.find((l) => l.includes("hello")),
      /^\[\d{2}:\d{2}:\d{2}\] \[out\] hello$/,
    );
    assert.match(
      lines.find((l) => l.includes("careful")),
      /^\[\d{2}:\d{2}:\d{2}\] \[err\] warning: careful$/,
    );
    assert.ok(
      lines.some((l) => l.endsWith("[out] tail-no-newline")),
      "残余バッファが flush される",
    );
  }));

test("runTee は SIGINT を受けたら (非 TTY のとき) 子へ転送し、末尾行を落とさず終わる", async () =>
  withTempDir(async (dir) => {
    const script =
      'process.on("SIGINT", () => { process.stdout.write("bye\\n"); process.exit(130); }); process.stdout.write("started\\n"); setInterval(() => {}, 1000);';
    let started;
    const done = runTee({
      command: process.execPath,
      args: ["-e", script],
      cwd: dir,
      env: process.env,
      logDir: dir,
      stdin: { isTTY: false },
      onStarted: (info) => {
        started = info;
      },
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 400));
    // ラッパー自身が SIGINT を受けた状況を再現する (端末からではないので転送される)。
    process.emit("SIGINT");
    const { code, logPath } = await done;

    assert.equal(code, 130);
    assert.equal(started.logPath, logPath);
    const text = readFileSync(logPath, "utf8");
    assert.match(text, /\[out\] started\n/);
    assert.match(text, /\[out\] bye\n/);
    assert.equal(started.child.exitCode, 130, "子は終了している (孤児なし)");
  }));

test("runTee は SIGHUP を専用process groupへ転送して129を返す", async () =>
  withTempDir(async (dir) => {
    const done = runTee({
      command: process.execPath,
      args: [
        "-e",
        'process.on("SIGHUP", () => process.exit(129)); process.stdout.write("ready\\n"); setInterval(() => {}, 1000);',
      ],
      cwd: dir,
      env: process.env,
      logDir: dir,
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 300));
    process.emit("SIGHUP");
    const { code } = await done;
    assert.equal(code, 129);
  }));

test("runTee のシグナル転送は孫プロセス (turbo → Electron の形) まで届く", async () =>
  withTempDir(async (dir) => {
    const pidPath = join(dir, "grandchild.pid");
    const script = [
      'const { spawn } = require("node:child_process");',
      'const { writeFileSync } = require("node:fs");',
      'const grandchild = spawn("sleep", ["12345"], { stdio: "ignore" });',
      `writeFileSync(${JSON.stringify(pidPath)}, String(grandchild.pid));`,
      'process.on("SIGINT", () => process.exit(130));',
      "setInterval(() => {}, 1000);",
    ].join(" ");
    let grandchildPid = 0;
    const done = runTee({
      command: process.execPath,
      args: ["-e", script],
      cwd: dir,
      env: process.env,
      logDir: dir,
      stdin: { isTTY: false },
    });
    for (let count = 0; count < 200 && !existsSync(pidPath); count += 1) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    if (!existsSync(pidPath)) {
      process.emit("SIGINT");
      await done;
      assert.fail("孫PIDの準備が時間内に完了しなかった");
    }
    grandchildPid = Number(readFileSync(pidPath, "utf8"));
    process.emit("SIGINT");
    const { code } = await done;

    assert.equal(code, 130);
    assert.throws(() => process.kill(grandchildPid, 0), { code: "ESRCH" });
  }));

test("TTYで直下の子が130終了しても、SIGINTを無視する孫を残さない", async () =>
  withTempDir(async (dir) => {
    const pidPath = join(dir, "grandchild.pid");
    const grandchild = 'process.on("SIGINT", () => {}); setInterval(() => {}, 1000);';
    const child = [
      'const { spawn } = require("node:child_process");',
      'const { writeFileSync } = require("node:fs");',
      `const grandchild = spawn(process.execPath, ["-e", ${JSON.stringify(grandchild)}], { stdio: "ignore" });`,
      `writeFileSync(${JSON.stringify(pidPath)}, String(grandchild.pid));`,
      'process.on("SIGINT", () => process.exit(130));',
      "setInterval(() => {}, 1000);",
    ].join(" ");
    let started;
    let grandchildPid = 0;
    const done = runTee({
      command: process.execPath,
      args: ["-e", child],
      cwd: dir,
      env: process.env,
      logDir: dir,
      stdin: { isTTY: true },
      signalGraceMs: 50,
      onStarted: (info) => {
        started = info;
      },
    });
    for (let count = 0; count < 200 && !existsSync(pidPath); count += 1) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    if (!existsSync(pidPath)) {
      process.kill(started.child.pid, "SIGKILL");
      await done;
      assert.fail("孫PIDの準備が時間内に完了しなかった");
    }
    grandchildPid = Number(readFileSync(pidPath, "utf8"));
    process.emit("SIGINT");
    const { code } = await done;

    assert.equal(code, 130);
    let grandchildAlive = true;
    for (let count = 0; count < 100 && grandchildAlive; count += 1) {
      try {
        process.kill(grandchildPid, 0);
        await new Promise((resolveWait) => setTimeout(resolveWait, 10));
      } catch {
        grandchildAlive = false;
      }
    }
    if (grandchildAlive) process.kill(grandchildPid, "SIGKILL");
    assert.equal(grandchildAlive, false, "SIGINTを無視した孫が残っている");
  }));

test("runTee は起動できないコマンドでも解決し、理由をファイルに残す", async () =>
  withTempDir(async (dir) => {
    const { code, logPath } = await runTee({
      command: join(dir, "no-such-command"),
      args: [],
      cwd: dir,
      env: process.env,
      logDir: dir,
      stdin: { isTTY: false },
    });
    assert.equal(code, 1);
    assert.match(readFileSync(logPath, "utf8"), /\[err\] failed to start/);
  }));

test("ログディレクトリへ書けなくても子コマンドは実行する", async () =>
  withTempDir(async (dir) => {
    const blocked = join(dir, "blocked");
    writeFileSync(blocked, "file");
    const { code } = await runTee({
      command: process.execPath,
      args: ["-e", "process.exit(0)"],
      cwd: dir,
      env: process.env,
      logDir: blocked,
    });
    assert.equal(code, 0);
  }));

test("quota lockを取れなくても子は実行し、loggingを成功扱いしない", async () =>
  withTempDir(async (dir) => {
    writeFileSync(join(dir, ".dev-log-quota.lock"), JSON.stringify({ pid: process.pid }));
    const result = await runTee({
      command: process.execPath,
      args: ["-e", 'process.stdout.write("child-ran\\n")'],
      cwd: dir,
      env: process.env,
      logDir: dir,
      quotaLockTimeoutMs: 30,
    });
    assert.equal(result.code, 0);
    assert.equal(result.loggingEnabled, false);
    assert.equal(existsSync(result.logPath), false);
  }));

test("同一秒の並行起動は別ファイルを確保する", async () =>
  withTempDir(async (dir) => {
    const start = (marker) =>
      runTee({
        command: process.execPath,
        args: ["-e", `process.stdout.write(${JSON.stringify(`${marker}\n`)})`],
        cwd: dir,
        env: process.env,
        logDir: dir,
      });
    const [first, second] = await Promise.all([start("first"), start("second")]);
    assert.notEqual(first.logPath, second.logPath);
    assert.match(readFileSync(first.logPath, "utf8"), /first/);
    assert.match(readFileSync(second.logPath, "utf8"), /second/);
  }));

test("20並列でもactive名を衝突・残留させず、総量上限を超えない", async () =>
  withTempDir(async (dir) => {
    const previousMaxListeners = process.getMaxListeners();
    process.setMaxListeners(30);
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        runTee({
          command: process.execPath,
          args: ["-e", `process.stdout.write(${JSON.stringify(`worker-${index}\n`)})`],
          cwd: dir,
          env: process.env,
          logDir: dir,
          maxTotalBytes: 300,
        }),
      ),
    ).finally(() => process.setMaxListeners(previousMaxListeners));
    assert.equal(new Set(results.map(({ logPath }) => logPath)).size, 20);
    assert.equal(readdirSync(dir).filter((name) => name.endsWith(".active")).length, 0);
    assert.equal(
      readdirSync(dir).filter((name) => name.endsWith(".owner") || name.endsWith(".lock")).length,
      0,
    );
    const finalLogs = readdirSync(dir).filter((name) => /^dev-.*\.log$/.test(name));
    assert.ok(finalLogs.length <= 10, `finalLogs=${finalLogs.length}`);
    const total = finalLogs.reduce((sum, name) => sum + statSync(join(dir, name)).size, 0);
    assert.ok(total <= 300, `total=${total}`);
  }));

test("所有権不明のactiveでquotaが尽きたら0B finalを成功扱いせず、自分のactiveを消す", async () =>
  withTempDir(async (dir) => {
    writeFileSync(join(dir, "dev-20260902-100000.log.active"), "x".repeat(90));
    const result = await runTee({
      command: process.execPath,
      args: ["-e", 'process.stdout.write("new output\\n")'],
      cwd: dir,
      env: process.env,
      logDir: dir,
      maxTotalBytes: 100,
    });
    const total = readdirSync(dir)
      .filter((name) => /^dev-.*\.log(?:\.active)?$/.test(name))
      .reduce((sum, name) => sum + statSync(join(dir, name)).size, 0);
    assert.ok(total <= 100, `total=${total}`);
    assert.equal(result.loggingEnabled, false);
    assert.equal(existsSync(result.logPath), false);
    assert.deepEqual(
      readdirSync(dir).filter((name) => name.endsWith(".active")),
      ["dev-20260902-100000.log.active"],
    );
  }));

test("active logの上限後も子コマンドを完走する", async () =>
  withTempDir(async (dir) => {
    const result = await runTee({
      command: process.execPath,
      args: ["-e", 'process.stdout.write("x".repeat(1000))'],
      cwd: dir,
      env: process.env,
      logDir: dir,
      maxLogBytes: 100,
    });
    assert.equal(result.code, 0);
    assert.equal(result.loggingEnabled, false);
    assert.equal(existsSync(result.logPath), false);
  }));

test("死んだownerのactiveをfinalへ昇格し、PID再利用と生存ownerを区別する", () =>
  withTempDir((dir) => {
    const stale = join(dir, "dev-20260902-100000.log.active");
    const staleFinal = stale.slice(0, -".active".length);
    writeFileSync(stale, "stale");
    writeFileSync(`${stale}.owner`, JSON.stringify({ pid: process.pid, startToken: "other" }));
    assert.deepEqual(
      recoverStaleActiveLogs(
        dir,
        () => true,
        () => "current",
      ),
      [staleFinal],
    );
    assert.equal(readFileSync(staleFinal, "utf8"), "stale");
    assert.equal(existsSync(stale), false);

    const live = join(dir, "dev-20260902-100001.log.active");
    writeFileSync(live, "live");
    writeFileSync(`${live}.owner`, JSON.stringify({ pid: process.pid }));
    assert.deepEqual(
      recoverStaleActiveLogs(dir, () => true),
      [],
    );
    assert.equal(existsSync(live), true);
  }));

test("ownerが空のままcrashしたactiveも猶予後にfinalへ昇格する", () =>
  withTempDir((dir) => {
    const active = join(dir, "dev-20260902-100000.log.active");
    const final = active.slice(0, -".active".length);
    writeFileSync(active, "before crash\n");
    writeFileSync(`${active}.owner`, "");
    const old = new Date(Date.now() - 2000);
    utimesSync(active, old, old);

    assert.deepEqual(
      recoverStaleActiveLogs(
        dir,
        () => false,
        () => null,
        0,
      ),
      [final],
    );
    assert.equal(readFileSync(final, "utf8"), "before crash\n");
    assert.equal(existsSync(`${active}.owner`), false);
  }));

test("active公開前にcrashした孤立ownerを猶予後に回収する", () =>
  withTempDir((dir) => {
    const ownerPath = join(dir, "dev-20260902-100000.log.active.owner");
    writeFileSync(ownerPath, JSON.stringify({ pid: 999_999 }));
    const old = new Date(Date.now() - 2000);
    utimesSync(ownerPath, old, old);

    recoverStaleActiveLogs(
      dir,
      () => false,
      () => null,
      0,
    );
    assert.equal(existsSync(ownerPath), false);
  }));

test("独立Node間でもquota確認とwriteを原子化する", async () =>
  withTempDir(async (dir) => {
    const barrier = join(dir, "go");
    const moduleUrl = new URL("./dev-log.mjs", import.meta.url).href;
    const worker = [
      'import { existsSync } from "node:fs";',
      `const { runTee } = await import(${JSON.stringify(moduleUrl)});`,
      `while (!existsSync(${JSON.stringify(barrier)})) await new Promise((r) => setTimeout(r, 5));`,
      `await runTee({ command: process.execPath, args: ["-e", ${JSON.stringify('process.stdout.write("x".repeat(250) + "\\n")')}], cwd: ${JSON.stringify(dir)}, env: process.env, logDir: ${JSON.stringify(dir)}, maxTotalBytes: 1000 });`,
    ].join("\n");
    const workers = Array.from({ length: 8 }, () =>
      spawn(process.execPath, ["--input-type=module", "-e", worker], { stdio: "ignore" }),
    );
    writeFileSync(barrier, "go");
    const codes = await Promise.all(
      workers.map((child) => new Promise((resolve) => child.once("exit", (code) => resolve(code)))),
    );
    assert.deepEqual(codes, Array(8).fill(0));
    const logs = readdirSync(dir).filter((name) => /^dev-.*\.log(?:\.active)?$/.test(name));
    const total = logs.reduce((sum, name) => sum + statSync(join(dir, name)).size, 0);
    assert.ok(total <= 1000, `total=${total}`);
  }));

test("WindowsのPID開始時刻はPowerShell失敗時にWMICへfallbackする", () => {
  const calls = [];
  const token = processStartToken(
    42,
    (command) => {
      calls.push(command);
      return command === "powershell.exe"
        ? { status: 1, stdout: "" }
        : { status: 0, stdout: "CreationDate=20260904010203.000000-420\n" };
    },
    "win32",
  );
  assert.equal(token, "20260904010203.000000-420");
  assert.deepEqual(calls, ["powershell.exe", "wmic"]);
});

test("旧実装が残した空lockは猶予後に安全回収する", async () =>
  withTempDir(async (dir) => {
    const lockPath = join(dir, ".dev-log-quota.lock");
    writeFileSync(lockPath, "");
    const old = new Date(Date.now() - 2000);
    utimesSync(lockPath, old, old);
    const result = await runTee({
      command: process.execPath,
      args: ["-e", 'process.stdout.write("recovered\\n")'],
      cwd: dir,
      env: process.env,
      logDir: dir,
    });
    assert.equal(result.loggingEnabled, true);
    assert.match(readFileSync(result.logPath, "utf8"), /recovered/);
  }));

test("子が自発SIGTERM終了したら143を返す", async () =>
  withTempDir(async (dir) => {
    const result = await runTee({
      command: process.execPath,
      args: ["-e", 'process.kill(process.pid, "SIGTERM")'],
      cwd: dir,
      env: process.env,
      logDir: dir,
    });
    assert.equal(result.code, 143);
  }));

test("printSummary は digest が無ければパスだけ出す", () =>
  withTempDir((dir) => {
    const logPath = join(dir, "dev-20260902-100000.log");
    writeFileSync(logPath, "");
    const out = [];
    printSummary(logPath, join(dir, "missing-digest.mjs"), (text) => out.push(text));
    assert.deepEqual(out, [`dev log → ${logPath}\n`]);
  }));

test("printSummary はログ無効時にgreen summaryを出さない", () =>
  withTempDir((dir) => {
    const logPath = join(dir, "missing.log");
    const out = [];
    printSummary(logPath, join(dir, "missing-digest.mjs"), (text) => out.push(text));
    assert.deepEqual(out, [`dev log unavailable → ${logPath}\n`]);
    assert.doesNotMatch(out.join(""), /✓/);
  }));

test("quotaで途中欠落したログはfinalを残すがgreen summaryを出さない", async () =>
  withTempDir(async (dir) => {
    const result = await runTee({
      command: process.execPath,
      args: ["-e", 'process.stdout.write("first\\n" + "x".repeat(1000) + "\\n")'],
      cwd: dir,
      env: process.env,
      logDir: dir,
      maxLogBytes: 100,
    });
    assert.equal(result.loggingEnabled, false);
    assert.equal(existsSync(result.logPath), true);
    const out = [];
    printSummary(result.logPath, join(dir, "missing-digest.mjs"), (text) => out.push(text), false);
    assert.deepEqual(out, [`dev log incomplete → ${result.logPath}\n`]);
    assert.doesNotMatch(out.join(""), /✓/);
  }));

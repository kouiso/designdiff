import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  clockStamp,
  createLineWriter,
  fileStamp,
  printSummary,
  pruneLogs,
  runTee,
  signalTree,
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

test("createLineWriter はチャンクを跨いだ日本語を壊さない", () => {
  const written = [];
  const writer = createLineWriter(
    (text) => written.push(text),
    "out",
    () => "00:00:00",
  );
  const bytes = Buffer.from("警告: 失敗\n", "utf8");
  // マルチバイト文字の途中で切る。チャンク単位で toString すると置換文字になる。
  writer.write(bytes.subarray(0, 4));
  writer.write(bytes.subarray(4));
  writer.flush();

  assert.deepEqual(written, ["[00:00:00] [out] 警告: 失敗\n"]);
});

test("pruneLogs は消せなかったファイルを消した扱いにしない", () =>
  withTempDir((dir) => {
    for (let i = 1; i <= 3; i += 1) {
      writeFileSync(join(dir, `dev-20260902-10000${i}.log`), "x".repeat(100));
    }
    // 消せないファイルを 1 本混ぜる代わりに、削除できないことを readonly ディレクトリで作るのは
    // root で走ると再現せんので、戻り値と実ファイルの一致で「消したと言い張らない」ことを見る。
    const removed = pruneLogs(dir, { maxFiles: 1, maxTotalBytes: 10_000 });
    const left = readdirSync(dir).sort();
    for (const path of removed) assert.ok(!left.includes(path.split("/").at(-1)));
    assert.equal(left.length, 1);
  }));

test("signalTree は Windows では taskkill /T で木ごと落とす", () => {
  const calls = [];
  signalTree(4321, "SIGINT", "win32", (command, args) => {
    calls.push([command, args]);
    return { status: 0 };
  });

  assert.deepEqual(calls, [["taskkill", ["/pid", "4321", "/T", "/F"]]]);
});

test("pruneLogs は dir が無くても落ちない", () => {
  assert.deepEqual(pruneLogs("/nonexistent/figdiff-logs"), []);
});

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

test("runTee のシグナル転送は孫プロセス (turbo → Electron の形) まで届く", async () =>
  withTempDir(async (dir) => {
    // 子は SIGINT で自分だけ終わり、孫 (sleep) を残す。ラッパーが木ごと送るので孫も消えるはず。
    const script =
      'const { spawn } = require("node:child_process"); spawn("sleep", ["12345"], { stdio: "ignore" }); process.on("SIGINT", () => process.exit(130)); setInterval(() => {}, 1000);';
    const done = runTee({
      command: process.execPath,
      args: ["-e", script],
      cwd: dir,
      env: process.env,
      logDir: dir,
      stdin: { isTTY: false },
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    process.emit("SIGINT");
    const { code } = await done;
    await new Promise((resolveWait) => setTimeout(resolveWait, 300));

    assert.equal(code, 130);
    const { spawnSync } = await import("node:child_process");
    const survivors = spawnSync("pgrep", ["-f", "^sleep 12345$"], {
      encoding: "utf8",
    }).stdout.trim();
    assert.equal(survivors, "", "孫の sleep が孤児として残っていない");
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

test("printSummary は digest が無ければパスだけ出す", () =>
  withTempDir((dir) => {
    const logPath = join(dir, "dev-20260902-100000.log");
    writeFileSync(logPath, "");
    const out = [];
    printSummary(logPath, join(dir, "missing-digest.mjs"), (text) => out.push(text));
    assert.deepEqual(out, [`dev log → ${logPath}\n`]);
  }));

test("runTee はログを開けなくても子を動かし、通過だけ続ける", async () =>
  withTempDir(async (dir) => {
    // logDir と同じ名前のファイルを置く。mkdirSync が ENOTDIR / EEXIST で同期例外を投げ、
    // 拾わなければ Promise が reject してラッパーごと落ちる = dev が起動しない。
    const blocked = join(dir, "blocked");
    writeFileSync(blocked, "not a directory");
    const stderr = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (text) => {
      stderr.push(String(text));
      return true;
    };
    let started;
    try {
      const { code, logPath } = await runTee({
        command: process.execPath,
        args: ["-e", 'process.stdout.write("still running\\n"); process.exit(7);'],
        cwd: dir,
        env: process.env,
        logDir: blocked,
        stdin: { isTTY: false },
        onStarted: (info) => {
          started = info;
        },
      });
      assert.equal(code, 7, "子はふつうに動いて終了コードも透過する");
      assert.equal(logPath, null, "残せなかったログのパスは返さない");
      assert.equal(started.logPath, null);
    } finally {
      process.stderr.write = originalWrite;
    }
    assert.ok(
      stderr.some((line) => line.includes("dev log disabled")),
      `理由を 1 度は出す: ${JSON.stringify(stderr)}`,
    );
  }));

test("pruneLogs は消せなかった 1 本を数え続け、次の候補へ進む", () =>
  withTempDir((dir) => {
    // 消せない候補を確実に作る: 同じ名前のディレクトリは statSync では読めるが
    // unlinkSync が EISDIR / EPERM で落ちる (chmod は root で走ると効かない)。
    const undeletable = join(dir, "dev-20260901-100000.log");
    mkdirSync(undeletable);
    for (let i = 2; i <= 4; i += 1) {
      writeFileSync(join(dir, `dev-2026090${i}-100000.log`), "x".repeat(100));
    }

    const removed = pruneLogs(dir, { maxFiles: 1, maxTotalBytes: 10_000 });

    // 消せなかった 1 本を「減った」と数えていた頃は、本数の条件がここで満たされ、
    // まだ消せるファイルが 1 本残ったまま抜けていた。
    const files = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile());
    assert.deepEqual(
      files.map((e) => e.name),
      [],
    );
    assert.equal(removed.length, 3);
    assert.ok(!removed.includes(undeletable), "消せなかったものを消した扱いにしない");
  }));

#!/usr/bin/env node
/**
 * `pnpm dev` の tee。元の dev コマンドをそのまま起動し、画面には手を加えずに流しつつ、
 * 同じ出力を `.logs/dev-<日時>.log` に残す。
 *
 * 方針: ここは「馬鹿な tee」に徹する。ANSI の除去・warn/error の判定・件数の集計は
 * `script/log-digest.mjs` だけが持つ。`dev` は止まると開発全体が止まる唯一のコマンド
 * なので、壊れやすい解析ロジックを同居させない。
 *
 * 使い方: `node script/dev-log.mjs -- <command> [args...]`
 * 例:     `node script/dev-log.mjs -- turbo run dev --ui=stream --log-order=stream`
 */
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MAX_FILES = 10;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

const pad2 = (n) => String(n).padStart(2, "0");

export const clockStamp = (date = new Date()) =>
  `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;

export const fileStamp = (date = new Date()) =>
  `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;

/**
 * `\n` 区切りの各行に `[HH:MM:SS] [out|err] ` を付けて sink に渡す。
 * 子プロセスの出力はチャンク途中で行が切れるので、未完の残りは次のチャンクまで持ち越す。
 * `\r` は行区切りにしない (ファイルにそのまま残し、digest 側で扱う)。
 */
export const createLineWriter = (sink, streamName, now = clockStamp) => {
  let rest = "";
  const emit = (line) => sink(`[${now()}] [${streamName}] ${line}\n`);
  return {
    write: (chunk) => {
      const text = rest + chunk.toString();
      const parts = text.split("\n");
      rest = parts.pop() ?? "";
      for (const line of parts) emit(line);
    },
    flush: () => {
      if (rest.length > 0) {
        emit(rest);
        rest = "";
      }
    },
  };
};

/** 古い順に消して、本数と合計バイト数を上限内に収める。 */
export const pruneLogs = (dir, { maxFiles = MAX_FILES, maxTotalBytes = MAX_TOTAL_BYTES } = {}) => {
  let entries;
  try {
    entries = readdirSync(dir)
      .filter((name) => /^dev-\d{8}-\d{6}\.log$/.test(name))
      .map((name) => {
        const path = join(dir, name);
        return { path, size: statSync(path).size };
      })
      .sort((a, b) => (a.path < b.path ? -1 : 1));
  } catch {
    return [];
  }
  const removed = [];
  let total = entries.reduce((sum, entry) => sum + entry.size, 0);
  while (entries.length > 0 && (entries.length > maxFiles || total > maxTotalBytes)) {
    const oldest = entries.shift();
    total -= oldest.size;
    try {
      unlinkSync(oldest.path);
      removed.push(oldest.path);
    } catch {
      // 消せなくても dev を止める理由にはならない。
    }
  }
  return removed;
};

// ESC (0x1b) をリテラルで書くと no-control-regex に当たるので組み立てる。
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, "g");
const stripAnsi = (text) => text.replace(ANSI_PATTERN, "");

/**
 * 子孫の pid を全部集める (turbo → electron-vite → Electron)。
 * turbo の node シム (node_modules/.bin/turbo) は SIGINT を本体へ転送しないので、
 * 直接の子だけに送っても止まらない。macOS / Linux の pgrep -P で辿る。
 */
export const descendantPids = (pid) => {
  if (process.platform === "win32") return [];
  const result = spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout) return [];
  const children = result.stdout
    .split("\n")
    .map((line) => Number(line))
    .filter((n) => Number.isInteger(n) && n > 0);
  return children.flatMap((child) => [child, ...descendantPids(child)]);
};

/** root と子孫すべてに同じシグナルを送る。既に居ないものは無視。 */
export const signalTree = (rootPid, signal) => {
  for (const pid of [...descendantPids(rootPid), rootPid]) {
    try {
      process.kill(pid, signal);
    } catch {
      // もう居ない
    }
  }
};

/** 終了時の 1 行要約。digest が無い・失敗しても、パスだけは必ず出す。 */
export const printSummary = (
  logPath,
  digestScript,
  write = (text) => process.stderr.write(text),
) => {
  const result = spawnSync(process.execPath, [digestScript, "--file", logPath, "--summary"], {
    encoding: "utf8",
  });
  const line = result.status === 0 ? stripAnsi(result.stdout ?? "").trim() : "";
  write(`${line.length > 0 ? line : `dev log → ${logPath}`}\n`);
};

/**
 * 子を起動して tee する。解決したら { code, logPath }。
 * stdin は inherit: Vite / electron-vite のキー操作 (r/u/o/q) を壊さない。
 */
export const runTee = ({ command, args, cwd, env, logDir, onStarted, stdin = process.stdin }) =>
  new Promise((resolveRun) => {
    mkdirSync(logDir, { recursive: true });
    pruneLogs(logDir);
    const logPath = join(logDir, `dev-${fileStamp()}.log`);
    const file = createWriteStream(logPath, { flags: "a" });
    const sink = (text) => file.write(text);
    const out = createLineWriter(sink, "out");
    const err = createLineWriter(sink, "err");

    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["inherit", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    onStarted?.({ logPath, child });

    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      out.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      err.write(chunk);
    });

    // 端末からの Ctrl-C は同じプロセスグループの子にも届く。二重に送ると Vite / turbo が
    // 「強制終了」扱いにするので、端末以外 (Claude Code の background 起動など、ラッパーの
    // pid だけを kill される場合) に限って SIGINT を転送する。SIGTERM は端末からは来ないので常に転送。
    const forward = (signal) => {
      if (child.exitCode === null && child.signalCode === null) signalTree(child.pid, signal);
    };
    const onSigint = () => {
      if (!stdin.isTTY) forward("SIGINT");
    };
    const onSigterm = () => forward("SIGTERM");
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);

    const finish = (code) => {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      out.flush();
      err.flush();
      // process.exit 直行は WriteStream の末尾を落とす。書き終わるまで待つ。
      file.end(() => resolveRun({ code, logPath }));
    };
    child.on("close", (code, signal) => finish(code ?? (signal ? 1 : 0)));
    child.on("error", (error) => {
      sink(`[${clockStamp()}] [err] failed to start ${command}: ${error.message}\n`);
      finish(1);
    });
  });

const main = async () => {
  const separator = process.argv.indexOf("--");
  const commandLine = separator >= 0 ? process.argv.slice(separator + 1) : process.argv.slice(2);
  if (commandLine.length === 0) {
    process.stderr.write("usage: dev-log.mjs -- <command> [args...]\n");
    process.exit(2);
  }
  const [command, ...args] = commandLine;
  const env = { ...process.env };
  // Claude Code などが立てる ELECTRON_RUN_AS_NODE が残っていると Electron が Node として起動する。
  delete env.ELECTRON_RUN_AS_NODE;
  const cwd = process.cwd();
  const logDir = resolve(cwd, ".logs");
  const digestScript = resolve(fileURLToPath(import.meta.url), "../log-digest.mjs");

  const { code, logPath } = await runTee({
    command,
    args,
    cwd,
    env,
    logDir,
    onStarted: (started) => process.stderr.write(`dev log → ${started.logPath}\n`),
  });
  printSummary(logPath, digestScript);
  process.exitCode = code;
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}

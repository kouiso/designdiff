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
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath, pathToFileURL } from "node:url";

const MAX_FILES = 10;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const MAX_PERSISTED_LINE_LENGTH = 8192;
const SIGNAL_GRACE_MS = 3000;
const QUOTA_LOCK_TIMEOUT_MS = 2000;
const PUBLICATION_GRACE_MS = 1000;
const TRUNCATED_SUFFIX = "…[truncated]";
const SIGNAL_EXIT_CODES = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143, SIGKILL: 137 };

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
export const createLineWriter = (
  sink,
  streamName,
  now = clockStamp,
  maxRestLength = MAX_PERSISTED_LINE_LENGTH,
) => {
  const decoder = new StringDecoder("utf8");
  let rest = "";
  let droppingLongLine = false;
  const emit = (line) => sink(`[${now()}] [${streamName}] ${line}\n`);
  const consume = (input) => {
    let text = input;
    if (droppingLongLine) {
      const newline = text.indexOf("\n");
      if (newline < 0) return;
      text = text.slice(newline + 1);
      droppingLongLine = false;
    }
    const parts = (rest + text).split("\n");
    rest = parts.pop() ?? "";
    for (const line of parts) emit(line);
    if (rest.length > maxRestLength) {
      emit(`${rest.slice(0, maxRestLength - TRUNCATED_SUFFIX.length)}${TRUNCATED_SUFFIX}`);
      rest = "";
      droppingLongLine = true;
    }
  };
  return {
    write: (chunk) => consume(typeof chunk === "string" ? chunk : decoder.write(chunk)),
    flush: () => {
      consume(decoder.end());
      if (rest.length > 0) {
        emit(rest);
        rest = "";
      }
    },
  };
};

/** 古い順に消して、本数と合計バイト数を上限内に収める。 */
export const pruneLogs = (dir, { maxFiles = MAX_FILES, maxTotalBytes = MAX_TOTAL_BYTES } = {}) => {
  const removed = [];
  const skipped = new Set();
  while (true) {
    let entries;
    try {
      entries = readdirSync(dir)
        .filter((name) => /^dev-\d{8}-\d{6}(?:-\d+)?\.log$/.test(name))
        .flatMap((name) => {
          const path = join(dir, name);
          try {
            const stat = statSync(path);
            return stat.isFile() ? [{ path, size: stat.size }] : [];
          } catch {
            return [];
          }
        })
        .sort((a, b) => (a.path < b.path ? -1 : 1));
    } catch {
      return removed;
    }
    const total = entries.reduce((sum, entry) => sum + entry.size, 0);
    if (entries.length <= maxFiles && total <= maxTotalBytes) return removed;
    const oldest = entries.find((entry) => !skipped.has(entry.path));
    if (!oldest) return removed;
    try {
      unlinkSync(oldest.path);
      removed.push(oldest.path);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
      skipped.add(oldest.path);
    }
  }
};

// ESC (0x1b) をリテラルで書くと no-control-regex に当たるので組み立てる。
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, "g");
const stripAnsi = (text) => text.replace(ANSI_PATTERN, "");

const PATH_SEGMENT = `[^\\s/\\\\"'\`]+`;
const SPACED_SEGMENT = `${PATH_SEGMENT}(?:[ \\t]+${PATH_SEGMENT})*`;
const ABSOLUTE_PATH_PATTERN = new RegExp(
  [
    `(?:[A-Za-z]:|\\\\\\\\[^\\s\\\\]+\\\\+[^\\s\\\\]+)\\\\+(?:${SPACED_SEGMENT}\\\\+)*${PATH_SEGMENT}`,
    `/+(?:${SPACED_SEGMENT}/+)*${SPACED_SEGMENT}/+${PATH_SEGMENT}`,
  ].join("|"),
  "g",
);
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi;
const URL_MARKER_PATTERN = /__LOG_URL_(\d+)__/g;
const JSON_MEMBER_PATTERN = /("((?:\\.|[^"\\])*)"\s*:\s*)("(?:\\.|[^"\\])*"|[^,}\]\s]+)/gu;
const SECRET_KEY_SOURCE =
  "x-figma-token|token|(?:access|refresh|id|api|auth)[_-]?token|client[_-]?secret|secret|password|passwd|api[_-]?key|authorization|cookie|set-cookie";
const normalizeKey = (key) => key.replace(/([a-z\d])([A-Z])/g, "$1_$2").toLowerCase();
const isSecretKey = (key) => {
  const normalized = normalizeKey(key);
  return (
    /^(?:x-figma-token|token|(?:access|refresh|id|api|auth)[_-]?token|client[_-]?secret|secret|password|passwd|api[_-]?key|authorization|cookie|set-cookie)$/.test(
      normalized,
    ) || /(?:^|[_-])token(?:$|[_-])/.test(normalized)
  );
};
const redactJsonSecrets = (text) =>
  text.replace(JSON_MEMBER_PATTERN, (match, prefix, encodedKey) => {
    try {
      const key = JSON.parse(`"${encodedKey}"`);
      return typeof key === "string" && isSecretKey(key) ? `${prefix}"***"` : match;
    } catch {
      return match;
    }
  });
const sanitizeUrl = (raw) => {
  const trailing = /[),.;]+$/.exec(raw)?.[0] ?? "";
  const candidate = trailing ? raw.slice(0, -trailing.length) : raw;
  try {
    const url = new URL(candidate);
    let changed = false;
    if (url.password) {
      url.password = "***";
      changed = true;
    }
    for (const key of new Set(url.searchParams.keys())) {
      if (!isSecretKey(key)) continue;
      url.searchParams.set(key, "***");
      changed = true;
    }
    return changed ? `${url.toString()}${trailing}` : raw;
  } catch {
    return raw;
  }
};
const transformOutsideUrls = (text, transform) => {
  const urls = [];
  const protectedText = text.replace(URL_PATTERN, (url) => {
    urls.push(sanitizeUrl(url));
    return `__LOG_URL_${urls.length - 1}__`;
  });
  return transform(protectedText).replace(
    URL_MARKER_PATTERN,
    (_marker, index) => urls[Number(index)] ?? "[URL]",
  );
};
const redactKeyValue = (text, keys) =>
  text.replace(
    new RegExp(
      `(["']?(?:${keys})["']?\\s*[:=]\\s*)(?:"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|[^\\s,;}&]+)`,
      "giu",
    ),
    "$1***",
  );

const truncate = (text) =>
  text.length > MAX_PERSISTED_LINE_LENGTH
    ? `${text.slice(0, MAX_PERSISTED_LINE_LENGTH - TRUNCATED_SUFFIX.length)}${TRUNCATED_SUFFIX}`
    : text;

/** 端末表示は変えず、永続ファイルへ渡す文字列だけを伏せる。 */
export const sanitizeLogText = (text) =>
  truncate(
    transformOutsideUrls(
      redactKeyValue(
        redactJsonSecrets(text)
          .replace(/figd_[A-Za-z0-9_-]+/gi, "figd_***")
          .replace(/\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]+\b/gi, "[REDACTED]")
          .replace(/(["']?authorization["']?\s*[:=]\s*)(?:Bearer|Basic)\s+[^\s,;}&]+/giu, "$1***")
          .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***"),
        SECRET_KEY_SOURCE,
      ),
      (value) =>
        value.replace(
          ABSOLUTE_PATH_PATTERN,
          (match) => match.split(/[\\/]/).filter(Boolean).at(-1) ?? match,
        ),
    ),
  );

const reserveLogFile = (dir) => {
  const base = `dev-${fileStamp()}`;
  for (let counter = 0; counter < 10_000; counter += 1) {
    const suffix = counter === 0 ? "" : `-${counter}`;
    const logPath = join(dir, `${base}${suffix}.log`);
    const activePath = `${logPath}.active`;
    const ownerPath = `${activePath}.owner`;
    try {
      if (existsSync(logPath)) continue;
      const owner = currentProcessOwner();
      atomicPublishJson(ownerPath, owner);
      let fd;
      try {
        fd = openSync(activePath, "wx");
      } catch (error) {
        removeOwnedPublication(ownerPath, owner.nonce);
        throw error;
      }
      return { activePath, fd, logPath, owner, ownerPath };
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") continue;
      throw error;
    }
  }
  throw new Error("cannot reserve a unique dev log file");
};

const logBytesInUse = (dir) => {
  try {
    return readdirSync(dir)
      .filter((name) => /^dev-\d{8}-\d{6}(?:-\d+)?\.log(?:\.active)?$/.test(name))
      .reduce((total, name) => {
        try {
          return total + statSync(join(dir, name)).size;
        } catch {
          return total;
        }
      }, 0);
  } catch {
    return 0;
  }
};

export const signalExitCode = (signal) => SIGNAL_EXIT_CODES[signal] ?? 1;

/** POSIX は専用process groupへ1回だけ送り、子孫をまとめて止める。 */
export const signalTree = (rootPid, signal) => {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(rootPid), "/T", ...(signal === "SIGKILL" ? ["/F"] : [])]);
    return;
  }
  try {
    process.kill(-rootPid, signal);
  } catch {
    // process group が既に消えていれば終了済み。
  }
};

const isProcessGroupAlive = (rootPid) => {
  if (process.platform === "win32") return isProcessAlive(rootPid);
  try {
    process.kill(-rootPid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "ESRCH");
  }
};

const isProcessAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "ESRCH");
  }
};

export const processStartToken = (pid, run = spawnSync, platform = process.platform) => {
  const commands =
    platform === "win32"
      ? [
          [
            "powershell.exe",
            [
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`,
            ],
          ],
          ["wmic", ["process", "where", `ProcessId=${pid}`, "get", "CreationDate", "/value"]],
        ]
      : [["ps", ["-o", "lstart=", "-p", String(pid)]]];
  for (const [command, args] of commands) {
    const result = run(command, args, { encoding: "utf8" });
    const output = typeof result.stdout === "string" ? result.stdout.trim() : "";
    if (result.status !== 0 || output.length === 0) continue;
    if (platform !== "win32") return output;
    const token = /CreationDate=(\S+)/.exec(output)?.[1] ?? output.split(/\s+/).at(-1);
    if (token) return token;
  }
  return null;
};

let selfStartToken;
const currentProcessOwner = () => {
  if (selfStartToken === undefined) selfStartToken = processStartToken(process.pid);
  return {
    createdAt: Date.now(),
    nonce: randomUUID(),
    pid: process.pid,
    startToken: selfStartToken,
  };
};

const ownerIsAlive = ({ pid, startToken }) => {
  if (!Number.isInteger(pid) || pid <= 0 || !isProcessAlive(pid)) return false;
  if (typeof startToken !== "string" || startToken.length === 0) return true;
  const currentToken = processStartToken(pid);
  return currentToken === null || currentToken === startToken;
};

const waitSync = (milliseconds) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
};

const atomicPublishJson = (targetPath, value) => {
  const tempPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
  let tempFd = null;
  try {
    tempFd = openSync(tempPath, "wx");
    const bytes = Buffer.from(JSON.stringify(value));
    let offset = 0;
    while (offset < bytes.length) {
      const written = writeSync(tempFd, bytes, offset, bytes.length - offset);
      if (written <= 0) throw new Error(`failed to publish ${targetPath}`);
      offset += written;
    }
    fsyncSync(tempFd);
    closeSync(tempFd);
    tempFd = null;
    linkSync(tempPath, targetPath);
  } finally {
    if (tempFd !== null) {
      try {
        closeSync(tempFd);
      } catch {
        // 失敗経路のfdは次の処理へ持ち越さない。
      }
    }
    try {
      unlinkSync(tempPath);
    } catch {
      // 公開済みhard-linkには影響しない。
    }
  }
};

const readPublication = (path) => {
  try {
    const stat = statSync(path);
    const raw = readFileSync(path, "utf8");
    let value = null;
    try {
      value = JSON.parse(raw);
    } catch {
      // 旧実装が残したpartial publicationは猶予後に回収する。
    }
    return { dev: stat.dev, ino: stat.ino, mtimeMs: stat.mtimeMs, raw, value };
  } catch {
    return null;
  }
};

const removeUnchangedPublication = (path, observed) => {
  const current = readPublication(path);
  if (
    !current ||
    current.dev !== observed.dev ||
    current.ino !== observed.ino ||
    current.raw !== observed.raw
  )
    return false;
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
};

const removeOwnedPublication = (path, nonce) => {
  const observed = readPublication(path);
  if (!observed || observed.value?.nonce !== nonce) return false;
  return removeUnchangedPublication(path, observed);
};

/** 複数の dev-log 間で quota の確認と書き込みを直列化する。 */
const withQuotaLock = (dir, callback, timeoutMs = QUOTA_LOCK_TIMEOUT_MS) => {
  const lockPath = join(dir, ".dev-log-quota.lock");
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const lockOwner = currentProcessOwner();
    try {
      atomicPublishJson(lockPath, lockOwner);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      const observed = readPublication(lockPath);
      const owner = observed?.value;
      const validOwner = Number.isInteger(owner?.pid) && owner.pid > 0;
      const invalidAndOld =
        observed && !validOwner && Date.now() - observed.mtimeMs >= PUBLICATION_GRACE_MS;
      if (observed && ((validOwner && !ownerIsAlive(owner)) || invalidAndOld)) {
        removeUnchangedPublication(lockPath, observed);
        continue;
      }
      if (Date.now() >= deadline) throw new Error("timed out waiting for dev log quota lock");
      waitSync(10);
      continue;
    }
    try {
      return callback();
    } finally {
      removeOwnedPublication(lockPath, lockOwner.nonce);
    }
  }
};

const cleanupOrphanOwners = (dir, allNames, publicationGraceMs) => {
  for (const ownerName of allNames.filter((name) =>
    /^dev-\d{8}-\d{6}(?:-\d+)?\.log\.active\.owner$/.test(name),
  )) {
    const ownerPath = join(dir, ownerName);
    const activePath = ownerPath.slice(0, -".owner".length);
    const observed = readPublication(ownerPath);
    if (observed && !existsSync(activePath) && Date.now() - observed.mtimeMs >= publicationGraceMs)
      removeUnchangedPublication(ownerPath, observed);
  }
};

const activeOwnerIsAlive = (owner, isAlive, getStartToken) => {
  if (!isAlive(owner.pid)) return false;
  if (typeof owner.startToken !== "string" || owner.startToken.length === 0) return true;
  const currentStartToken = getStartToken(owner.pid);
  return currentStartToken === null || currentStartToken === owner.startToken;
};

const activeIsOldEnough = (activePath, publicationGraceMs) => {
  try {
    return Date.now() - statSync(activePath).mtimeMs >= publicationGraceMs;
  } catch {
    return false;
  }
};

const promoteStaleActive = (dir, name, isAlive, getStartToken, publicationGraceMs) => {
  const activePath = join(dir, name);
  const ownerPath = `${activePath}.owner`;
  const logPath = activePath.slice(0, -".active".length);
  const ownerPublication = readPublication(ownerPath);
  const owner = ownerPublication?.value;
  const validOwner = Number.isInteger(owner?.pid) && owner.pid > 0;
  if (validOwner && activeOwnerIsAlive(owner, isAlive, getStartToken)) return null;
  if (!validOwner && !activeIsOldEnough(activePath, publicationGraceMs)) return null;
  if (existsSync(logPath)) return null;
  try {
    renameSync(activePath, logPath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT" && ownerPublication)
      removeUnchangedPublication(ownerPath, ownerPublication);
    return null;
  }
  if (ownerPublication) removeUnchangedPublication(ownerPath, ownerPublication);
  return logPath;
};

/** 終了したwriterのactiveをfinalへ昇格し、クラッシュ直前までのログをdigest対象に戻す。 */
export const recoverStaleActiveLogs = (
  dir,
  isAlive = isProcessAlive,
  getStartToken = processStartToken,
  publicationGraceMs = PUBLICATION_GRACE_MS,
) => {
  let allNames;
  try {
    allNames = readdirSync(dir);
  } catch {
    return [];
  }
  cleanupOrphanOwners(dir, allNames, publicationGraceMs);
  return allNames
    .filter((name) => /^dev-\d{8}-\d{6}(?:-\d+)?\.log\.active$/.test(name))
    .flatMap((name) => {
      const promoted = promoteStaleActive(dir, name, isAlive, getStartToken, publicationGraceMs);
      return promoted ? [promoted] : [];
    });
};

/** 終了時の 1 行要約。digest が無い・失敗しても、パスだけは必ず出す。 */
export const printSummary = (
  logPath,
  digestScript,
  write = (text) => process.stderr.write(text),
  complete = true,
) => {
  if (!existsSync(logPath)) {
    write(`dev log unavailable → ${logPath}\n`);
    return;
  }
  if (!complete) {
    write(`dev log incomplete → ${logPath}\n`);
    return;
  }
  const result = spawnSync(process.execPath, [digestScript, "--file", logPath, "--summary"], {
    encoding: "utf8",
  });
  const line = result.status === 0 ? stripAnsi(result.stdout ?? "").trim() : "";
  write(`${line.length > 0 ? line : `dev log → ${logPath}`}\n`);
};

const finishLogFile = ({
  activePath,
  fd,
  fileBroken,
  logDir,
  logPath,
  maxFiles,
  maxTotalBytes,
  ownerPath,
  owner,
  persistedBytes,
  logComplete,
  quotaLockTimeoutMs,
}) => {
  let broken = fileBroken;
  if (fd !== null) {
    try {
      closeSync(fd);
      if (!broken && persistedBytes > 0 && activePath) {
        withQuotaLock(
          logDir,
          () => {
            renameSync(activePath, logPath);
            pruneLogs(logDir, { maxFiles, maxTotalBytes });
          },
          quotaLockTimeoutMs,
        );
      } else if (activePath) {
        unlinkSync(activePath);
      }
    } catch (error) {
      broken = true;
      process.stderr.write(
        `[dev-log] file logging disabled: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }
  if (ownerPath && owner) removeOwnedPublication(ownerPath, owner.nonce);
  if (broken && activePath) {
    try {
      unlinkSync(activePath);
    } catch {
      // 自分の active が既に無ければ後片付け済み。
    }
  }
  try {
    return !broken && logComplete && persistedBytes > 0 && statSync(logPath).size > 0;
  } catch {
    return false;
  }
};

/**
 * 子を起動して tee する。解決したら { code, logPath }。
 * stdin は inherit: Vite / electron-vite のキー操作 (r/u/o/q) を壊さない。
 */
export const runTee = ({
  command,
  args,
  cwd,
  env,
  logDir,
  onStarted,
  maxLogBytes = MAX_TOTAL_BYTES,
  maxFiles = MAX_FILES,
  maxTotalBytes = MAX_TOTAL_BYTES,
  quotaLockTimeoutMs = QUOTA_LOCK_TIMEOUT_MS,
  signalGraceMs = SIGNAL_GRACE_MS,
}) =>
  new Promise((resolveRun) => {
    let fd = null;
    let activePath = null;
    let ownerPath = null;
    let owner = null;
    let fileBroken = false;
    let logComplete = true;
    let logPath = join(logDir, `dev-${fileStamp()}.log`);
    let persistedBytes = 0;
    let sizeWarningPrinted = false;
    try {
      mkdirSync(logDir, { recursive: true });
      withQuotaLock(
        logDir,
        () => {
          recoverStaleActiveLogs(logDir);
          pruneLogs(logDir, { maxFiles, maxTotalBytes });
          ({ activePath, fd, logPath, owner, ownerPath } = reserveLogFile(logDir));
        },
        quotaLockTimeoutMs,
      );
    } catch (error) {
      fileBroken = true;
      process.stderr.write(
        `[dev-log] file logging disabled: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
    const sink = (text) => {
      if (fileBroken || fd === null) return;
      const bytes = Buffer.from(sanitizeLogText(text));
      try {
        withQuotaLock(
          logDir,
          () => {
            const remaining = Math.min(
              maxLogBytes - persistedBytes,
              maxTotalBytes - logBytesInUse(logDir),
            );
            if (bytes.length <= remaining) {
              writeSync(fd, bytes);
              persistedBytes += bytes.length;
            } else {
              logComplete = false;
              if (!sizeWarningPrinted) {
                sizeWarningPrinted = true;
                process.stderr.write(`[dev-log] file size limit reached: ${logPath}\n`);
              }
            }
          },
          quotaLockTimeoutMs,
        );
      } catch (error) {
        fileBroken = true;
        process.stderr.write(
          `[dev-log] file logging disabled: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
    };
    const out = createLineWriter(sink, "out");
    const err = createLineWriter(sink, "err");

    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["inherit", "pipe", "pipe"],
      shell: process.platform === "win32",
      detached: process.platform !== "win32",
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

    // 子を専用process groupにしたため、端末のCtrl-Cはwrapperだけが受ける。
    // wrapperからgroupへ1回送れば、turbo配下を列挙せず全員へ同じsignalを届けられる。
    let requestedSignal = null;
    let killTimer = null;
    let closeDeadlineTimer = null;
    let escalating = false;
    let pendingFinish = null;
    const shutdownStillAlive = () => isProcessGroupAlive(child.pid);
    const requestShutdown = (signal) => {
      if (requestedSignal || !shutdownStillAlive()) return;
      requestedSignal = signal;
      signalTree(child.pid, signal);
      if (!killTimer) {
        killTimer = setTimeout(() => {
          killTimer = null;
          escalating = true;
          signalTree(child.pid, "SIGKILL");
          const deadline = Date.now() + 1000;
          const waitUntilGone = () => {
            if (shutdownStillAlive() && Date.now() < deadline) {
              setTimeout(waitUntilGone, 10);
              return;
            }
            escalating = false;
            if (pendingFinish) {
              const pending = pendingFinish;
              pendingFinish = null;
              finalize(pending.code, pending.signal);
            }
          };
          waitUntilGone();
        }, signalGraceMs);
      }
    };
    const onSighup = () => requestShutdown("SIGHUP");
    const onSigint = () => requestShutdown("SIGINT");
    const onSigterm = () => requestShutdown("SIGTERM");
    process.on("SIGHUP", onSighup);
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);

    let finished = false;
    const finalize = (code, signal) => {
      if (finished) return;
      finished = true;
      process.off("SIGHUP", onSighup);
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      if (closeDeadlineTimer) clearTimeout(closeDeadlineTimer);
      out.flush();
      err.flush();
      const finalCode = code ?? signalExitCode(requestedSignal ?? signal);
      const loggingEnabled = finishLogFile({
        activePath,
        fd,
        fileBroken,
        logDir,
        logPath,
        maxFiles,
        maxTotalBytes,
        ownerPath,
        owner,
        persistedBytes,
        logComplete,
        quotaLockTimeoutMs,
      });
      fd = null;
      resolveRun({ code: finalCode, logPath, loggingEnabled });
    };
    const finish = (code, signal) => {
      if (finished) return;
      if (killTimer && shutdownStillAlive()) {
        pendingFinish = { code, signal };
        return;
      }
      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = null;
      }
      if (escalating) {
        pendingFinish = { code, signal };
        return;
      }
      finalize(code, signal);
    };
    child.on("close", (code, signal) => finish(code, signal));
    child.on("exit", (code, signal) => {
      if (!requestedSignal || finished || closeDeadlineTimer) return;
      closeDeadlineTimer = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        finalize(code, signal);
      }, signalGraceMs + 1000);
    });
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

  const { code, logPath, loggingEnabled } = await runTee({
    command,
    args,
    cwd,
    env,
    logDir,
    onStarted: (started) => process.stderr.write(`dev log → ${started.logPath}\n`),
  });
  printSummary(logPath, digestScript, undefined, loggingEnabled);
  process.exitCode = code;
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}

#!/usr/bin/env node
/**
 * ログの「流れて消えた警告」をまとめて見る。
 *
 * 読む場所:
 *   - electron-log の main.log (アプリ本体: main + renderer の console)
 *   - .logs/dev-*.log (`pnpm dev` のターミナル出力。script/dev-log.mjs が残す)
 *   - ~/.figdiff/logs/mcp-server.log (MCP サーバーの stderr。Claude Code の裏で動く分)
 *
 * warn / error だけを抜き、同じメッセージをまとめて件数・初回・最終を表にする。
 * dev ログの level 判定と ANSI 除去はここだけが持つ (dev-log.mjs は素の tee)。
 *
 * 使い方:
 *   node script/log-digest.mjs [--since 2h] [--level error] [--json]
 *   node script/log-digest.mjs --file .logs/dev-20260902-103045.log --summary
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const APP_LOG_NAME = "FigDiff";

// --- 入力の場所 ---------------------------------------------------------------

export const electronLogDir = (
  appName,
  { platform = process.platform, home = homedir(), env = process.env } = {},
) => {
  if (platform === "darwin") return join(home, "Library", "Logs", appName);
  if (platform === "win32")
    return join(env.APPDATA ?? join(home, "AppData", "Roaming"), appName, "logs");
  return join(home, ".config", appName, "logs");
};

export const mcpLogDir = ({ home = homedir(), env = process.env } = {}) =>
  join(
    env.FIGDIFF_HOME && env.FIGDIFF_HOME.trim().length > 0
      ? resolve(env.FIGDIFF_HOME)
      : join(home, ".figdiff"),
    "logs",
  );

const withOld = (path) => [path.replace(/\.log$/, ".old.log"), path];

export const defaultSources = (cwd = process.cwd()) => {
  const appDir = electronLogDir(APP_LOG_NAME);
  const devDir = resolve(cwd, ".logs");
  let devFiles = [];
  try {
    devFiles = readdirSync(devDir)
      .filter((name) => /^dev-\d{8}-\d{6}\.log$/.test(name))
      .sort()
      .map((name) => join(devDir, name));
  } catch {
    devFiles = [];
  }
  return [
    { kind: "app", label: "app (electron-log)", paths: withOld(join(appDir, "main.log")) },
    { kind: "dev", label: "dev (.logs)", paths: devFiles },
    {
      kind: "mcp",
      label: "mcp (~/.figdiff/logs)",
      paths: withOld(join(mcpLogDir(), "mcp-server.log")),
    },
  ];
};

// --- 行の解釈 -----------------------------------------------------------------

// ESC (0x1b) をリテラルで書くと no-control-regex に当たるので組み立てる。
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, "g");
export const stripAnsi = (text) => text.replace(ANSI_PATTERN, "");

// `.` は \r に当たらないので s フラグ。dev ログは \r を残したまま保存している。
const ELECTRON_LINE =
  /^\[(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?\] \[(\w+)\] ?(.*)$/s;
const DEV_LINE = /^\[(\d{2}):(\d{2}):(\d{2})\] \[(out|err)\] ?(.*)$/s;
const DEV_FILE_DATE = /dev-(\d{4})(\d{2})(\d{2})-\d{6}\.log$/;
// turbo が付ける `pkg:task: ` 接頭辞 (例: `@figdiff/desktop:dev: `)。
const TURBO_PREFIX = /^[@\w./-]+:[\w:-]+: /;
// 行頭に固定した判定だけを使う。行中の "error" (error-boundary.tsx のコンパイル行など) は数えない。
// pnpm の ` ELIFECYCLE  Command failed` は数えない: Ctrl-C で止めるたびに出る症状行で、原因は別の行にある。
const LEVEL_HEAD = /^(?:[✘×]\s*)?\[?(ERROR|WARN(?:ING)?|FATAL)\]?\b/i;
// Chromium / Electron 本体の形式。pid 付き `[26058:0903/004627.203911:ERROR:ssl_client_socket_impl.cc(924)]`
// と pid 無し `[0903/003025.705923:FATAL:electron_main_delegate.cc(216)]` の両方がある。
const CHROMIUM_HEAD = /^\[(?:\d+:)?\d+\/\d+\.\d+:(ERROR|WARNING|FATAL):/;
const VITE_HEAD = /^\[(?:vite|electron-vite)\] (Internal server error|error|warning)\b/i;

const toEpoch = (y, mo, d, h, mi, s, ms = "0") =>
  new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s),
    Number(ms),
  ).getTime();

const normalizeLevel = (raw) => {
  const lower = raw.toLowerCase();
  if (lower === "error" || lower === "fatal") return "error";
  if (lower === "warn" || lower === "warning") return "warn";
  return lower;
};

/** electron-log / mcp-server.log の 1 行。level は既にファイルに書いてある。 */
export const parseElectronLine = (line) => {
  const m = ELECTRON_LINE.exec(stripAnsi(line));
  if (!m) return null;
  return {
    time: toEpoch(m[1], m[2], m[3], m[4], m[5], m[6], m[7]),
    level: normalizeLevel(m[8]),
    // electron-log は level を 5 桁に揃えるので `[info]  text` と空白が 2 つ入る。
    message: m[9].trim(),
  };
};

/** dev ログ 1 行。`\r` で区切った各断片を独立した行として判定する。 */
export const parseDevLine = (line, fileDate) => {
  const m = DEV_LINE.exec(line);
  if (!m) return [];
  const time = toEpoch(fileDate.y, fileDate.mo, fileDate.d, m[1], m[2], m[3]);
  const stream = m[4];
  return stripAnsi(m[5])
    .split("\r")
    .map((fragment) => fragment.replace(TURBO_PREFIX, "").trim())
    .filter((fragment) => fragment.length > 0)
    .map((message) => ({ time, level: classifyDevMessage(message), stream, message }));
};

export const classifyDevMessage = (message) => {
  const head = LEVEL_HEAD.exec(message);
  if (head) return normalizeLevel(head[1]);
  const chromium = CHROMIUM_HEAD.exec(message);
  if (chromium) return normalizeLevel(chromium[1]);
  const vite = VITE_HEAD.exec(message);
  if (vite) return /warn/i.test(vite[1]) ? "warn" : "error";
  return "info";
};

export const devFileDate = (path) => {
  const m = DEV_FILE_DATE.exec(basename(path));
  if (!m) return null;
  return { y: m[1], mo: m[2], d: m[3] };
};

export const readEntries = (source) => {
  const entries = [];
  for (const path of source.paths) {
    if (!existsSync(path)) continue;
    const lines = readFileSync(path, "utf8").split("\n");
    if (source.kind === "dev") {
      const date = devFileDate(path);
      if (!date) continue;
      for (const line of lines) {
        for (const entry of parseDevLine(line, date))
          entries.push({ ...entry, source: source.kind, file: path, raw: line });
      }
    } else {
      for (const line of lines) {
        const entry = parseElectronLine(line);
        if (entry) entries.push({ ...entry, source: source.kind, file: path, raw: line });
      }
    }
  }
  return entries;
};

// --- 集計 ---------------------------------------------------------------------

/** 数値・ID・絶対パスを伏せて「同じ種類の行」にまとめる。 */
export const normalizeMessage = (message) =>
  message
    .replace(/figd_[A-Za-z0-9_-]+/g, "figd_***")
    .replace(/\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]+\b/g, "[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer ***")
    .replace(/(?:[A-Za-z]:)?(?:\/[^\s"'()]+)+/g, (path) => basename(path))
    .replace(/0x[0-9a-f]+/gi, "«HEX»")
    .replace(/\b[0-9a-f]{8,}\b/gi, "#")
    .replace(/\d+/g, "#")
    .replace(/«HEX»/g, "0x#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);

const DEDUPE_WINDOW_MS = 5000;

/**
 * main プロセスの console は main.log と dev ログの両方に出る。
 * 正規化メッセージが同じで時刻が ±5 秒以内なら dev 側を落とす (app が正)。
 */
export const dedupe = (entries) => {
  const app = entries.filter((entry) => entry.source === "app");
  return entries.filter((entry) => {
    if (entry.source !== "dev") return true;
    const key = normalizeMessage(entry.message);
    return !app.some(
      (other) =>
        Math.abs(other.time - entry.time) <= DEDUPE_WINDOW_MS &&
        normalizeMessage(other.message) === key,
    );
  });
};

export const parseSince = (value, now = Date.now()) => {
  if (!value) return null;
  const rel = /^(\d+)([smhd])$/.exec(value);
  if (rel) {
    const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[rel[2]];
    return now - Number(rel[1]) * unit;
  }
  const abs = Date.parse(value);
  return Number.isNaN(abs) ? null : abs;
};

export const digest = (entries, { since = null, minLevel = "warn" } = {}) => {
  const wanted = minLevel === "error" ? new Set(["error"]) : new Set(["warn", "error"]);
  const groups = new Map();
  for (const entry of dedupe(entries)) {
    if (!wanted.has(entry.level)) continue;
    if (since !== null && entry.time < since) continue;
    const normalized = normalizeMessage(entry.message);
    const key = `${entry.level} ${normalized}`;
    const group = groups.get(key);
    if (group) {
      group.count += 1;
      group.first = Math.min(group.first, entry.time);
      group.last = Math.max(group.last, entry.time);
      if (!group.sources.includes(entry.source)) group.sources.push(entry.source);
    } else {
      groups.set(key, {
        level: entry.level,
        message: normalized,
        // JSON 出力にも生ログを混ぜん。診断値は正規化後の形だけを返す。
        sample: normalized,
        count: 1,
        first: entry.time,
        last: entry.time,
        sources: [entry.source],
      });
    }
  }
  return [...groups.values()].sort((a, b) => b.last - a.last);
};

// --- 出力 ---------------------------------------------------------------------

const fmtTime = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

export const formatTable = (rows) => {
  if (rows.length === 0) return "warn / error はありません。\n";
  const lines = [
    `件数 | level | 初回 | 最終 | 出所 | メッセージ`,
    `---: | ----- | ---- | ---- | ---- | ----------`,
  ];
  for (const row of rows) {
    lines.push(
      `${row.count} | ${row.level} | ${fmtTime(row.first)} | ${fmtTime(row.last)} | ${row.sources.join("+")} | ${row.message}`,
    );
    if (row.sample !== row.message) lines.push(`   | | | | | 生: ${row.sample.slice(0, 200)}`);
  }
  return `${lines.join("\n")}\n`;
};

export const summarize = (rows, label) => {
  const warn = rows.filter((row) => row.level === "warn").reduce((n, row) => n + row.count, 0);
  const error = rows.filter((row) => row.level === "error").reduce((n, row) => n + row.count, 0);
  const mark = error > 0 ? "✖" : warn > 0 ? "⚠" : "✓";
  return `${mark} warn ${warn} / error ${error} → ${label}\n`;
};

const parseArgs = (argv) => {
  const options = { since: null, level: "warn", json: false, file: null, summary: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--since") options.since = argv[++i] ?? null;
    else if (arg === "--level") options.level = argv[++i] === "error" ? "error" : "warn";
    else if (arg === "--json") options.json = true;
    else if (arg === "--file") options.file = argv[++i] ?? null;
    else if (arg === "--summary") options.summary = true;
  }
  return options;
};

const main = () => {
  const options = parseArgs(process.argv.slice(2));
  const since = parseSince(options.since);
  if (options.since && since === null) {
    process.stderr.write(
      `--since の値が読めません: ${options.since} (例: 30m, 2h, 1d, 2026-09-02T10:00)\n`,
    );
    process.exitCode = 2;
    return;
  }
  const sources = options.file
    ? [
        {
          kind: devFileDate(options.file) ? "dev" : "app",
          label: options.file,
          paths: [resolve(options.file)],
        },
      ]
    : defaultSources();
  const entries = sources.flatMap(readEntries);
  const rows = digest(entries, { since, minLevel: options.level });

  if (options.summary) {
    process.stdout.write(summarize(rows, options.file ?? "all logs"));
    return;
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    return;
  }
  const found = sources.map(
    (source) => `${source.label}: ${source.paths.filter((p) => existsSync(p)).length} file(s)`,
  );
  process.stdout.write(`${found.join(" / ")}\n\n${formatTable(rows)}`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}

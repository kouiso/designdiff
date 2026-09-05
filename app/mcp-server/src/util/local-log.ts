import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import * as path from "node:path";

import { getFigdiffLogsDir } from "./figdiff-paths.js";

/**
 * MCP サーバーの stderr をファイルにも残す。
 *
 * Claude Code に起動されている間、stderr は Claude Code の奥に埋もれて見えない。
 * ここで console.error / warn / info を一度だけ包み、stderr にはそのまま出しつつ
 * `~/.figdiff/logs/mcp-server.log` にも追記する。
 *
 * 守ること:
 * - stdout には一切書かない (JSON-RPC の本線。script/runtime-smoke.mjs が見張っている)。
 * - 書き込みは同期。index.ts は fatal を console.error した直後に process.exit するので、
 *   非同期だとその 1 行が消える。
 * - ファイルに書けなくてもサーバーは落とさない。
 */

const MAX_BYTES = 5 * 1024 * 1024;
const FILE_NAME = "mcp-server.log";
const MAX_TEXT_LENGTH = 8192;
const TRUNCATED_SUFFIX = "…[truncated]";

type ConsoleLevel = "error" | "warn" | "info";

const pad = (n: number): string => String(n).padStart(2, "0");

const timestamp = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
  `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${String(date.getMilliseconds()).padStart(3, "0")}`;

const stringify = (value: unknown): string => {
  try {
    if (typeof value === "string") return value;
    if (value instanceof Error) return value.stack ?? value.message;
    const serialized = JSON.stringify(value);
    if (serialized !== undefined) return serialized;
  } catch {
    // 循環参照や例外を投げる Proxy は String へフォールバックする。
  }
  try {
    return String(value);
  } catch {
    return "[unserializable]";
  }
};

// 引用符付きの値に改行は含めない。伏字は複数行の文字列 (Error のスタック、
// 引数を繋いだ 1 本) にもかかるので、改行を許すと閉じ引用符の無い値が次の行の
// 引用符まで一致し、間のログ行を丸ごと消してしまう。
const JSON_MEMBER_PATTERN = /("((?:\\.|[^"\\\r\n])*)"\s*:\s*)("(?:\\.|[^"\\\r\n])*"|[^,}\]\s]+)/gu;
const SECRET_KEY_SOURCE =
  "x-figma-token|token|(?:access|refresh|id|api|auth)[_-]?token|client[_-]?secret|secret|password|passwd|api[_-]?key|authorization|cookie|set-cookie";
const normalizeKey = (key: string): string =>
  key.replace(/([a-z\d])([A-Z])/g, "$1_$2").toLowerCase();
const isSecretKey = (key: string): boolean => {
  const normalized = normalizeKey(key);
  return (
    /^(?:x-figma-token|token|(?:access|refresh|id|api|auth)[_-]?token|client[_-]?secret|secret|password|passwd|api[_-]?key|authorization|cookie|set-cookie)$/.test(
      normalized,
    ) || /(?:^|[_-])token(?:$|[_-])/.test(normalized)
  );
};
const redactJsonSecrets = (text: string): string =>
  text.replace(JSON_MEMBER_PATTERN, (match, prefix, encodedKey) => {
    try {
      const key: unknown = JSON.parse(`"${encodedKey}"`);
      return typeof key === "string" && isSecretKey(key) ? `${prefix}"***"` : match;
    } catch {
      return match;
    }
  });
const redactKeyValue = (text: string, keys: string): string =>
  text.replace(
    new RegExp(
      `(["']?(?:${keys})["']?\\s*[:=]\\s*)(?:"(?:\\\\.|[^"\\\\\\r\\n])*"|'(?:\\\\.|[^'\\\\\\r\\n])*'|[^\\s,;}&]+)`,
      "giu",
    ),
    "$1***",
  );

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
const sanitizeUrl = (raw: string): string => {
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

const scrubPaths = (text: string): string => {
  const urls: string[] = [];
  const protectedText = text.replace(URL_PATTERN, (url) => {
    urls.push(sanitizeUrl(url));
    return `__LOG_URL_${urls.length - 1}__`;
  });
  return protectedText
    .replace(ABSOLUTE_PATH_PATTERN, (value) => value.split(/[\\/]/).filter(Boolean).at(-1) ?? value)
    .replace(URL_MARKER_PATTERN, (_marker, index) => urls[Number(index)] ?? "[URL]");
};

/** 永続ログへ書く直前に、既知の認証情報を必ず伏せる。 */
export const redactSecrets = (text: string): string => {
  const withoutSecrets = redactKeyValue(
    redactJsonSecrets(text)
      .replace(/figd_[A-Za-z0-9_-]+/gi, "figd_***")
      .replace(/\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]+\b/gi, "[REDACTED]")
      .replace(/(["']?authorization["']?\s*[:=]\s*)(?:Bearer|Basic)\s+[^\s,;}&]+/giu, "$1***")
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***"),
    SECRET_KEY_SOURCE,
  );
  const redacted = scrubPaths(withoutSecrets);
  return redacted.length > MAX_TEXT_LENGTH
    ? `${redacted.slice(0, MAX_TEXT_LENGTH - TRUNCATED_SUFFIX.length)}${TRUNCATED_SUFFIX}`
    : redacted;
};

export interface LocalLogOptions {
  readonly dir?: string;
  readonly maxBytes?: number;
  readonly now?: () => Date;
  readonly enabled?: boolean;
}

export interface LocalLogWriter {
  readonly filePath: string;
  readonly write: (level: ConsoleLevel, params: readonly unknown[]) => void;
}

const rotateIfNeeded = (filePath: string, maxBytes: number): void => {
  let size = 0;
  try {
    size = statSync(filePath).size;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  if (size < maxBytes) return;
  const oldPath = filePath.replace(/\.log$/, ".old.log");
  // Windows の rename は既存の移動先を置換せん。古い一世代を先に消してから回す。
  try {
    rmSync(oldPath, { force: true });
    renameSync(filePath, oldPath);
  } catch (error) {
    // 別プロセスが先に回して現行ファイルが消えた場合だけ追記へ進む。
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
};

/** ファイルへの追記だけを担う。失敗は 1 回だけ stderr に出して、以後は黙る。 */
export const createLocalLogWriter = (options: LocalLogOptions = {}): LocalLogWriter => {
  const dir = options.dir ?? getFigdiffLogsDir();
  const maxBytes = options.maxBytes ?? MAX_BYTES;
  const now = options.now ?? (() => new Date());
  const filePath = path.join(dir, FILE_NAME);
  let broken = false;

  const write = (level: ConsoleLevel, params: readonly unknown[]): void => {
    if (broken) return;
    try {
      mkdirSync(dir, { recursive: true });
      rotateIfNeeded(filePath, maxBytes);
      const text = redactSecrets(params.map(stringify).join(" "));
      appendFileSync(filePath, `[${timestamp(now())}] [${level}] ${text}\n`);
    } catch (error) {
      broken = true;
      process.stderr.write(
        `[local-log] disabled: cannot write ${filePath}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  };

  return { filePath, write };
};

const isDisabledByEnv = (env: NodeJS.ProcessEnv): boolean => env.FIGDIFF_LOCAL_LOG === "0";
const installed = new WeakMap<object, LocalLogWriter>();

/**
 * console.error / warn / info を包む。呼ぶのは起動時の 1 回だけ。
 * FIGDIFF_LOCAL_LOG=0 で無効 (CI や、ホームに書きたくないとき)。
 */
export const installLocalLog = (
  options: LocalLogOptions = {},
  target: Pick<Console, "error" | "warn" | "info"> = console,
  env: NodeJS.ProcessEnv = process.env,
): LocalLogWriter | null => {
  if (options.enabled === false || isDisabledByEnv(env)) return null;
  const existing = installed.get(target);
  if (existing) return existing;
  const writer = createLocalLogWriter(options);
  const levels: readonly ConsoleLevel[] = ["error", "warn", "info"];
  for (const level of levels) {
    const original = target[level].bind(target);
    target[level] = (...params: unknown[]): void => {
      original(...params);
      writer.write(level, params);
    };
  }
  installed.set(target, writer);
  return writer;
};

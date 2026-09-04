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

type ConsoleLevel = "error" | "warn" | "info";

const pad = (n: number): string => String(n).padStart(2, "0");

const timestamp = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
  `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${String(date.getMilliseconds()).padStart(3, "0")}`;

const stringify = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

/**
 * 永続ログへ書く直前に、既知の認証情報を必ず伏せる。
 * 呼び出し側 (formatMcpToolError など) が伏せてくれる前提には立たない —
 * 直接 console.error(rawError) する箇所が 1 つでも増えたら、ここが無ければ
 * 平文でディスクに残るため。形は app/desktop の renderer-log と揃えている。
 */
const FIGMA_PAT = /figd_[A-Za-z0-9_-]+/g;
const GITHUB_TOKEN = /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]+\b/g;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/g;
const KEYED_SECRET =
  /\b((?:access_|refresh_|id_|api_|auth_)?token|client_secret|secret|password|api[_-]?key)(["']?\s*[:=]\s*["']?)[^\s"'&,;]+/gi;

export const redactSecrets = (text: string): string =>
  text
    .replace(FIGMA_PAT, "figd_***")
    .replace(GITHUB_TOKEN, "[REDACTED]")
    .replace(BEARER_TOKEN, "Bearer ***")
    .replace(KEYED_SECRET, (_match, key: string, separator: string) => `${key}${separator}***`);

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

/**
 * ローテーションだけは失敗しても書き込みを諦めない。
 * 同じ FIGDIFF_HOME に対して MCP サーバーが 2 つ動いている場合 (Claude Code の
 * セッションが 2 つなど)、両方が同時に上限を跨いで rename しに来ることがある。
 * 片方が先に回した直後の ENOENT でここを broken 扱いにすると、そのサーバーは
 * 以後ずっと何も残さなくなる。回せなければ、そのまま追記を続ける方がまし。
 */
const rotateIfNeeded = (filePath: string, maxBytes: number): void => {
  let size = 0;
  try {
    size = statSync(filePath).size;
  } catch {
    return;
  }
  if (size < maxBytes) return;
  const oldPath = filePath.replace(/\.log$/, ".old.log");
  try {
    // Windows の rename は既存の移動先を置換せん。古い一世代を先に消してから回す。
    rmSync(oldPath, { force: true });
    renameSync(filePath, oldPath);
  } catch {
    // 別プロセスが先に回した / 掴んでいる。次の書き込みで作り直される。
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
  const writer = createLocalLogWriter(options);
  const levels: readonly ConsoleLevel[] = ["error", "warn", "info"];
  for (const level of levels) {
    const original = target[level].bind(target);
    target[level] = (...params: unknown[]): void => {
      original(...params);
      writer.write(level, params);
    };
  }
  return writer;
};

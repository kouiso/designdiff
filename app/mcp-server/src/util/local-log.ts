import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
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

/**
 * ファイルに残る前に token 類を伏せる。呼び出し側 (formatMcpToolError など) が
 * 伏せてくれる前提には立たない — 直接 console.error(rawError) する箇所が 1 つでも
 * 増えたら、ここが無ければ平文でディスクに残るため。
 * 形は tool/error.ts と service/github-service.ts に揃えている。
 */
const TOKEN_SHAPES = /\b(figd_|gh[opsur]_|github_pat_)[A-Za-z0-9_-]+/g;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/g;
const KEYED_SECRET =
  /\b((?:access_|refresh_|id_|api_|auth_)?token|client_secret|secret|password|api[_-]?key)(["']?\s*[:=]\s*["']?)[^\s"'&,;]+/gi;

export const scrubSecrets = (text: string): string =>
  text
    .replace(TOKEN_SHAPES, (_match, prefix: string) => `${prefix}***`)
    .replace(BEARER_TOKEN, "Bearer ***")
    .replace(KEYED_SECRET, (_match, key: string, separator: string) => `${key}${separator}***`);

const stringify = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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
  } catch {
    return;
  }
  if (size < maxBytes) return;
  renameSync(filePath, filePath.replace(/\.log$/, ".old.log"));
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
      const text = scrubSecrets(params.map(stringify).join(" "));
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

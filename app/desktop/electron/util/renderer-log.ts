import type { WebContents } from "electron";

/**
 * renderer の console を main 側のログファイルへ転送する。
 *
 * `electron-log/renderer` は使わない。preload の注入に依存せず、main 側で
 * `console-message` を受けるだけなら、renderer 側に何も足さずに済む。
 * ここは純粋関数の集まりにして、main.ts には 1 行の呼び出しだけを置く。
 */

export type RendererLogLevel = "error" | "warn" | "info" | "debug";

export interface RendererConsoleDetails {
  readonly level: string;
  readonly message: string;
  readonly sourceId: string;
  readonly lineNumber: number;
}

export interface RendererLogger {
  error(message: string): void;
  warn(message: string): void;
  info(message: string): void;
  debug(message: string): void;
}

const MAX_TEXT_LENGTH = 2048;
const MAX_PERSISTED_TEXT_LENGTH = 8192;
const TRUNCATED_SUFFIX = "…[truncated]";

/** Electron の `console-message` は "warning" を使う。不明な値は info に落とす。 */
export const toLogLevel = (level: string): RendererLogLevel => {
  switch (level) {
    case "error":
      return "error";
    case "warning":
    case "warn":
      return "warn";
    case "verbose":
    case "debug":
      return "debug";
    default:
      return "info";
  }
};

/** ファイルパスでも URL でも最後の区切り以降だけ。query / hash は落とす。 */
export const basenameOf = (source: string): string => {
  const withoutQuery = source.replace(/[?#].*$/, "");
  const segments = withoutQuery.split(/[\\/]/);
  return segments[segments.length - 1] ?? "";
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

export const redactSecrets = (text: string): string =>
  redactKeyValue(
    redactJsonSecrets(text)
      .replace(/figd_[A-Za-z0-9_-]+/gi, "figd_***")
      .replace(/\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]+\b/gi, "[REDACTED]")
      .replace(/(["']?authorization["']?\s*[:=]\s*)(?:Bearer|Basic)\s+[^\s,;}&]+/giu, "$1***")
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***"),
    SECRET_KEY_SOURCE,
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

export const sanitizeLogText = (text: string): string => {
  const sanitized = scrubPaths(redactSecrets(text));
  return sanitized.length > MAX_PERSISTED_TEXT_LENGTH
    ? `${sanitized.slice(0, MAX_PERSISTED_TEXT_LENGTH - TRUNCATED_SUFFIX.length)}${TRUNCATED_SUFFIX}`
    : sanitized;
};

export const serializeLogArgument = (value: unknown): string => {
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

export const sanitizeLogArgument = (value: unknown): string =>
  sanitizeLogText(serializeLogArgument(value));

export const formatRendererConsoleMessage = (details: RendererConsoleDetails): string => {
  const text = sanitizeLogText(
    `[renderer] ${details.message} (${basenameOf(details.sourceId)}:${details.lineNumber})`,
  );
  return text.length > MAX_TEXT_LENGTH
    ? `${text.slice(0, MAX_TEXT_LENGTH - TRUNCATED_SUFFIX.length)}${TRUNCATED_SUFFIX}`
    : text;
};

/**
 * dev でも packaged でも同じ経路で残す。以前は dev 限定で端末へ echo するだけだった
 * ので、packaged app で renderer に何が起きたかは誰にも分からなかった。
 */
export const attachRendererConsoleForwarding = (
  webContents: Pick<WebContents, "on">,
  logger: RendererLogger,
): void => {
  webContents.on("console-message", (event) => {
    logger[toLogLevel(event.level)](formatRendererConsoleMessage(event));
  });
};

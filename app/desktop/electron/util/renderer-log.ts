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

/** Electron の `console-message` は "warning" を使う。不明な値は info に落とす。 */
export const toLogLevel = (level: string): RendererLogLevel => {
  switch (level) {
    case "error":
      return "error";
    case "warning":
    case "warn":
      return "warn";
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

/** Figma の PAT と Bearer トークンはログに残さない。 */
export const redactSecrets = (text: string): string =>
  text
    .replace(/figd_[A-Za-z0-9_-]+/g, "figd_***")
    .replace(/\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]+\b/g, "[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer ***");

export const formatRendererConsoleMessage = (details: RendererConsoleDetails): string =>
  redactSecrets(
    `[renderer] ${details.message} (${basenameOf(details.sourceId)}:${details.lineNumber})`,
  );

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

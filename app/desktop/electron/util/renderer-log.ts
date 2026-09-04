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
    // Electron の console-message は最下位を "verbose" で返す。既定の file level が
    // info なので、debug に落とせば冗長な行がファイルを埋めずに済む。
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

/**
 * ログファイルに残る前の最後の砦。renderer が fetch のレスポンスや URL をそのまま
 * console に吐いた場合を想定し、トークンの形 (Figma PAT / GitHub token / Bearer) と
 * `token=` `client_secret: "..."` のような key=value の両方を伏せる。
 * mcp-server 側の `tool/error.ts` `service/github-service.ts` と同じ形を揃えている。
 */
const FIGMA_PAT = /figd_[A-Za-z0-9_-]+/g;
const GITHUB_TOKEN = /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]+\b/g;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/g;
// このリポジトリが実際に使う名前まで含める。safe-storage.ts は camelCase
// (accessToken / refreshToken / clientSecret) を使い、環境変数は
// FIGMA_OAUTH_CLIENT_SECRET のように前置きが付く。`\b` は `_` の後から始まらないので、
// 前置き (FIGMA_OAUTH_) は「英数字 + 区切り」の並びとして明示的に受ける。
// `key` だけは単独で拾わない — `{"key":"frame-1"}` のような普通のログまで伏せてしまい、
// 秘密でない行が読めなくなる。api / auth / client / secret / private / signing が
// 付いたときだけ鍵とみなす。
const SECRET_PREFIX = "(?:[A-Za-z0-9]+[_-])*";
const SECRET_KEY =
  `${SECRET_PREFIX}(?:(?:access|refresh|id|api|auth|client)[_-]?)?(?:token|secret|password|passwd)` +
  `|${SECRET_PREFIX}(?:api|auth|client|secret|private|signing)[_-]?key`;
// 引用符付きの値は閉じ引用符まで飲む。空白や `,` で止めると
// `password="correct horse battery staple"` が先頭だけ伏字になって残る。
const QUOTED_SECRET = new RegExp(
  `\\b((?:${SECRET_KEY})["']?\\s*[:=]\\s*)(["'])(?:\\\\.|[^\\\\])*?\\2`,
  "gi",
);
// 閉じ引用符が無いまま行が終わる形 (途中で切れたログなど) は行末まで伏せる。
// 閉じ引用符が「その行に無い」ことを条件にする — でないと、直前の QUOTED_SECRET が
// 伏せ終えた `password="***"` の閉じ引用符から後ろまで巻き込んで消してしまう。
const UNTERMINATED_SECRET = new RegExp(
  `\\b((?:${SECRET_KEY})["']?\\s*[:=]\\s*)(["'])(?:(?!\\2)[^\\n])*$`,
  "gim",
);
const BARE_SECRET = new RegExp(`\\b((?:${SECRET_KEY})["']?\\s*[:=]\\s*)[^\\s"'&,;]+`, "gi");
// URL の userinfo (https://alice:s3cr3t@host)。鍵の名前が付かないので上の 2 つでは拾えない。
// 利用者名が空の `https://:s3cr3t@host` も同じ形なので 0 文字以上で受ける。
// `@` の手前までを貪欲に飲むのは、パスワードに `@` が入る形 (`https://user:p@ss@host`、
// URL としては password=`p@ss`) で最初の `@` で止めると残りが平文で残るため。
// userinfo に `/` と空白は入らないので、URL の外まで食うことはない。
const URL_USERINFO = /\b([a-zA-Z][\w+.-]*:\/\/)[^/\s]*@/g;

export const redactSecrets = (text: string): string =>
  text
    .replace(FIGMA_PAT, "figd_***")
    .replace(GITHUB_TOKEN, "[REDACTED]")
    .replace(BEARER_TOKEN, "Bearer ***")
    .replace(URL_USERINFO, (_match, scheme: string) => `${scheme}***@`)
    .replace(QUOTED_SECRET, (_match, head: string, quote: string) => `${head}${quote}***${quote}`)
    .replace(UNTERMINATED_SECRET, (_match, head: string, quote: string) => `${head}${quote}***`)
    .replace(BARE_SECRET, (_match, head: string) => `${head}***`);

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

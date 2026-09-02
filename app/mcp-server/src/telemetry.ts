/**
 * MCP サーバーの opt-in テレメトリ。
 *
 * 3つの地雷を踏まない設計:
 * 1. stdout は JSON-RPC の本線。posthog-node は既定で stderr にしか吐かんが、
 *    `.debug()` を呼ぶと console.log (stdout) へ切り替わる。このファイルは
 *    絶対に `.debug()` を呼ばない。
 * 2. `set_figma_token` の引数には Figma PAT が生で通る。ここでは各 tool の
 *    引数を一切読まず、tool 名 (文字列リテラル) と所要時間と成否だけを送る。
 * 3. `shutdown()` の既定タイムアウトは30秒。必ず shutdown(2000) を渡す。
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { PostHog } from "posthog-node";
import { z } from "zod";

import { McpToolInvokedPropertiesSchema } from "@figdiff/shared";

import { getFigdiffHome } from "./util/figdiff-paths.js";

const POSTHOG_KEY = process.env.FIGDIFF_POSTHOG_KEY ?? "";

// PostHog の公式リージョンホストだけを許可する。HTTP や未知の origin を通すと、
// 同意済みイベントと API key が平文で、または関係ない宛先へ送られる恐れがある。
const ALLOWED_POSTHOG_HOSTS: string[] = ["https://us.i.posthog.com", "https://eu.i.posthog.com"];
const DEFAULT_POSTHOG_HOST = "https://eu.i.posthog.com";

const resolvePostHogHost = (raw: string | undefined): string => {
  if (!raw) return DEFAULT_POSTHOG_HOST;
  if (!ALLOWED_POSTHOG_HOSTS.includes(raw)) {
    console.error(
      `[telemetry] FIGDIFF_POSTHOG_HOST "${raw}" is not an allowlisted HTTPS origin; falling back to ${DEFAULT_POSTHOG_HOST}`,
    );
    return DEFAULT_POSTHOG_HOST;
  }
  return raw;
};

const POSTHOG_HOST = resolvePostHogHost(process.env.FIGDIFF_POSTHOG_HOST);

// installId は任意。PRIVACY.md が案内する最小の同意ファイルは { "consent": true }
// だけで、installId は初回起動時にこちら側が生成して書き戻す。ここを必須にすると
// ドキュメント通りに書いたファイルが safeParse に落ち、同意済みなのに無通信のまま
// になる (実際に起きたバグ)。
const TelemetryConfigSchema = z.object({
  consent: z.boolean(),
  installId: z.string().optional(),
});

interface TelemetryConfig {
  consent: boolean;
  installId: string;
}

const getConfigPath = (): string => join(getFigdiffHome(), "telemetry.json");

/**
 * ENOENT (ファイル未作成) だけを「未同意」として静かに扱う。EACCES や壊れた
 * JSON、schema 不一致まで同じ扱いにすると、既に同意した利用者が設定破損や
 * 権限変更に気づけないまま計測が止まり続ける。中身は出さず、失敗した事実だけ
 * stderr に記録する。
 *
 * fromDisk=false は「installId をこちらで生成した (まだファイルに書いていない
 * か、書いてある値と食い違う)」印。呼び出し側はこの時だけ書き戻しを検討する。
 */
const readConfig = (): { config: TelemetryConfig; fromDisk: boolean } => {
  try {
    const raw = readFileSync(getConfigPath(), "utf-8");
    const parsed = TelemetryConfigSchema.safeParse(JSON.parse(raw));
    if (parsed.success) {
      if (parsed.data.installId) {
        return {
          config: { consent: parsed.data.consent, installId: parsed.data.installId },
          fromDisk: true,
        };
      }
      return {
        config: { consent: parsed.data.consent, installId: randomUUID() },
        fromDisk: false,
      };
    }
    console.error("[telemetry] config failed schema validation; telemetry remains disabled");
  } catch (error: unknown) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code !== "ENOENT") {
      console.error("[telemetry] config read failed; telemetry remains disabled:", error);
    }
  }
  return { config: { consent: false, installId: randomUUID() }, fromDisk: false };
};

const writeConfig = (config: TelemetryConfig): void => {
  mkdirSync(dirname(getConfigPath()), { recursive: true });
  writeFileSync(getConfigPath(), JSON.stringify(config), "utf-8");
};

const isForcedOff = (): boolean => process.env.FIGDIFF_TELEMETRY === "0";
const isCi = (): boolean => Boolean(process.env.CI);

let client: PostHog | null = null;
let installId = "";

export const isMcpTelemetryEnabled = (): boolean => client !== null;

/** main() の起動直後に一度だけ呼ぶ。失敗しても throw しない。 */
export const initMcpTelemetry = (): void => {
  if (isForcedOff() || isCi()) return;
  if (!POSTHOG_KEY) return;
  const { config, fromDisk } = readConfig();
  if (!config.consent) return;
  if (!fromDisk) {
    try {
      writeConfig(config);
    } catch (error) {
      console.error("[telemetry] failed to persist install id (non-fatal):", error);
    }
  }
  try {
    installId = config.installId;
    client = new PostHog(POSTHOG_KEY, {
      host: POSTHOG_HOST,
      disableGeoip: true,
      flushAt: 1,
    });
  } catch (error) {
    console.error("[telemetry] init failed (non-fatal):", error);
    client = null;
  }
};

/** CLI から同意を切り替える用（現状は手動でファイル編集する運用。将来 tool 化する場合の土台）。 */
export const setMcpTelemetryConsent = (consent: boolean): void => {
  const { config } = readConfig();
  try {
    writeConfig({ ...config, consent });
  } catch (error) {
    console.error("[telemetry] failed to persist consent (non-fatal):", error);
  }
};

export const hasMcpTelemetryConfig = (): boolean => existsSync(getConfigPath());

export const trackMcpToolInvoked = (toolName: string, durationMs: number, ok: boolean): void => {
  if (!client) return;
  // MCP サーバーは長時間稼働するプロセスで、consent は init 時にしか読んでいなかった。
  // 稼働中に ~/.figdiff/telemetry.json を consent:false へ書き換えられても、client は
  // 生きたまま送信を続けてしまう (実際に指摘された)。呼び出しのたびにディスクの consent
  // を読み直し、false になっていたらここで client を止めて以後の送信を止める。
  if (!readConfig().config.consent) {
    shutdownMcpTelemetry().catch((error: unknown) => {
      console.error("[telemetry] shutdown after opt-out failed (non-fatal):", error);
    });
    return;
  }
  const properties = McpToolInvokedPropertiesSchema.safeParse({ toolName, durationMs, ok });
  if (!properties.success) {
    // toolName が MCP_TOOL_NAMES (package/shared/src/telemetry-event.ts) の許可リストに
    // 無い時にここへ落ちる。新しい tool を足してリストの更新を忘れると、その tool の
    // 計測がここで黙って消え続ける — ログだけは残す。
    console.error(
      `[telemetry] rejected mcp_tool_invoked for unknown tool "${toolName}" (not sent)`,
    );
    return;
  }
  client.capture({
    distinctId: installId,
    event: "mcp_tool_invoked",
    properties: { ...properties.data, $ip: null },
  });
};

export const shutdownMcpTelemetry = async (): Promise<void> => {
  const current = client;
  client = null;
  if (!current) return;
  await current.shutdown(2000);
};

/** resolve された tool 結果が { isError: true } を持つ失敗応答かどうかだけ見る。中身は読まない。 */
const isErrorResult = (result: unknown): boolean =>
  typeof result === "object" && result !== null && "isError" in result && result.isError === true;

/**
 * server.registerTool を Proxy でラップし、全 tool のハンドラに計測を仕込む。
 * 引数は一切読まない — tool 名・所要時間・成否だけを送る。
 *
 * T を generic にして McpServer 型そのものではなく registerTool の構造だけを
 * 要求する。テストで `as unknown as McpServer` のような型アサーションを使わず、
 * registerTool だけ持つ最小の fake server をそのまま渡せるようにするため
 * (リポジトリは `as` を禁止している)。
 *
 * 制約はメソッド構文 (`registerTool(...): unknown`) で書く。プロパティ構文の
 * 関数型 (`registerTool: (...) => unknown`) だと strictFunctionTypes の下で
 * 引数が反変チェックされ、McpServer 本体の厳密な registerTool シグネチャが
 * この緩い制約へ代入できずコンパイルが通らない。メソッド構文は双変チェックの
 * ため、実装側 (McpServer) もテストの fake server も同じ制約を満たせる。
 */
export const wrapServerToolsWithTelemetry = <
  T extends { registerTool(...args: unknown[]): unknown },
>(
  server: T,
): T => {
  return new Proxy(server, {
    get(target, prop, receiver): unknown {
      const value: unknown = Reflect.get(target, prop, receiver);
      if (prop !== "registerTool" || typeof value !== "function") {
        return typeof value === "function" ? value.bind(target) : value;
      }
      const registerTool = value;
      return (...registerArgs: unknown[]): unknown => {
        const toolName = typeof registerArgs[0] === "string" ? registerArgs[0] : "unknown_tool";
        const lastIndex = registerArgs.length - 1;
        const callback = registerArgs[lastIndex];
        if (typeof callback !== "function") {
          return Reflect.apply(registerTool, target, registerArgs);
        }
        const instrumented = async (...callbackArgs: unknown[]): Promise<unknown> => {
          const start = Date.now();
          let ok = true;
          try {
            const result: unknown = await Reflect.apply(callback, undefined, callbackArgs);
            ok = !isErrorResult(result);
            return result;
          } catch (error) {
            ok = false;
            throw error;
          } finally {
            trackMcpToolInvoked(toolName, Date.now() - start, ok);
          }
        };
        const wrappedArgs = [...registerArgs.slice(0, lastIndex), instrumented];
        return Reflect.apply(registerTool, target, wrappedArgs);
      };
    },
  });
};

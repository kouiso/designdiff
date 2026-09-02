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

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const POSTHOG_KEY = process.env.FIGDIFF_POSTHOG_KEY ?? "";
const POSTHOG_HOST = process.env.FIGDIFF_POSTHOG_HOST ?? "https://eu.i.posthog.com";

const TelemetryConfigSchema = z.object({
  consent: z.boolean(),
  installId: z.string(),
});

type TelemetryConfig = z.infer<typeof TelemetryConfigSchema>;

const getConfigPath = (): string => join(getFigdiffHome(), "telemetry.json");

const readConfig = (): TelemetryConfig => {
  try {
    const raw = readFileSync(getConfigPath(), "utf-8");
    const parsed = TelemetryConfigSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    // ファイルが無い、壊れている、権限が無い — 既定 (OFF) へフォールバック
  }
  return { consent: false, installId: "" };
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
  const config = readConfig();
  if (!config.consent) return;
  try {
    installId = config.installId || randomUUID();
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
  const config = readConfig();
  const nextInstallId = config.installId || randomUUID();
  try {
    mkdirSync(dirname(getConfigPath()), { recursive: true });
    writeFileSync(getConfigPath(), JSON.stringify({ consent, installId: nextInstallId }), "utf-8");
  } catch (error) {
    console.error("[telemetry] failed to persist consent (non-fatal):", error);
  }
};

export const hasMcpTelemetryConfig = (): boolean => existsSync(getConfigPath());

export const trackMcpToolInvoked = (toolName: string, durationMs: number, ok: boolean): void => {
  if (!client) return;
  const properties = McpToolInvokedPropertiesSchema.safeParse({ toolName, durationMs, ok });
  if (!properties.success) return;
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

/**
 * server.registerTool を Proxy でラップし、全 tool のハンドラに計測を仕込む。
 * 引数は一切読まない — tool 名・所要時間・成否だけを送る。
 */
export const wrapServerToolsWithTelemetry = (server: McpServer): McpServer => {
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
            return await Reflect.apply(callback, undefined, callbackArgs);
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

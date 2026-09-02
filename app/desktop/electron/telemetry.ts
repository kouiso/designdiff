import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { app } from "electron";
import { PostHog } from "posthog-node";
import { z } from "zod";

import {
  AppErrorCapturedPropertiesSchema,
  AppStartedPropertiesSchema,
  TelemetryEventSchema,
  type AppErrorCapturedProperties,
  type TelemetryEvent,
  type TelemetryEventName,
} from "@figdiff/shared";

declare const __POSTHOG_KEY__: string;
declare const __POSTHOG_HOST__: string;

const TelemetryConfigSchema = z.object({
  consent: z.boolean(),
  installId: z.string(),
});

type TelemetryConfig = z.infer<typeof TelemetryConfigSchema>;

const DEFAULT_CONFIG: TelemetryConfig = { consent: false, installId: "" };

let cachedConfig: TelemetryConfig | null = null;
let client: PostHog | null = null;

const getConfigPath = (): string => join(app.getPath("userData"), "telemetry-config.json");

/**
 * 設定ファイルの読み書きは絶対に throw しない。
 * whenReady().then() チェーンの中で呼んでも、テレメトリの IO 失敗が
 * アプリ起動失敗ダイアログ (main.ts の .catch) に化けないようにするため。
 *
 * ディスクに有効な設定が無かった場合は fromDisk=false を返す — 呼び出し側
 * (ensureTelemetryConfig) が「初回だから書き込みが要る」と判定するための印。
 * ここで randomUUID() を生成して返すだけで満足すると、書き込みをサボった時に
 * install id が起動のたびに変わり続けるバグになる (実際に起きた)。
 */
const readConfig = (): { config: TelemetryConfig; fromDisk: boolean } => {
  if (cachedConfig) return { config: cachedConfig, fromDisk: true };
  try {
    const raw = readFileSync(getConfigPath(), "utf-8");
    const parsed = TelemetryConfigSchema.safeParse(JSON.parse(raw));
    if (parsed.success) {
      cachedConfig = parsed.data;
      return { config: parsed.data, fromDisk: true };
    }
  } catch {
    // ファイルが無い、壊れている、権限が無い — いずれも既定値へフォールバック
  }
  const fresh: TelemetryConfig = { ...DEFAULT_CONFIG, installId: randomUUID() };
  return { config: fresh, fromDisk: false };
};

/**
 * 書き込み失敗を握りつぶさない。ここで catch すると「renderer には consent:false
 * が返るのにディスク上は前の値のまま」という表示とディスクの食い違いが起きる
 * (実際に指摘された)。呼び出し側 (ensureTelemetryConfig は try/catch 済み、
 * setTelemetryConsent は呼び出し元の IPC ハンドラまで reject を伝播させる) に
 * 判断を委ねる。
 */
const writeConfig = (config: TelemetryConfig): void => {
  mkdirSync(dirname(getConfigPath()), { recursive: true });
  writeFileSync(getConfigPath(), JSON.stringify(config), "utf-8");
  cachedConfig = config;
};

/** 起動時に一度だけ呼ぶ。install id を確定させ、設定ファイルを用意する。失敗しても起動は止めん。 */
export const ensureTelemetryConfig = (): TelemetryConfig => {
  try {
    const { config, fromDisk } = readConfig();
    if (!fromDisk) {
      writeConfig(config);
    }
    return config;
  } catch (error) {
    console.error("[telemetry] failed to initialize config (non-fatal):", error);
    return { ...DEFAULT_CONFIG, installId: randomUUID() };
  }
};

const getConfig = (): TelemetryConfig => readConfig().config;

export const getTelemetryConsent = (): boolean => getConfig().consent;

const stopClient = (): void => {
  const current = client;
  client = null;
  if (!current) return;
  current.shutdown(2000).catch((error: unknown) => {
    console.error("[telemetry] shutdown failed:", error);
  });
};

const startClient = (): void => {
  if (client) return;
  if (!__POSTHOG_KEY__) return; // キー未設定なら黙って no-op
  client = new PostHog(__POSTHOG_KEY__, {
    // __POSTHOG_HOST__ は electron.vite.config.ts のビルド時に許可済み HTTPS
    // origin へ検証済み (electron.vite.config.ts 参照)。ここでは受け取った値を
    // そのまま使ってよい。
    host: __POSTHOG_HOST__ || "https://eu.i.posthog.com",
    disableGeoip: true,
    flushAt: 1,
    // posthog-node は既定で isServer:true を付け、全イベントに $is_server:true を
    // 付与する (サーバー側計測との区別用)。デスクトップアプリは CLI/クライアント
    // 相当の実行環境なので false にし、OS 帰属が通常のクライアントと同じように
    // 効くようにする。
    isServer: false,
  });
};

export const setTelemetryConsent = (consent: boolean): void => {
  const config = getConfig();
  writeConfig({ ...config, consent });
  if (consent) {
    startClient();
  } else {
    stopClient();
  }
};

/** 起動直後、既に同意済みなら client を用意する。同意なしなら何もせん。 */
export const initTelemetryIfConsented = (): void => {
  if (getTelemetryConsent()) startClient();
};

export const trackTelemetryEvent = (event: TelemetryEvent): void => {
  if (!client) return;
  const { installId } = getConfig();
  if (!installId) return;
  client.capture({
    distinctId: installId,
    event: event.name,
    properties: {
      ...event.properties,
      $ip: null,
    },
  });
};

/** name/properties が許可リストに沿うか main 側 (信頼境界) で検証してから送る。 */
export const trackTelemetryEventUnsafe = (name: string, properties: unknown): boolean => {
  const parsed = TelemetryEventSchema.safeParse({ name, properties });
  if (!parsed.success) {
    console.error(
      `[telemetry] rejected unknown/invalid event "${name}" (validation error, not sent)`,
    );
    return false;
  }
  trackTelemetryEvent(parsed.data);
  return true;
};

const isKnownProcess = (value: AppErrorCapturedProperties["process"]): boolean =>
  value === "main" || value === "renderer";

/**
 * 例外オブジェクトそのもの (message / stack) は送らん。パスやトークンが
 * message に混じる可能性があるため、送るのは種類と致命度だけ。
 */
export const captureTelemetryException = (
  processName: AppErrorCapturedProperties["process"],
  error: unknown,
  fatal: boolean,
): void => {
  if (!isKnownProcess(processName)) return;
  const errorName = error instanceof Error ? error.name : "UnknownError";
  const properties = AppErrorCapturedPropertiesSchema.parse({
    process: processName,
    errorName,
    fatal,
  });
  trackTelemetryEvent({ name: "app_error_captured", properties });
};

/**
 * platform が既知の3値以外 (テスト環境等) なら黙ってスキップする。
 * app.getVersion() 含め、ここで何が起きても throw しない — 起動失敗ダイアログに
 * 化けさせないため (ensureTelemetryConfig と同じ設計)。
 */
export const trackAppStarted = (): void => {
  let appVersion: string;
  try {
    appVersion = app.getVersion();
  } catch (error) {
    console.error("[telemetry] failed to read app version (non-fatal):", error);
    return;
  }
  const parsed = AppStartedPropertiesSchema.safeParse({
    appVersion,
    platform: process.platform,
  });
  if (!parsed.success) return;
  trackTelemetryEvent({ name: "app_started", properties: parsed.data });
};

export const shutdownTelemetry = async (): Promise<void> => {
  const current = client;
  client = null;
  if (!current) return;
  await current.shutdown(2000);
};

export type { TelemetryConfig, TelemetryEventName };

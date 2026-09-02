// =============================================================================
// テレメトリイベントの許可リスト（型 + Zod スキーマのみ）
// =============================================================================
// このファイルはブラウザ renderer にも Node 側 (Electron main / MCP server) にも
// バンドルされる。renderer 側は file:// 起点で動くため、posthog-* を混ぜると
// 送信コード自体が renderer に紛れ込み、信頼境界 (main / MCP server) の外から
// PostHog へ直接発火できてしまう。だから送信は呼び出し側の責務とし、ここには
// 「どんな形なら送っていいか」の定義だけを置く。
//
// プロパティは「フィルタ」ではなく「ホワイトリスト」。ここに載っていない
// フィールドは追加しない。フリーテキストの string を足す前に、Figma のファイル
// キー・frame 名・ローカル絶対パス・スクリーンショット URL・認証情報が
// 混入し得ないか必ず確認する（自由文字列は事故の温床）。

import { z } from "zod";

export const TELEMETRY_EVENT_NAMES = [
  "app_started",
  "consent_changed",
  "compare_design_completed",
  "mcp_tool_invoked",
  "app_error_captured",
] as const;

export type TelemetryEventName = (typeof TELEMETRY_EVENT_NAMES)[number];

export const TelemetryEventNameSchema = z.enum(TELEMETRY_EVENT_NAMES);

// renderer プロセスからの IPC 経由で main へ届けてよいイベント名だけを列挙する。
// TelemetryEventSchema 全体は main 側の内部発火 (app_started 等) にも使い回して
// いるため、IPC の受け口をこの schema だけで守ると renderer が任意のイベント名を
// 名乗って main 発のイベントを偽装できてしまう (例: 偽の appVersion を積んだ
// app_started を送りつけ、ファイルパスやトークンを紛れ込ませる)。IPC ハンドラは
// 必ずこのリストで名前を絞ってから TelemetryEventSchema へ渡すこと。
// plain string[] にしておく。呼び出し側は `.includes(name)` で
// name: string を渡すため、`as const` タプルにすると引数の型が合わず `as` による
// アサーションが要る (このリポジトリでは禁止) ことになる。
export const RENDERER_TELEMETRY_EVENT_NAMES: string[] = ["app_error_captured"];

// --- イベントごとにプロパティのスキーマを分ける -----------------------------
// discriminated union (下部) で name と properties を一対一に固定するため。
// 1つの巨大な object にまとめると、イベント A 用のプロパティを B のイベント名で
// 送っても構文上は通ってしまい、ホワイトリストの意味が薄れる。

export const AppStartedPropertiesSchema = z.object({
  appVersion: z.string(),
  platform: z.enum(["darwin", "win32", "linux"]),
});

export const ConsentChangedPropertiesSchema = z.object({
  consent: z.boolean(),
});

export const CompareDesignCompletedPropertiesSchema = z.object({
  matchPercentage: z.number().min(0).max(100),
  durationMs: z.number().nonnegative(),
  verdict: z.enum(["pass", "fail", "inconclusive"]),
});

// MCP サーバーが実際に registerTool している tool 名の一覧。z.string() のままだと
// 任意の文字列が通ってしまい、呼び出し側の書き間違いをホワイトリストが検出できない。
export const MCP_TOOL_NAMES = [
  "list_projects",
  "create_project",
  "delete_project",
  "compare_design",
  "compare_animation",
  "inspect_node",
  "get_design_tokens",
  "list_figma_frames",
  "generate_diff_report",
  "get_crop_region",
  "set_crop_region",
  "get_ignore_regions",
  "set_ignore_regions",
  "delete_ignore_region",
  "verify_fix",
  "set_figma_token",
  "report_issue",
] as const;

export const McpToolInvokedPropertiesSchema = z.object({
  toolName: z.enum(MCP_TOOL_NAMES),
  durationMs: z.number().nonnegative(),
  ok: z.boolean(),
});

// JS の組み込み例外クラス名だけを許可する。error.name は呼び出し元 (IPC 経由の
// renderer 含む) が自由に書ける値なので、ここを z.string() のままにすると
// パス・トークンを errorName として送りつける迂回路になる。未知の値は
// catch() で "UnknownError" に落とし、リスト外の値でも送信自体は落とさない。
const KNOWN_ERROR_NAMES = [
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "EvalError",
  "URIError",
  "AggregateError",
  "UnknownError",
] as const;

export const AppErrorCapturedPropertiesSchema = z.object({
  process: z.enum(["main", "renderer"]),
  errorName: z.enum(KNOWN_ERROR_NAMES).catch("UnknownError"),
  fatal: z.boolean(),
});

// --- 全イベントの discriminated union ---------------------------------------
// name の literal 値でどの properties スキーマが対応するかを固定する。SDK を
// ここで公開しない理由は先頭コメントの通り: 送信コードは main / MCP server
// (信頼境界の内側) にだけ置き、この契約ファイルには型と検証だけを残す。

export const TelemetryEventSchema = z.discriminatedUnion("name", [
  z.object({ name: z.literal("app_started"), properties: AppStartedPropertiesSchema }),
  z.object({ name: z.literal("consent_changed"), properties: ConsentChangedPropertiesSchema }),
  z.object({
    name: z.literal("compare_design_completed"),
    properties: CompareDesignCompletedPropertiesSchema,
  }),
  z.object({ name: z.literal("mcp_tool_invoked"), properties: McpToolInvokedPropertiesSchema }),
  z.object({
    name: z.literal("app_error_captured"),
    properties: AppErrorCapturedPropertiesSchema,
  }),
]);

export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;
export type AppStartedProperties = z.infer<typeof AppStartedPropertiesSchema>;
export type ConsentChangedProperties = z.infer<typeof ConsentChangedPropertiesSchema>;
export type CompareDesignCompletedProperties = z.infer<
  typeof CompareDesignCompletedPropertiesSchema
>;
export type McpToolInvokedProperties = z.infer<typeof McpToolInvokedPropertiesSchema>;
export type AppErrorCapturedProperties = z.infer<typeof AppErrorCapturedPropertiesSchema>;

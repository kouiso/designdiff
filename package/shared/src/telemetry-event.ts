// =============================================================================
// Telemetry event allowlist (types + Zod schemas only)
// =============================================================================
// This barrel is bundled into the browser renderer as well as Node targets
// (Electron main, MCP server). It MUST NOT depend on posthog-* or any
// node-only API — it only declares what an event is allowed to look like.
// Sending events is the caller's responsibility (Electron main / MCP server).
//
// PII rule: every property list below is a WHITELIST, not a filter. Never add
// a free-text/string field without checking it cannot carry a Figma file key,
// frame name, local absolute path, screenshot URL, or credential.

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

// --- Per-event property schemas -------------------------------------------

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

export const McpToolInvokedPropertiesSchema = z.object({
  toolName: z.string(),
  durationMs: z.number().nonnegative(),
  ok: z.boolean(),
});

export const AppErrorCapturedPropertiesSchema = z.object({
  process: z.enum(["main", "renderer"]),
  errorName: z.string(),
  fatal: z.boolean(),
});

// --- Discriminated union of all telemetry events ---------------------------

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

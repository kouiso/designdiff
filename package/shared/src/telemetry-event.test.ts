import { describe, expect, it } from "vitest";

import {
  AppErrorCapturedPropertiesSchema,
  McpToolInvokedPropertiesSchema,
  TelemetryEventSchema,
} from "./telemetry-event.js";

const FAKE_FIGMA_FILE_PATH = "file:///Users/kouiso/Documents/secret-project/screenshot.png";
const FAKE_FIGMA_TOKEN = "figd_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

describe("TelemetryEventSchema — PIIホワイトリスト", () => {
  it("許可リストに無いプロパティ (ローカルパス) は黙って落ちる", () => {
    const result = TelemetryEventSchema.safeParse({
      name: "mcp_tool_invoked",
      properties: {
        toolName: "compare_design",
        durationMs: 12,
        ok: true,
        // 攻撃的な追加フィールド。許可リストに定義していない。
        implementationPath: FAKE_FIGMA_FILE_PATH,
        figmaFileKey: "abcXYZ123",
      },
    });

    expect(result.success).toBe(true);
    const serialized = JSON.stringify(result.success ? result.data : null);
    expect(serialized).not.toContain(FAKE_FIGMA_FILE_PATH);
    expect(serialized).not.toContain("abcXYZ123");
    expect(serialized).not.toContain("implementationPath");
    expect(serialized).not.toContain("figmaFileKey");
  });

  it("Figma PAT を toolName に紛れ込ませても enum で拒否される", () => {
    const result = McpToolInvokedPropertiesSchema.safeParse({
      toolName: FAKE_FIGMA_TOKEN,
      durationMs: 12,
      ok: true,
    });

    expect(result.success).toBe(false);
  });

  it("実在する MCP tool 名は許可リストの型で通る", () => {
    const result = McpToolInvokedPropertiesSchema.safeParse({
      toolName: "compare_design",
      durationMs: 12,
      ok: true,
    });

    expect(result.success).toBe(true);
    expect(Object.keys(result.success ? result.data : {})).toEqual([
      "toolName",
      "durationMs",
      "ok",
    ]);
  });

  it("app_error_captured は message/stack を運べない (errorName のみ許可)", () => {
    const result = AppErrorCapturedPropertiesSchema.safeParse({
      process: "main",
      errorName: "TypeError",
      fatal: true,
      // 実際の例外は message にパスやトークンを含みうるが、許可リストに無い
      message: `Cannot read property of ${FAKE_FIGMA_FILE_PATH}`,
      stack: `Error: ${FAKE_FIGMA_TOKEN}`,
    });

    expect(result.success).toBe(true);
    const serialized = JSON.stringify(result.success ? result.data : null);
    expect(serialized).not.toContain(FAKE_FIGMA_FILE_PATH);
    expect(serialized).not.toContain(FAKE_FIGMA_TOKEN);
    expect(serialized).not.toContain("message");
    expect(serialized).not.toContain("stack");
  });

  it("未知の errorName は UnknownError へ丸められる (IPC 経由の自由文字列対策)", () => {
    const result = AppErrorCapturedPropertiesSchema.safeParse({
      process: "renderer",
      errorName: FAKE_FIGMA_FILE_PATH,
      fatal: false,
    });

    expect(result.success).toBe(true);
    expect(result.success ? result.data.errorName : null).toBe("UnknownError");
  });

  it("未知の event 名は拒否する (許可リストの外)", () => {
    const result = TelemetryEventSchema.safeParse({
      name: "figma_file_opened",
      properties: { fileKey: "abcXYZ123" },
    });

    expect(result.success).toBe(false);
  });
});

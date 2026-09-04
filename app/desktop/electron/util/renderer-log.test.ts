import { describe, expect, it, vi } from "vitest";

import {
  attachRendererConsoleForwarding,
  basenameOf,
  formatRendererConsoleMessage,
  redactSecrets,
  toLogLevel,
} from "./renderer-log";

import type { WebContents } from "electron";

describe("toLogLevel", () => {
  it("Electron の level 名を electron-log の名前へ揃えること", () => {
    expect(toLogLevel("error")).toBe("error");
    expect(toLogLevel("warning")).toBe("warn");
    expect(toLogLevel("warn")).toBe("warn");
    expect(toLogLevel("debug")).toBe("debug");
    expect(toLogLevel("info")).toBe("info");
    // Electron は最下位を "verbose" で返す。既定の file level (info) で落ちるよう debug 扱い。
    expect(toLogLevel("verbose")).toBe("debug");
  });

  it("知らない値は info に落とすこと", () => {
    expect(toLogLevel("trace")).toBe("info");
    expect(toLogLevel("")).toBe("info");
  });
});

describe("basenameOf", () => {
  it("パスと URL のどちらでも末尾だけ返すこと", () => {
    expect(basenameOf("/Users/x/app/src/store/setting-store.ts")).toBe("setting-store.ts");
    expect(basenameOf("C:\\work\\app\\src\\a.tsx")).toBe("a.tsx");
    expect(basenameOf("http://localhost:5173/src/component/home/home-page.tsx?t=1712")).toBe(
      "home-page.tsx",
    );
    expect(basenameOf("file:///app/dist/renderer/index.html#/settings")).toBe("index.html");
  });

  it("空なら空のままにすること", () => {
    expect(basenameOf("")).toBe("");
  });
});

describe("redactSecrets", () => {
  it("Figma PAT と Bearer トークンを伏せること", () => {
    expect(redactSecrets("token figd_abc-DEF_123 saved")).toBe("token figd_*** saved");
    expect(redactSecrets("token ghp_abcdef123456 saved")).toBe("token [REDACTED] saved");
    expect(redactSecrets("Authorization: Bearer eyJ.abc-def_ghi")).toBe(
      "Authorization: Bearer ***",
    );
  });

  it("GitHub のトークンと key=value 形式も伏せること", () => {
    expect(redactSecrets("failed with ghp_AbCdEf0123456789")).toBe("failed with [REDACTED]");
    expect(redactSecrets("github_pat_11ABCDE_xyz denied")).toBe("[REDACTED] denied");
    expect(redactSecrets("GET /oauth?token=abc123&scope=file_read")).toBe(
      "GET /oauth?token=***&scope=file_read",
    );
    expect(redactSecrets('{"access_token":"abc.def","expires_in":3600}')).toBe(
      '{"access_token":"***","expires_in":3600}',
    );
    expect(redactSecrets("client_secret: s3cr3t-value")).toBe("client_secret: ***");
  });

  it("秘密が無ければ変えないこと", () => {
    expect(redactSecrets("[main] did-finish-load")).toBe("[main] did-finish-load");
    expect(redactSecrets("token refreshed successfully")).toBe("token refreshed successfully");
  });
});

describe("formatRendererConsoleMessage", () => {
  it("renderer の印と、ファイル名と行番号だけを付けること", () => {
    expect(
      formatRendererConsoleMessage({
        level: "warning",
        message: "compare failed for figd_secret",
        sourceId: "http://localhost:5173/src/store/convergence-store.ts?t=1",
        lineNumber: 42,
      }),
    ).toBe("[renderer] compare failed for figd_*** (convergence-store.ts:42)");
  });
});

describe("attachRendererConsoleForwarding", () => {
  const listen = () => {
    const on = vi.fn();
    const webContents: Pick<WebContents, "on"> = { on };
    const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    // WebContents は本物を作れない。`on` だけ持つ形で十分 — 登録以外は触らない。
    attachRendererConsoleForwarding(webContents, logger);
    const call = on.mock.calls.find(([name]) => name === "console-message");
    if (!call || typeof call[1] !== "function") throw new Error("console-message not registered");
    return { handler: call[1], logger };
  };

  it("level に応じた logger の関数へ渡すこと", () => {
    const { handler, logger } = listen();

    handler({ level: "warning", message: "slow", sourceId: "/a/b.ts", lineNumber: 1 });
    handler({ level: "error", message: "boom", sourceId: "/a/c.ts", lineNumber: 2 });
    handler({ level: "info", message: "hi", sourceId: "", lineNumber: 0 });

    expect(logger.warn).toHaveBeenCalledWith("[renderer] slow (b.ts:1)");
    expect(logger.error).toHaveBeenCalledWith("[renderer] boom (c.ts:2)");
    expect(logger.info).toHaveBeenCalledWith("[renderer] hi (:0)");
  });
});

import { describe, expect, it, vi } from "vitest";

import {
  attachRendererConsoleForwarding,
  basenameOf,
  formatRendererConsoleMessage,
  redactSecrets,
  sanitizeLogArgument,
  sanitizeLogText,
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
  });

  it("知らない値は info に落とすこと", () => {
    expect(toLogLevel("verbose")).toBe("debug");
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
    expect(redactSecrets("Authorization: Bearer eyJ.abc-def_ghi")).toBe("Authorization: ***");
    expect(redactSecrets("FIGD_SECRET X-Figma-Token=abc access_token='xyz'")).toBe(
      "figd_*** X-Figma-Token=*** access_token=***",
    );
  });

  it("JSON tokenと空白を含む各OSパスを伏せ、URLを保つこと", () => {
    const text = sanitizeLogText(
      '{"access_token":"secret value"} /Users/x/Patient Name/a.png C:\\Users\\John Doe\\b.png \\\\server\\share\\Jane Doe\\c.png https://example.test/a/b?token=figd_URL_SECRET',
    );
    expect(text).not.toMatch(/secret value|Patient Name|John Doe|Jane Doe|URL_SECRET/);
    expect(text).toContain("a.png b.png c.png");
    expect(text).toContain("https://example.test/a/b");
  });

  it("main引数向けサニタイズも8192文字を超えないこと", () => {
    expect(sanitizeLogText("x".repeat(20_000))).toHaveLength(8192);
  });

  it("escaped JSON、汎用secret、URL passwordを値全体で伏せること", () => {
    const text = sanitizeLogText(
      '{"token":"secret \\"quoted\\" tail"} api_key=generic-api refresh_token=generic-refresh client_secret=generic-client https://user:url-password@example.test/path',
    );
    expect(text).not.toMatch(/quoted|tail|generic-api|generic-refresh|generic-client|url-password/);
  });

  it("循環null-prototypeとstring化例外でもloggerを止めないこと", () => {
    const cyclic = Object.create(null) as Record<string, unknown>;
    cyclic.self = cyclic;
    const hostile = {
      toJSON: () => {
        throw new Error("json failed");
      },
      toString: () => {
        throw new Error("string failed");
      },
    };
    expect(sanitizeLogArgument(cyclic)).toBe("[unserializable]");
    expect(sanitizeLogArgument(hostile)).toBe("[unserializable]");
    expect(sanitizeLogArgument("still alive")).toBe("still alive");
  });

  it("秘密が無ければ変えないこと", () => {
    expect(redactSecrets("[main] did-finish-load")).toBe("[main] did-finish-load");
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

  it("長大な renderer 出力を上限内へ切ること", () => {
    const text = formatRendererConsoleMessage({
      level: "info",
      message: "x".repeat(5000),
      sourceId: "",
      lineNumber: 0,
    });
    expect(text).toHaveLength(2048);
    expect(text).toMatch(/\[truncated\]$/);
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

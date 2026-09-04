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

  it("引用符付きの値は閉じ引用符まで伏せること", () => {
    expect(redactSecrets('password="correct horse battery staple"')).toBe('password="***"');
    expect(redactSecrets("client_secret: 's3cr3t value here'")).toBe("client_secret: '***'");
  });

  it("閉じ引用符が無い値は行末まで伏せること", () => {
    expect(redactSecrets('password="unterminated secret here')).toBe('password="***');
    // 閉じ引用符がある行は、後ろの内容を巻き込まないこと。
    expect(redactSecrets('{"access_token":"a.b.c","expires_in":3600}')).toBe(
      '{"access_token":"***","expires_in":3600}',
    );
  });

  it("URL の userinfo も伏せること", () => {
    expect(redactSecrets("open https://alice:s3cr3t@example.com/x failed")).toBe(
      "open https://***@example.com/x failed",
    );
    // 利用者名が空の形も同じ扱い。
    expect(redactSecrets("open https://:s3cr3t@example.com/x failed")).toBe(
      "open https://***@example.com/x failed",
    );
    expect(redactSecrets("open https://example.com/x failed")).toBe(
      "open https://example.com/x failed",
    );
  });

  it("秘密が無ければ変えないこと", () => {
    expect(redactSecrets("[main] did-finish-load")).toBe("[main] did-finish-load");
    expect(redactSecrets("token refreshed successfully")).toBe("token refreshed successfully");
  });

  it("このリポジトリが実際に使う camelCase の鍵名を伏せること", () => {
    // safe-storage.ts が保存するのは accessToken / refreshToken / clientSecret。
    // snake_case だけを見ていると、この 3 つが素通りする。
    expect(redactSecrets('{"accessToken":"a.b.c","refreshToken":"d.e.f"}')).toBe(
      '{"accessToken":"***","refreshToken":"***"}',
    );
    expect(redactSecrets("clientSecret: s3cr3t-value")).toBe("clientSecret: ***");
    expect(redactSecrets("apiKey=abcdef123")).toBe("apiKey=***");
  });

  it("前置きの付いた環境変数名も伏せること", () => {
    expect(redactSecrets("FIGMA_OAUTH_CLIENT_SECRET=abc123")).toBe("FIGMA_OAUTH_CLIENT_SECRET=***");
    expect(redactSecrets("FIGDIFF_API_KEY=abc123")).toBe("FIGDIFF_API_KEY=***");
  });

  it("秘密でない `key` は伏せないこと (ログが読めなくなるため)", () => {
    expect(redactSecrets('{"key":"frame-1","name":"Hero"}')).toBe(
      '{"key":"frame-1","name":"Hero"}',
    );
    expect(redactSecrets("cache key: node-42")).toBe("cache key: node-42");
    expect(redactSecrets("keyboard shortcut registered")).toBe("keyboard shortcut registered");
    expect(redactSecrets("monkey business as usual")).toBe("monkey business as usual");
  });

  it("パスワードに @ が入った URL も userinfo 全体を伏せること", () => {
    // URL としては password=`p@ss`。最初の `@` で止めると `ss` が平文で残る。
    expect(redactSecrets("open https://user:p@ss@example.test/y failed")).toBe(
      "open https://***@example.test/y failed",
    );
    // URL の外にある `@` (メールアドレス) は触らない。
    expect(redactSecrets("mail a@b.test and https://example.test/x")).toBe(
      "mail a@b.test and https://example.test/x",
    );
    expect(redactSecrets("https://example.test/p?u=a@b.test")).toBe(
      "https://example.test/p?u=a@b.test",
    );
  });

  it("伏字は冪等であること (main.ts が引数を跨いでもう一度当てるため)", () => {
    const once = redactSecrets('{"access_token":"a.b.c"} password="hunter2"');
    expect(redactSecrets(once)).toBe(once);
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

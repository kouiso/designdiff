import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

describe("mcp-server telemetry", () => {
  let testHome: string;
  let originalFigdiffHome: string | undefined;
  let originalFigdiffTelemetry: string | undefined;
  let originalCi: string | undefined;
  let originalPosthogKey: string | undefined;

  beforeEach(async () => {
    testHome = await fs.promises.mkdtemp(path.join(os.tmpdir(), "figdiff-mcp-telemetry-"));
    originalFigdiffHome = process.env.FIGDIFF_HOME;
    originalFigdiffTelemetry = process.env.FIGDIFF_TELEMETRY;
    originalCi = process.env.CI;
    originalPosthogKey = process.env.FIGDIFF_POSTHOG_KEY;
    process.env.FIGDIFF_HOME = testHome;
    delete process.env.FIGDIFF_TELEMETRY;
    delete process.env.CI;
    vi.resetModules();
  });

  afterEach(async () => {
    if (originalFigdiffHome === undefined) delete process.env.FIGDIFF_HOME;
    else process.env.FIGDIFF_HOME = originalFigdiffHome;
    if (originalFigdiffTelemetry === undefined) delete process.env.FIGDIFF_TELEMETRY;
    else process.env.FIGDIFF_TELEMETRY = originalFigdiffTelemetry;
    if (originalCi === undefined) delete process.env.CI;
    else process.env.CI = originalCi;
    if (originalPosthogKey === undefined) delete process.env.FIGDIFF_POSTHOG_KEY;
    else process.env.FIGDIFF_POSTHOG_KEY = originalPosthogKey;
    await fs.promises.rm(testHome, { recursive: true, force: true });
  });

  const writeConsentFile = async (consent: boolean) => {
    await fs.promises.mkdir(testHome, { recursive: true });
    await fs.promises.writeFile(
      path.join(testHome, "telemetry.json"),
      JSON.stringify({ consent, installId: "test-install-id" }),
      "utf-8",
    );
  };

  it("設定ファイルが無い (既定 OFF) なら init しても無通信のままであること", async () => {
    process.env.FIGDIFF_POSTHOG_KEY = "phc_dummy_test_key";
    const { initMcpTelemetry, isMcpTelemetryEnabled } = await import("./telemetry.js");

    initMcpTelemetry();

    expect(isMcpTelemetryEnabled()).toBe(false);
  });

  it("consent:true でも POSTHOG キー未設定なら黙って無通信であること", async () => {
    await writeConsentFile(true);
    const { initMcpTelemetry, isMcpTelemetryEnabled } = await import("./telemetry.js");

    initMcpTelemetry();

    expect(isMcpTelemetryEnabled()).toBe(false);
  });

  it("consent:true かつキーありなら telemetry が有効になること", async () => {
    await writeConsentFile(true);
    process.env.FIGDIFF_POSTHOG_KEY = "phc_dummy_test_key";
    const { initMcpTelemetry, isMcpTelemetryEnabled, shutdownMcpTelemetry } = await import(
      "./telemetry.js"
    );

    initMcpTelemetry();

    expect(isMcpTelemetryEnabled()).toBe(true);
    await shutdownMcpTelemetry();
  });

  it("FIGDIFF_TELEMETRY=0 は consent:true とキーがあっても強制的に無通信にすること", async () => {
    await writeConsentFile(true);
    process.env.FIGDIFF_POSTHOG_KEY = "phc_dummy_test_key";
    process.env.FIGDIFF_TELEMETRY = "0";
    const { initMcpTelemetry, isMcpTelemetryEnabled } = await import("./telemetry.js");

    initMcpTelemetry();

    expect(isMcpTelemetryEnabled()).toBe(false);
  });

  it("CI 環境変数がある時は consent:true でも init 自体をスキップすること", async () => {
    await writeConsentFile(true);
    process.env.FIGDIFF_POSTHOG_KEY = "phc_dummy_test_key";
    process.env.CI = "true";
    const { initMcpTelemetry, isMcpTelemetryEnabled } = await import("./telemetry.js");

    initMcpTelemetry();

    expect(isMcpTelemetryEnabled()).toBe(false);
  });

  it("client が無い状態で trackMcpToolInvoked を呼んでも throw しないこと", async () => {
    const { trackMcpToolInvoked } = await import("./telemetry.js");

    expect(() => trackMcpToolInvoked("compare_design", 12, true)).not.toThrow();
  });

  it("client が無い状態で shutdownMcpTelemetry を呼んでも安全に完了すること", async () => {
    const { shutdownMcpTelemetry } = await import("./telemetry.js");

    await expect(shutdownMcpTelemetry()).resolves.toBeUndefined();
  });

  it("wrapServerToolsWithTelemetry は registerTool の引数を素通しし、handler 実行を計測すること", async () => {
    // trackMcpToolInvoked 自体は client=null なので no-op。ここではラップした handler が
    // 例外なく素通しで結果を返すことと、引数を素通しすることだけを確認する。
    const { wrapServerToolsWithTelemetry } = await import("./telemetry.js");

    const calls: unknown[][] = [];
    const fakeServer = {
      registerTool: (...args: unknown[]) => {
        calls.push(args);
        return "registered";
      },
    };
    const wrapped = wrapServerToolsWithTelemetry(fakeServer as unknown as McpServer);

    const handler = async (arg: { token: string }) => `handled:${arg.token}`;
    const result = wrapped.registerTool("set_figma_token", { description: "x" }, handler);

    expect(result).toBe("registered");
    expect(calls).toHaveLength(1);
    const [name, config, wrappedHandler] = calls[0];
    expect(name).toBe("set_figma_token");
    expect(config).toEqual({ description: "x" });
    expect(typeof wrappedHandler).toBe("function");

    const wrappedFn = wrappedHandler as (arg: { token: string }) => Promise<string>;
    // 引数 (トークンを含みうる) はハンドラへそのまま渡り、結果もそのまま返ること —
    // 計測ラッパーが引数の値を書き換えたり読み取って別処理したりしないことの確認。
    await expect(wrappedFn({ token: "figd_should_not_be_read_by_telemetry" })).resolves.toBe(
      "handled:figd_should_not_be_read_by_telemetry",
    );
  });

  it("wrapServerToolsWithTelemetry は登録した handler が例外を投げても、例外をそのまま再送出すること", async () => {
    const { wrapServerToolsWithTelemetry } = await import("./telemetry.js");
    const fakeServer = {
      registerTool: (...args: unknown[]) => args[args.length - 1],
    };
    const wrapped = wrapServerToolsWithTelemetry(fakeServer as unknown as McpServer);

    const boom = async () => {
      throw new Error("tool failed");
    };
    const wrappedHandler = wrapped.registerTool("compare_design", {}, boom) as () => Promise<void>;

    await expect(wrappedHandler()).rejects.toThrow("tool failed");
  });

  it("registerTool 以外のプロパティはそのまま透過すること", async () => {
    const { wrapServerToolsWithTelemetry } = await import("./telemetry.js");
    const fakeServer = { registerTool: vi.fn(), name: "figdiff" };
    const wrapped = wrapServerToolsWithTelemetry(fakeServer as unknown as McpServer);

    expect((wrapped as unknown as { name: string }).name).toBe("figdiff");
  });
});

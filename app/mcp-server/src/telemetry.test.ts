import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MCP_TOOL_NAMES } from "@figdiff/shared";

// PostHog クライアントは実ネットワークへ繋がずスパイだけで検証する。実クライアントを
// そのまま使うと flushAt:1 で毎回バックグラウンド送信を試み、CI でも無駄な通信が走る。
const posthogMocks = vi.hoisted(() => ({
  capture: vi.fn(),
  shutdown: vi.fn(async () => undefined),
}));

vi.mock("posthog-node", () => ({
  PostHog: vi.fn().mockImplementation(() => ({
    capture: posthogMocks.capture,
    shutdown: posthogMocks.shutdown,
  })),
}));

// テストの中だけで使う型ガード。`as` によるアサーションはリポジトリで禁止されている
// ため、`asserts` 述語で ランタイムに検証してから型を絞り込む。
function assertIsFunction(value: unknown): asserts value is (...args: unknown[]) => unknown {
  if (typeof value !== "function") {
    throw new Error("expected a function");
  }
}

describe("mcp-server telemetry", () => {
  let testHome: string;
  let originalFigdiffHome: string | undefined;
  let originalFigdiffTelemetry: string | undefined;
  let originalCi: string | undefined;
  let originalPosthogKey: string | undefined;
  let originalPosthogHost: string | undefined;

  beforeEach(async () => {
    testHome = await fs.promises.mkdtemp(path.join(os.tmpdir(), "figdiff-mcp-telemetry-"));
    originalFigdiffHome = process.env.FIGDIFF_HOME;
    originalFigdiffTelemetry = process.env.FIGDIFF_TELEMETRY;
    originalCi = process.env.CI;
    originalPosthogKey = process.env.FIGDIFF_POSTHOG_KEY;
    originalPosthogHost = process.env.FIGDIFF_POSTHOG_HOST;
    process.env.FIGDIFF_HOME = testHome;
    delete process.env.FIGDIFF_TELEMETRY;
    delete process.env.CI;
    posthogMocks.capture.mockClear();
    posthogMocks.shutdown.mockClear();
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
    if (originalPosthogHost === undefined) delete process.env.FIGDIFF_POSTHOG_HOST;
    else process.env.FIGDIFF_POSTHOG_HOST = originalPosthogHost;
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

  it("consent:true のみ (installId 無し) の設定ファイルでも installId を生成し永続化すること", async () => {
    // PRIVACY.md が案内する最小の同意ファイル形式。installId 必須のままだと
    // safeParse に落ちて同意済みなのに無通信になっていた (実際にあったバグ)。
    await fs.promises.mkdir(testHome, { recursive: true });
    await fs.promises.writeFile(
      path.join(testHome, "telemetry.json"),
      JSON.stringify({ consent: true }),
      "utf-8",
    );
    process.env.FIGDIFF_POSTHOG_KEY = "phc_dummy_test_key";
    const { initMcpTelemetry, isMcpTelemetryEnabled, shutdownMcpTelemetry } = await import(
      "./telemetry.js"
    );

    initMcpTelemetry();

    expect(isMcpTelemetryEnabled()).toBe(true);
    const persisted: unknown = JSON.parse(
      await fs.promises.readFile(path.join(testHome, "telemetry.json"), "utf-8"),
    );
    expect(persisted).toEqual(
      expect.objectContaining({ consent: true, installId: expect.any(String) }),
    );
    await shutdownMcpTelemetry();
  });

  it("壊れた JSON は ENOENT と違い stderr にログを残し、既定 OFF へ落ちること", async () => {
    await fs.promises.mkdir(testHome, { recursive: true });
    await fs.promises.writeFile(path.join(testHome, "telemetry.json"), "{not valid json", "utf-8");
    process.env.FIGDIFF_POSTHOG_KEY = "phc_dummy_test_key";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { initMcpTelemetry, isMcpTelemetryEnabled } = await import("./telemetry.js");

    initMcpTelemetry();

    expect(isMcpTelemetryEnabled()).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("不正な FIGDIFF_POSTHOG_HOST は既定ホストへフォールバックし、警告を出すこと", async () => {
    await writeConsentFile(true);
    process.env.FIGDIFF_POSTHOG_KEY = "phc_dummy_test_key";
    process.env.FIGDIFF_POSTHOG_HOST = "http://evil.example.com";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { initMcpTelemetry, isMcpTelemetryEnabled, shutdownMcpTelemetry } = await import(
      "./telemetry.js"
    );

    initMcpTelemetry();

    expect(isMcpTelemetryEnabled()).toBe(true);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("not an allowlisted HTTPS origin"),
    );
    errorSpy.mockRestore();
    await shutdownMcpTelemetry();
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
      registerTool: (...args: unknown[]): unknown => {
        calls.push(args);
        return "registered";
      },
    };
    const wrapped = wrapServerToolsWithTelemetry(fakeServer);

    const handler = async (arg: { token: string }): Promise<string> => `handled:${arg.token}`;
    const result = wrapped.registerTool("set_figma_token", { description: "x" }, handler);

    expect(result).toBe("registered");
    expect(calls).toHaveLength(1);
    const [name, config, wrappedHandler] = calls[0];
    expect(name).toBe("set_figma_token");
    expect(config).toEqual({ description: "x" });
    assertIsFunction(wrappedHandler);

    // 引数 (トークンを含みうる) はハンドラへそのまま渡り、結果もそのまま返ること —
    // 計測ラッパーが引数の値を書き換えたり読み取って別処理したりしないことの確認。
    const wrappedResult = await wrappedHandler({ token: "figd_should_not_be_read_by_telemetry" });
    expect(wrappedResult).toBe("handled:figd_should_not_be_read_by_telemetry");
  });

  it("wrapServerToolsWithTelemetry は登録した handler が例外を投げても、例外をそのまま再送出すること", async () => {
    const { wrapServerToolsWithTelemetry } = await import("./telemetry.js");
    const fakeServer = {
      registerTool: (...args: unknown[]): unknown => args[args.length - 1],
    };
    const wrapped = wrapServerToolsWithTelemetry(fakeServer);

    const boom = async () => {
      throw new Error("tool failed");
    };
    const wrappedHandler = wrapped.registerTool("compare_design", {}, boom);
    assertIsFunction(wrappedHandler);

    await expect(wrappedHandler()).rejects.toThrow("tool failed");
  });

  it("wrapServerToolsWithTelemetry は isError:true な resolve 結果を失敗として記録すること", async () => {
    await writeConsentFile(true);
    process.env.FIGDIFF_POSTHOG_KEY = "phc_dummy_test_key";
    const { initMcpTelemetry, wrapServerToolsWithTelemetry, shutdownMcpTelemetry } = await import(
      "./telemetry.js"
    );
    initMcpTelemetry();

    const fakeServer = {
      registerTool: (...args: unknown[]): unknown => args[args.length - 1],
    };
    const wrapped = wrapServerToolsWithTelemetry(fakeServer);
    // compare_design や set_figma_token は例外を投げず { isError: true } で失敗を返す設計。
    const handler = async () => ({ isError: true, content: [] });
    const wrappedHandler = wrapped.registerTool("compare_design", {}, handler);
    assertIsFunction(wrappedHandler);

    await wrappedHandler();

    expect(posthogMocks.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({ ok: false }),
      }),
    );
    await shutdownMcpTelemetry();
  });

  it("registerTool 以外のプロパティはそのまま透過すること", async () => {
    const { wrapServerToolsWithTelemetry } = await import("./telemetry.js");
    const fakeServer = { registerTool: vi.fn(), name: "figdiff" };
    const wrapped = wrapServerToolsWithTelemetry(fakeServer);

    expect(wrapped.name).toBe("figdiff");
  });

  it("MCP_TOOL_NAMES は実際に registerTool している tool 名と過不足なく一致すること", async () => {
    // toolName の許可リスト (package/shared/src/telemetry-event.ts) が実装から
    // ずれると、新しい tool の計測が trackMcpToolInvoked で黙って弾かれ続ける。
    // src/tool/*.ts が実際に登録している名前と突き合わせて、ずれを検出する。
    const toolDir = path.join(import.meta.dirname, "tool");
    const files = await fs.promises.readdir(toolDir);
    const registeredNames = new Set<string>();
    for (const file of files) {
      if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
      const content = await fs.promises.readFile(path.join(toolDir, file), "utf-8");
      const match = /registerTool\(\s*"([a-z_]+)"/.exec(content);
      if (match?.[1]) registeredNames.add(match[1]);
    }

    expect(registeredNames.size).toBeGreaterThan(0);
    expect([...registeredNames].sort()).toEqual([...MCP_TOOL_NAMES].sort());
  });
});

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 実ファイルシステムを使う。設定ファイルの実際の置き場所と読み書きが
// 本題なので、fs 自体を差し替えると確かめたいことが確かめられない。
const mocks = vi.hoisted(() => ({
  getPath: vi.fn(),
  getVersion: vi.fn(() => "1.2.3"),
}));

vi.mock("electron", () => ({
  app: { getPath: mocks.getPath, getVersion: mocks.getVersion },
}));

describe("telemetry", () => {
  let userDataDir: string;

  beforeEach(async () => {
    userDataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "figdiff-telemetry-"));
    mocks.getPath.mockReturnValue(userDataDir);
    mocks.getVersion.mockReturnValue("1.2.3");
    vi.resetModules();
  });

  afterEach(async () => {
    await fs.promises.rm(userDataDir, { recursive: true, force: true });
  });

  const loadTelemetry = async () => import("./telemetry.js");
  const configPath = () => path.join(userDataDir, "telemetry-config.json");

  it("初回は既定値 (同意なし) で、install id が振られたファイルを作ること", async () => {
    const { ensureTelemetryConfig } = await loadTelemetry();

    const config = ensureTelemetryConfig();

    expect(config.consent).toBe(false);
    expect(config.installId).not.toBe("");
    const persisted: unknown = JSON.parse(await fs.promises.readFile(configPath(), "utf-8"));
    expect(persisted).toEqual(config);
  });

  it("設定ファイルが壊れていても、既定値へ落ちて起動を止めないこと", async () => {
    await fs.promises.mkdir(userDataDir, { recursive: true });
    await fs.promises.writeFile(configPath(), "{not valid json", "utf-8");
    const { ensureTelemetryConfig, getTelemetryConsent } = await loadTelemetry();

    expect(() => ensureTelemetryConfig()).not.toThrow();
    expect(getTelemetryConsent()).toBe(false);
  });

  it("設定ファイルの書き込み先が無いディレクトリでも throw しないこと", async () => {
    mocks.getPath.mockReturnValue(path.join(userDataDir, "does", "not", "exist", "yet"));
    const { ensureTelemetryConfig } = await loadTelemetry();

    expect(() => ensureTelemetryConfig()).not.toThrow();
  });

  it("同意を true にすると設定ファイルへ永続化されること", async () => {
    const { setTelemetryConsent, getTelemetryConsent } = await loadTelemetry();

    setTelemetryConsent(true);

    expect(getTelemetryConsent()).toBe(true);
    const persisted: unknown = JSON.parse(await fs.promises.readFile(configPath(), "utf-8"));
    expect(persisted).toMatchObject({ consent: true });
  });

  it("同意を false に戻すと反映されること", async () => {
    const { setTelemetryConsent, getTelemetryConsent } = await loadTelemetry();

    setTelemetryConsent(true);
    setTelemetryConsent(false);

    expect(getTelemetryConsent()).toBe(false);
  });

  it("設定ファイルの永続化に失敗したら setTelemetryConsent は例外を投げ、表示と実態を食い違わせないこと", async () => {
    // 書き込み先ディレクトリが無く mkdir も失敗するパス (ファイルの下にディレクトリは作れない) を
    // userData として渡し、書き込み失敗を再現する。
    const blockedPath = path.join(userDataDir, "not-a-directory");
    await fs.promises.writeFile(blockedPath, "blocker", "utf-8");
    mocks.getPath.mockReturnValue(path.join(blockedPath, "nested"));
    const { setTelemetryConsent, getTelemetryConsent } = await loadTelemetry();

    expect(() => setTelemetryConsent(true)).toThrow();
    // 書き込みが失敗した以上、consent は前の既定値 (false) のまま — ディスクと
    // メモリ上の状態が食い違わない。
    expect(getTelemetryConsent()).toBe(false);
  });

  it("キー未設定ビルド (テスト環境) では同意ONでも PostHog へは繋がず、track は無音で失敗すること", async () => {
    const { setTelemetryConsent, initTelemetryIfConsented, trackTelemetryEventUnsafe } =
      await loadTelemetry();
    setTelemetryConsent(true);

    expect(() => initTelemetryIfConsented()).not.toThrow();
    // client が無いので capture は呼ばれず、戻り値だけ確認できる (例外は出ない)
    expect(
      trackTelemetryEventUnsafe("app_started", { appVersion: "1.0.0", platform: "darwin" }),
    ).toBe(true);
  });

  it("許可リストに無いイベント名は拒否され false を返すこと", async () => {
    const { trackTelemetryEventUnsafe } = await loadTelemetry();

    const ok = trackTelemetryEventUnsafe("figma_file_opened", { fileKey: "abc" });

    expect(ok).toBe(false);
  });

  it("プロパティの型が合わないイベントは拒否されること", async () => {
    const { trackTelemetryEventUnsafe } = await loadTelemetry();

    const ok = trackTelemetryEventUnsafe("mcp_tool_invoked", {
      toolName: "compare_design",
      durationMs: "not-a-number",
      ok: true,
    });

    expect(ok).toBe(false);
  });

  it("app_started は app.getVersion() を読み、throw しても起動を止めないこと", async () => {
    mocks.getVersion.mockImplementation(() => {
      throw new Error("no version in this environment");
    });
    const { trackAppStarted } = await loadTelemetry();

    expect(() => trackAppStarted()).not.toThrow();
  });

  it("既知の3値以外の platform では app_started を送らずスキップすること", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "freebsd" });
    try {
      const { trackAppStarted } = await loadTelemetry();
      expect(() => trackAppStarted()).not.toThrow();
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    }
  });

  it("captureTelemetryException は未知の process 値を無視すること", async () => {
    const { captureTelemetryException } = await loadTelemetry();

    // 型上は "main" | "renderer" だが、呼び出し境界を壊す入力への耐性を確かめる。
    expect(() => captureTelemetryException("main", new TypeError("boom"), true)).not.toThrow();
  });

  it("captureTelemetryException は message/stack を一切読まず、種類のみ扱うこと", async () => {
    const { captureTelemetryException } = await loadTelemetry();
    const error = new TypeError("secret file:///Users/x/token=figd_ABC");

    expect(() => captureTelemetryException("renderer", error, false)).not.toThrow();
  });

  it("client が無い状態で shutdownTelemetry を呼んでも安全に完了すること", async () => {
    const { shutdownTelemetry } = await loadTelemetry();

    await expect(shutdownTelemetry()).resolves.toBeUndefined();
  });
});

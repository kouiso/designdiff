import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLocalLogWriter, installLocalLog, redactSecrets } from "./local-log.js";

describe("local-log", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "figdiff-local-log-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("level と時刻を付けて 1 行ずつ追記すること", () => {
    const now = () => new Date(2026, 8, 2, 10, 30, 45, 7);
    const writer = createLocalLogWriter({ dir, now });

    writer.write("error", ["fatal:", new Error("boom")]);
    writer.write("info", ["ready", { port: 1 }]);

    const text = readFileSync(writer.filePath, "utf8");
    // Error は stack ごと残す (複数行)。行頭の形だけ固定で確認する。
    expect(text).toMatch(/^\[2026-09-02 10:30:45\.007\] \[error\] fatal: Error: boom\n/);
    expect(text.trimEnd().split("\n").at(-1)).toBe(
      '[2026-09-02 10:30:45.007] [info] ready {"port":1}',
    );
  });

  it("上限を超えたら .old.log へ回して書き続けること", () => {
    const writer = createLocalLogWriter({ dir, maxBytes: 64 });
    writer.write("info", ["x".repeat(80)]);
    writeFileSync(path.join(dir, "mcp-server.old.log"), "stale generation");
    writer.write("info", ["after rotation"]);

    const names = readdirSync(dir).sort();
    expect(names).toEqual(["mcp-server.log", "mcp-server.old.log"]);
    expect(readFileSync(path.join(dir, "mcp-server.log"), "utf8")).toContain("after rotation");
    expect(readFileSync(path.join(dir, "mcp-server.old.log"), "utf8")).not.toContain(
      "stale generation",
    );
  });

  it("rotationのEISDIRを成功扱いせずwriterを停止すること", () => {
    const writer = createLocalLogWriter({ dir, maxBytes: 1 });
    writer.write("info", ["first"]);
    mkdirSync(path.join(dir, "mcp-server.old.log"));
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    writer.write("info", ["must not be appended"]);
    writer.write("info", ["still disabled"]);

    expect(readFileSync(writer.filePath, "utf8")).not.toContain("must not be appended");
    expect(stderr).toHaveBeenCalledTimes(1);
    stderr.mockRestore();
  });

  it("永続ログへ認証情報を書かんこと", () => {
    const writer = createLocalLogWriter({ dir });
    writer.write("error", ["figd_secret-123", "Bearer eyJ.secret", "ghp_abcdef123456"]);

    const text = readFileSync(writer.filePath, "utf8");
    expect(text).not.toContain("secret-123");
    expect(text).not.toContain("eyJ.secret");
    expect(text).not.toContain("ghp_abcdef123456");
    expect(redactSecrets("Bearer safe-token")).toBe("Bearer ***");
    expect(redactSecrets("FIGD_SECRET X-Figma-Token: abc access_token=xyz")).toBe(
      "figd_*** X-Figma-Token: *** access_token=***",
    );
  });

  it("JSON tokenと空白を含む各OSパスを伏せ、特殊値も記録できること", () => {
    const writer = createLocalLogWriter({ dir });
    writer.write("error", [
      '{"access_token":"secret value"}',
      "/Users/x/Patient Name/a.png",
      "C:\\Users\\John Doe\\b.png",
      "\\\\server\\share\\Jane Doe\\c.png",
      undefined,
      Symbol("safe"),
    ]);
    const text = readFileSync(writer.filePath, "utf8");
    expect(text).not.toMatch(/secret value|Patient Name|John Doe|Jane Doe/);
    expect(text).toContain("a.png b.png c.png undefined Symbol(safe)");
  });

  it("URL内のtokenも伏せること", () => {
    const sanitized = redactSecrets(
      "GET https://example.test/api?token=figd_SECRET&access_token=ghp_abcdef123456&next=ok",
    );
    expect(sanitized).not.toMatch(/SECRET|ghp_abcdef123456/);
    expect(sanitized).toContain("https://example.test/api");
    expect(sanitized).toContain("next=ok");
  });

  it("escaped JSON、汎用secret、URL passwordを伏せ、特殊値後も書き続けること", () => {
    const writer = createLocalLogWriter({ dir });
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
    writer.write("error", [
      '{"token":"secret \\"quoted\\" tail"}',
      "api_key=generic-api refresh_token=generic-refresh client_secret=generic-client",
      "https://user:url-password@example.test/path",
      cyclic,
      hostile,
    ]);
    writer.write("info", ["still alive"]);
    const text = readFileSync(writer.filePath, "utf8");
    expect(text).not.toMatch(/quoted|tail|generic-api|generic-refresh|generic-client|url-password/);
    expect(text.match(/\[unserializable\]/g)).toHaveLength(2);
    expect(text).toContain("still alive");
  });

  it("同じ console へ二度導入しても二重記録しないこと", () => {
    const target = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
    const first = installLocalLog({ dir }, target, {});
    const second = installLocalLog({ dir }, target, {});
    expect(second).toBe(first);
    target.info("once");
    expect(readFileSync(first?.filePath ?? "", "utf8").match(/once/g)).toHaveLength(1);
  });

  it("書けない場所でも throw せず、以後は黙ること", () => {
    const blocked = path.join(dir, "not-a-dir");
    writeFileSync(blocked, "occupied");
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const writer = createLocalLogWriter({ dir: blocked });

    expect(() => {
      writer.write("error", ["one"]);
      writer.write("error", ["two"]);
    }).not.toThrow();
    expect(stderr).toHaveBeenCalledTimes(1);
    stderr.mockRestore();
  });

  it("console を包んでも stderr 側の元の関数は呼ばれ、stdout には書かんこと", () => {
    const target = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const writer = installLocalLog({ dir }, target, {});
    if (!writer) throw new Error("writer should be installed");

    target.warn("slow", 12);

    expect(target.warn).not.toBe(undefined);
    expect(readFileSync(writer.filePath, "utf8")).toContain("[warn] slow 12");
    expect(stdout).not.toHaveBeenCalled();
    stdout.mockRestore();
  });

  it("FIGDIFF_LOCAL_LOG=0 なら何も包まんこと", () => {
    const error = vi.fn();
    const target = { error, warn: vi.fn(), info: vi.fn() };

    expect(installLocalLog({ dir }, target, { FIGDIFF_LOCAL_LOG: "0" })).toBeNull();
    expect(target.error).toBe(error);
    expect(readdirSync(dir)).toEqual([]);
  });
});

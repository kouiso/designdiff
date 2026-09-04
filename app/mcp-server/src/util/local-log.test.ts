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

  it("トークンはファイルに落ちる前に伏せること", () => {
    const writer = createLocalLogWriter({ dir });

    writer.write("error", ["figma call failed with figd_abcdef0123 and ghp_ZZZ999abc"]);
    writer.write("error", ['{"access_token":"a.b.c"}']);
    writer.write("error", ["GET /x?token=abc123&scope=read"]);

    const text = readFileSync(writer.filePath, "utf8");
    expect(text).toContain("figd_***");
    expect(text).toContain("[REDACTED]");
    expect(text).toContain('"access_token":"***"');
    expect(text).toContain("token=***&scope=read");
    expect(text).not.toContain("figd_abcdef0123");
    expect(text).not.toContain("ghp_ZZZ999abc");
    expect(text).not.toContain("a.b.c");
  });

  it("引用符付きの値と URL の userinfo も伏せること", () => {
    expect(redactSecrets('password="correct horse battery staple"')).toBe('password="***"');
    expect(redactSecrets('password="unterminated secret here')).toBe('password="***');
    expect(redactSecrets("open https://:s3cr3t@example.com/x")).toBe(
      "open https://***@example.com/x",
    );
    expect(redactSecrets("open https://alice:s3cr3t@example.com/x")).toBe(
      "open https://***@example.com/x",
    );
  });

  it("回せない理由が競合以外なら握り潰さんこと", () => {
    const writer = createLocalLogWriter({ dir, maxBytes: 64 });
    writer.write("info", ["x".repeat(80)]);
    // .old.log をディレクトリにして rename を EEXIST/ENOTEMPTY で失敗させる。
    rmSync(path.join(dir, "mcp-server.old.log"), { force: true });
    mkdirSync(path.join(dir, "mcp-server.old.log"));
    mkdirSync(path.join(dir, "mcp-server.old.log", "keep"));
    writer.write("info", ["after failed rotation"]);

    // broken 扱いになるので、以後は書かない (上限を超えたまま追記し続けない)。
    const text = readFileSync(writer.filePath, "utf8");
    expect(text).not.toContain("after failed rotation");
  });

  it("秘密が無い行は素通しすること", () => {
    expect(redactSecrets("[mcp] ready on stdio")).toBe("[mcp] ready on stdio");
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

  it("永続ログへ認証情報を書かんこと", () => {
    const writer = createLocalLogWriter({ dir });
    writer.write("error", ["figd_secret-123", "Bearer eyJ.secret", "ghp_abcdef123456"]);

    const text = readFileSync(writer.filePath, "utf8");
    expect(text).not.toContain("secret-123");
    expect(text).not.toContain("eyJ.secret");
    expect(text).not.toContain("ghp_abcdef123456");
    expect(redactSecrets("Bearer safe-token")).toBe("Bearer ***");
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

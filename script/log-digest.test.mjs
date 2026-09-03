import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  classifyDevMessage,
  dedupe,
  devFileDate,
  digest,
  electronLogDir,
  formatTable,
  mcpLogDir,
  normalizeMessage,
  parseDevLine,
  parseElectronLine,
  parseSince,
  readEntries,
  stripAnsi,
  summarize,
} from "./log-digest.mjs";

const at = (h, m, s) => new Date(2026, 8, 2, h, m, s).getTime();

test("electronLogDir は OS ごとの electron-log 既定の置き場を返す", () => {
  const home = "/Users/me";
  assert.equal(
    electronLogDir("FigDiff", { platform: "darwin", home }),
    "/Users/me/Library/Logs/FigDiff",
  );
  assert.equal(
    electronLogDir("FigDiff", { platform: "linux", home }),
    "/Users/me/.config/FigDiff/logs",
  );
  assert.equal(
    electronLogDir("FigDiff", {
      platform: "win32",
      home: "C:\\Users\\me",
      env: { APPDATA: "C:\\Users\\me\\AppData\\Roaming" },
    }),
    join("C:\\Users\\me\\AppData\\Roaming", "FigDiff", "logs"),
  );
});

test("mcpLogDir は FIGDIFF_HOME を尊重する", () => {
  assert.equal(mcpLogDir({ home: "/Users/me", env: {} }), "/Users/me/.figdiff/logs");
  assert.equal(mcpLogDir({ home: "/Users/me", env: { FIGDIFF_HOME: "/tmp/fh" } }), "/tmp/fh/logs");
});

test("parseElectronLine は ms の有無どちらの format も読む (roentgen 既存 / designdiff 新)", () => {
  const withMs = parseElectronLine("[2026-09-02 10:30:45.123] [warn] [renderer] slow (a.tsx:1)");
  assert.equal(withMs.level, "warn");
  assert.equal(withMs.message, "[renderer] slow (a.tsx:1)");
  assert.equal(withMs.time, at(10, 30, 45) + 123);

  const withoutMs = parseElectronLine("[2026-09-02 10:30:45] [error] [gdrive] failed");
  assert.equal(withoutMs.level, "error");
  assert.equal(withoutMs.time, at(10, 30, 45));

  assert.equal(parseElectronLine("not a log line"), null);
});

test("parseDevLine は \\r で区切り、ANSI と turbo 接頭辞を剥がして level を付ける", () => {
  const date = { y: "2026", mo: "09", d: "02" };
  const entries = parseDevLine(
    "[10:00:01] [err] @figdiff/desktop:dev: \u001b[31m✘ [ERROR] Cannot find module\u001b[0m\rbuilding...",
    date,
  );
  assert.equal(entries.length, 2);
  assert.equal(entries[0].level, "error");
  assert.equal(entries[0].message, "✘ [ERROR] Cannot find module");
  assert.equal(entries[0].time, at(10, 0, 1));
  assert.equal(entries[1].level, "info");
  assert.equal(entries[1].message, "building...");
  assert.deepEqual(parseDevLine("garbage", date), []);
});

test("classifyDevMessage は行頭に固定し、行中の error は数えない", () => {
  assert.equal(classifyDevMessage("error TS2322: Type 'x' is not assignable"), "error");
  assert.equal(classifyDevMessage("[ERROR] boom"), "error");
  assert.equal(classifyDevMessage("Error: ENOENT"), "error");
  assert.equal(classifyDevMessage("warning: unused import"), "warn");
  assert.equal(classifyDevMessage("[WARN] slow"), "warn");
  assert.equal(classifyDevMessage("[vite] Internal server error: failed"), "error");
  assert.equal(
    classifyDevMessage("[vite] hmr update /src/component/ui/error-boundary.tsx"),
    "info",
  );
  assert.equal(classifyDevMessage("transforming error-boundary.tsx"), "info");
  assert.equal(classifyDevMessage("12:00:01 [vite] page reload"), "info");
  // Chromium / Electron 本体と pnpm の失敗行も拾う
  assert.equal(
    classifyDevMessage(
      "[0903/003025.705923:FATAL:electron_main_delegate.cc(216)] Running as root without --no-sandbox is not supported.",
    ),
    "error",
  );
  assert.equal(classifyDevMessage("[0903/003025.705923:WARNING:gpu.cc(1)] slow"), "warn");
  assert.equal(
    classifyDevMessage(
      "[26058:0903/004627.203911:ERROR:net/socket/ssl_client_socket_impl.cc:924] handshake failed",
    ),
    "error",
  );
  // Ctrl-C のたびに出る症状行。数えると毎回 ✖ になる
  assert.equal(classifyDevMessage("ELIFECYCLE  Command failed."), "info");
  assert.equal(classifyDevMessage("FATAL: out of memory"), "error");
});

test("stripAnsi / devFileDate", () => {
  assert.equal(stripAnsi("\u001b[2K\u001b[1G\u001b[33mhi\u001b[0m"), "hi");
  assert.deepEqual(devFileDate("/x/.logs/dev-20260902-103045.log"), {
    y: "2026",
    mo: "09",
    d: "02",
  });
  assert.equal(devFileDate("/x/main.log"), null);
});

test("normalizeMessage は数値・ID・パスを伏せる", () => {
  assert.equal(
    normalizeMessage("failed /Users/me/proj/a.png after 1200ms id=deadbeefcafe 0x1f"),
    "failed a.png after #ms id=# 0x#",
  );
});

test("dedupe は main.log と dev ログの同じ行を ±5 秒で 1 件に畳み、app を残す", () => {
  const entries = [
    { source: "app", time: at(10, 0, 0) + 200, level: "warn", message: "[main] slow 12ms" },
    { source: "dev", time: at(10, 0, 3), level: "warn", message: "[main] slow 12ms" },
    { source: "dev", time: at(10, 0, 9), level: "warn", message: "[main] slow 12ms" },
    { source: "dev", time: at(10, 0, 1), level: "error", message: "error TS1 x" },
  ];
  const kept = dedupe(entries);
  assert.deepEqual(
    kept.map((e) => `${e.source}:${e.level}`),
    ["app:warn", "dev:warn", "dev:error"],
  );
});

test("digest は warn/error だけを集計し、since と level で絞れる", () => {
  const entries = [
    { source: "app", time: at(9, 0, 0), level: "info", message: "boot" },
    { source: "app", time: at(9, 0, 1), level: "warn", message: "slow 10ms" },
    { source: "app", time: at(9, 30, 0), level: "warn", message: "slow 20ms" },
    { source: "mcp", time: at(9, 45, 0), level: "error", message: "fatal: boom" },
  ];
  const rows = digest(entries);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].level, "error");
  assert.equal(rows[1].count, 2);
  assert.equal(rows[1].message, "slow #ms");
  assert.equal(rows[1].sample, "slow 10ms");
  assert.equal(rows[1].first, at(9, 0, 1));
  assert.equal(rows[1].last, at(9, 30, 0));

  assert.equal(digest(entries, { since: at(9, 40, 0) }).length, 1);
  assert.equal(digest(entries, { minLevel: "error" }).length, 1);
});

test("parseSince は相対と絶対の両方", () => {
  const now = at(12, 0, 0);
  assert.equal(parseSince("30m", now), now - 30 * 60_000);
  assert.equal(parseSince("2h", now), now - 2 * 3_600_000);
  assert.equal(parseSince("1d", now), now - 86_400_000);
  assert.equal(parseSince("2026-09-02T09:00:00", now), at(9, 0, 0));
  assert.equal(parseSince("soon", now), null);
  assert.equal(parseSince(undefined, now), null);
});

test("readEntries は実ファイルから読み、summarize / formatTable が件数を出す", () => {
  const dir = mkdtempSync(join(tmpdir(), "figdiff-digest-"));
  try {
    const dev = join(dir, "dev-20260902-100000.log");
    writeFileSync(
      dev,
      [
        "[10:00:00] [out] vite ready",
        "[10:00:01] [err] error TS2322: bad type",
        "[10:00:02] [err] error TS2322: bad type",
        "[10:00:03] [out] warning: something",
        "",
      ].join("\n"),
    );
    const rows = digest(readEntries({ kind: "dev", paths: [dev] }));
    assert.equal(summarize(rows, "x.log"), "✖ warn 1 / error 2 → x.log\n");
    const table = formatTable(rows);
    assert.match(table, /^件数 \| level/);
    assert.match(
      table,
      /2 \| error \| 09-02 10:00:01 \| 09-02 10:00:02 \| dev \| error TS#: bad type/,
    );
    assert.equal(summarize([], "y"), "✓ warn 0 / error 0 → y\n");
    assert.equal(formatTable([]), "warn / error はありません。\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

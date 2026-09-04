import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  scrubPaths,
  parseDevLine,
  parseElectronLine,
  parseSince,
  readEntries,
  stripAnsi,
  summarize,
} from "./log-digest.mjs";

const withTempDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), "figdiff-digest-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

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
  // `token=` は鍵と値の形なので、値の中身に関係なく丸ごと伏せる
  // (以前は figd_ の形だけを見ていたので `token=figd_***` が残っていた)。
  assert.equal(
    normalizeMessage("Authorization: Bearer eyJ.secret token=figd_private-123 ghp_abcdef123456"),
    "Authorization: Bearer *** token=*** [REDACTED]",
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
  assert.equal(rows[1].sample, "slow #ms");
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

test("時刻が少しだけ戻っても (DST の 1 時間戻し) 日は進めない", () =>
  withTempDir((dir) => {
    const dev = join(dir, "dev-20260902-013000.log");
    writeFileSync(
      dev,
      ["[01:59:00] [err] error before", "[01:00:00] [err] error after", ""].join("\n"),
    );

    const entries = readEntries({ kind: "dev", paths: [dev] });
    assert.equal(entries.length, 2);
    assert.equal(new Date(entries[0].time).getDate(), 2);
    assert.equal(new Date(entries[1].time).getDate(), 2);
  }));

test("mcpLogDir は FIGDIFF_LOGS_DIR を優先する", () => {
  assert.equal(
    mcpLogDir({ home: "/h", env: { FIGDIFF_LOGS_DIR: "/custom/logs" } }),
    "/custom/logs",
  );
  assert.equal(mcpLogDir({ home: "/h", env: { FIGDIFF_HOME: "/fh" } }), join("/fh", "logs"));
  assert.equal(mcpLogDir({ home: "/h", env: {} }), join("/h", ".figdiff", "logs"));
});

test("classifyDevMessage は Node の警告を拾い、level 語で始まる別語は拾わない", () => {
  assert.equal(classifyDevMessage("(node:12345) Warning: something"), "warn");
  assert.equal(classifyDevMessage("(node:1) DeprecationWarning: x"), "warn");
  assert.equal(classifyDevMessage("(node:1) [DEP0040] DeprecationWarning: y"), "warn");
  assert.equal(classifyDevMessage("warning-free line"), "info");
  assert.equal(classifyDevMessage("error-boundary.tsx:1:1 compiled"), "info");
  assert.equal(classifyDevMessage("warning: real one"), "warn");
});

test("normalizeMessage は Windows のパスも basename にする", () => {
  const backslash = String.fromCharCode(92);
  assert.equal(
    normalizeMessage(`failed C:${backslash}Users${backslash}alice${backslash}secret.png`),
    "failed secret.png",
  );
  // 空白入りのディレクトリは basename まで畳み切らない。畳もうとすると、後ろに `/` を
  // 持つ普通の文章まで飲んでしまうため (下のテストを参照)。マシン固有の先頭部分
  // (`/Users/x`) は落ちるので、機種をまたいだ grouping には影響しない。
  assert.equal(normalizeMessage("failed /Users/x/My Project/a.png"), "failed My Project/a.png");
  assert.equal(scrubPaths("plain 1/2 done"), "plain 1/2 done");
});

test("scrubPaths は後ろに / を持つ普通の文章を食わない", () => {
  assert.equal(scrubPaths("see /tmp/a and/b.txt"), "see a and/b.txt");
  assert.equal(scrubPaths("error at /tmp/a while/foo failed"), "error at a while/foo failed");
});

test("readEntries は読めないファイルがあっても残りを返す", () =>
  withTempDir((dir) => {
    const good = join(dir, "dev-20260902-100000.log");
    writeFileSync(good, "[10:00:00] [err] error real one\n");
    const missing = join(dir, "dev-20260902-110000.log");
    writeFileSync(missing, "placeholder");
    // existsSync の後に消えた状態を作る: ディレクトリに置き換えると readFileSync が EISDIR。
    rmSync(missing);
    mkdirSync(missing);

    const entries = readEntries({ kind: "dev", paths: [missing, good] });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].message, "error real one");
  }));

test("normalizeMessage はルート直下のパスも basename にする", () => {
  assert.equal(normalizeMessage("failed /app and /secret.txt"), "failed app and secret.txt");
});

test("readEntries は大量の行でも RangeError にならない", () =>
  withTempDir((dir) => {
    const dev = join(dir, "dev-20260902-100000.log");
    const lines = [];
    for (let i = 0; i < 200_000; i += 1) lines.push("[10:00:00] [err] error many");
    writeFileSync(dev, `${lines.join("\n")}\n`);

    const entries = readEntries({ kind: "dev", paths: [dev] });
    assert.equal(entries.length, 200_000);
  }));

test("日をまたいだ行は、\\r で割れた断片も全部翌日になる", () =>
  withTempDir((dir) => {
    const dev = join(dir, "dev-20260902-235900.log");
    writeFileSync(
      dev,
      [
        "[23:59:59] [err] error before midnight",
        "[00:00:01] [err] error first\rerror second",
        "",
      ].join("\n"),
    );

    const entries = readEntries({ kind: "dev", paths: [dev] });
    assert.equal(entries.length, 3);
    for (const entry of entries.slice(1)) {
      assert.equal(new Date(entry.time).getDate(), 3);
    }
  }));

test("日をまたいだ dev ログは翌日として扱う", () => {
  const dir = mkdtempSync(join(tmpdir(), "figdiff-digest-"));
  try {
    const dev = join(dir, "dev-20260902-235900.log");
    writeFileSync(
      dev,
      ["[23:59:59] [err] error before midnight", "[00:00:01] [err] error after midnight", ""].join(
        "\n",
      ),
    );
    const entries = readEntries({ kind: "dev", paths: [dev] });
    assert.equal(entries.length, 2);
    assert.equal(entries[1].time - entries[0].time, 2000);
    assert.equal(new Date(entries[1].time).getDate(), 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("夜のあいだ何も出さずに走り続けた dev ログも、翌日として扱う", () =>
  withTempDir((dir) => {
    // 13:00 の次が翌 09:00。巻き戻りは 4 時間しかないので、12 時間を閾値にすると
    // 日が進まず、前の行より過去の時刻の行ができてしまう。
    const dev = join(dir, "dev-20260902-125900.log");
    writeFileSync(
      dev,
      [
        "[13:00:00] [err] error before the quiet night",
        "[09:00:00] [err] error next morning",
        "",
      ].join("\n"),
    );

    const entries = readEntries({ kind: "dev", paths: [dev] });
    assert.equal(entries.length, 2);
    assert.equal(new Date(entries[0].time).getDate(), 2);
    assert.equal(new Date(entries[1].time).getDate(), 3);
    assert.ok(entries[1].time > entries[0].time);
  }));

test("classifyDevMessage は記号で終わる level 語も拾う", () => {
  assert.equal(classifyDevMessage("ERROR! build blew up"), "error");
  assert.equal(classifyDevMessage("WARNING, deprecated option"), "warn");
  assert.equal(classifyDevMessage("FATAL. giving up"), "error");
  // 語が続くものは今まで通り拾わない。
  assert.equal(classifyDevMessage("error-boundary.tsx compiled"), "info");
  assert.equal(classifyDevMessage("errors happened later"), "info");
});

test("normalizeMessage は UNC パスも basename にする", () => {
  const normalized = normalizeMessage("read \\\\nas01\\share\\My Docs\\secret.png failed");
  // サーバー名と共有名 (マシン固有の部分) は落ちる。空白入りディレクトリは残る。
  assert.equal(normalized, "read My Docs\\secret.png failed");
});

test("mcpLogDir は環境変数の前後の空白を落としてから解決する", () => {
  // サーバー側 (figdiff-paths.ts の readEnvDir) が trim してから resolve するので、
  // ここで trim しないと書き手と読み手が別のディレクトリを指す。
  assert.equal(
    mcpLogDir({ home: "/h", env: { FIGDIFF_LOGS_DIR: " /custom/logs \n" } }),
    "/custom/logs",
  );
  assert.equal(mcpLogDir({ home: "/h", env: { FIGDIFF_HOME: "  /fh  " } }), join("/fh", "logs"));
  assert.equal(
    mcpLogDir({ home: "/h", env: { FIGDIFF_LOGS_DIR: "   " } }),
    join("/h", ".figdiff", "logs"),
  );
});

test("normalizeMessage は URL のクエリに混ざった鍵も伏せる", () => {
  // dev ログは端末出力の生写しで、書き込み時には誰も伏字にしていない。
  // ここで落とさないと digest の表と --json に鍵がそのまま出る。
  const normalized = normalizeMessage(
    "fetch failed https://api.example.com/v1/frames?api_key=SUPERSECRET123",
  );
  assert.ok(!normalized.includes("SUPERSECRET"), `鍵が残っている: ${normalized}`);
  assert.match(normalized, /api_key=\*\*\*/);
});

test("scrubPaths は URL をパスとして食わない", () => {
  // `s://host/a/b` をドライブレターのパスとして食うと、行が別物に化ける。
  assert.equal(
    scrubPaths("fetch failed https://api.example.com/v1/frames"),
    "fetch failed https://api.example.com/v1/frames",
  );
  // 通常の絶対パスは今までどおり basename にする。
  assert.equal(scrubPaths("C:\\Users\\x\\a.png missing"), "a.png missing");
});

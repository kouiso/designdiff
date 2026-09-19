// runs-manifest 生成器: driverCoverage (正本) から platform ごとの
// runs-manifest plan を吐く。/tmp/runs-*-shakedown.json の手作り copy を
// やめ、コミット可能な計画ファイルを docs/evidence/ へ置けるようにする。
//
// usage:
//   node script/generate-runs-manifest.mjs --platform linux-wsl --round 2 \
//     --evidence-root docs/evidence/round2-linux-wsl --out docs/evidence/runs-linux-wsl-r2.json
//
// 出力エントリ: { driver, evidenceDir, evidenceFile?, passEvidenceVia, requires, note? }
// executedAt/environment/buildDigest は runner が実行時に埋める。

import { basename, resolve } from "node:path";
import { writeFile } from "node:fs/promises";

import { driverCoverage } from "./campaign-case-map.mjs";

const usage = () => {
  process.stderr.write(
    [
      "usage: node script/generate-runs-manifest.mjs --platform <linux-wsl|windows|macos|repository> \\",
      "  --round <1|2> --evidence-root <dir> --out <manifest.json>",
    ].join("\n") + "\n",
  );
};

const parseArgs = (argv) => {
  const args = {};
  for (let i = 2; i < argv.length; i += 2) args[argv[i].replace(/^--/, "")] = argv[i + 1];
  return args;
};

// driver が evidence dir を受け取る経路。位置引数が既定で、
// env 変数のものだけ列挙する。
const envEvidenceVars = {
  "app/desktop/e2e/native-unmeasured-score.mjs": "FIGDIFF_SCORE_EVIDENCE",
  "app/desktop/e2e/native-ignore-region.mjs": "FIGDIFF_IGNORE_EVIDENCE",
  "app/desktop/e2e/native-figma-node-fix.mjs": "FIGDIFF_FIGMA_NODE_FIX_EVIDENCE",
  "app/desktop/e2e/native-fix-animation.mjs": "FIGDIFF_FIX_ANIMATION_EVIDENCE",
  "app/desktop/e2e/native-issue-report.mjs": "FIGDIFF_ISSUE_REPORT_EVIDENCE",
  "app/desktop/e2e/native-report-export.mjs": "FIGDIFF_REPORT_EVIDENCE",
  "app/figma-plugin/e2e/real-iframe-host.mjs": "FIGDIFF_PLUGIN_HOST_EVIDENCE",
};

// x08 系は4面分の途中証跡を同一 dir に書き、compare.mjs が読んで
// verdict と evidence.json をまとめて作る。別 dir だと compare が拾えない。
const sharedEvidenceDir = (driver, evidenceRoot) =>
  driver.startsWith("app/mcp-server/script/x08/")
    ? `${evidenceRoot}/x08`
    : `${evidenceRoot}/${basename(driver).replace(/\.mjs$/, "")}`;

// driver が書く結果ファイル名。省略時は evidence.json。
// native系は各証跡dirの manifest.json に results+revision+dirtyState を書く。
// 台帳はケース帰属を results で判定するため、これらは manifest.json を指す必要がある。
const evidenceFileFor = (driver) => {
  const x08 = /^app\/mcp-server\/script\/x08\/(mcp|desktop|extension|plugin)\.mjs$/.exec(driver);
  if (x08) return `x08-${x08[1]}.json`;
  if (driver === "app/desktop/e2e/native-unmeasured-score.mjs") return "after-native.json";
  if (
    /^app\/desktop\/e2e\/native-/.test(driver) ||
    driver === "app/figma-plugin/e2e/real-iframe-host.mjs"
  )
    return "manifest.json";
  return undefined;
};

// driver の実行前提。runner の skip 判定と operator 向けメモに使う。
const requirementsFor = (driver) => {
  const needs = [];
  if (driver.includes("desktop/e2e") || driver === "app/mcp-server/script/x08/desktop.mjs") {
    needs.push("display-or-xvfb", "electron");
  }
  if (driver === "app/mcp-server/script/stdio-real-figma-verification.mjs")
    needs.push("figma-token");
  if (driver === "app/mcp-server/script/stdio-m12-verification.mjs")
    needs.push("github-token-write");
  if (driver === "app/mcp-server/script/stdio-android-verification.mjs")
    needs.push("android-devices");
  if (driver === "app/mcp-server/script/stdio-ios-sim-verification.mjs")
    needs.push("ios-simulator");
  if (driver === "app/mcp-server/script/stdio-ios-device-verification.mjs")
    needs.push("ios-device-tethered");
  if (
    driver === "app/chrome-extension/script/real-chrome-e2e.mjs" ||
    driver === "app/mcp-server/script/x08/extension.mjs"
  ) {
    needs.push("chrome");
  }
  if (driver === "app/figma-plugin/e2e/real-iframe-host.mjs") needs.push("figma-plugin-sandbox");
  return needs;
};

const args = parseArgs(process.argv);
if (!args.platform || !args.round || !args["evidence-root"] || !args.out) {
  usage();
  process.exitCode = 2;
} else {
  const seen = new Set();
  const entries = [];
  for (const entry of driverCoverage) {
    const platforms = entry.platforms ?? ["linux-wsl", "windows", "macos"];
    if (!platforms.includes(args.platform)) continue;
    const evidenceFile = evidenceFileFor(entry.driver);
    const key = `${entry.driver}|${evidenceFile ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      driver: entry.driver,
      evidenceDir: sharedEvidenceDir(entry.driver, args["evidence-root"]),
      ...(evidenceFile ? { evidenceFile } : {}),
      passEvidenceVia: envEvidenceVars[entry.driver]
        ? `env:${envEvidenceVars[entry.driver]}`
        : "argv2",
      requires: requirementsFor(entry.driver),
      ...(entry.optional ? { optional: true } : {}),
      ...(entry.note ? { note: entry.note } : {}),
    });
  }
  // 集約 driver (x08/compare.mjs) は producer 群の後に並べる。
  entries.sort(
    (a, b) => Number(a.driver.endsWith("/compare.mjs")) - Number(b.driver.endsWith("/compare.mjs")),
  );
  const plan = {
    platform: args.platform,
    round: Number(args.round),
    // roundExecutionId は round 全体で一意であることが台帳の契約。
    // platform 毎の sweep は別々の runner で非同期に走るが同一 round の記録となる。
    roundExecutionId: `round${args.round}`,
    generatedAt: new Date().toISOString(),
    entries,
  };
  const out = resolve(args.out);
  await writeFile(out, `${JSON.stringify(plan, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ out, entries: entries.length })}\n`);
}

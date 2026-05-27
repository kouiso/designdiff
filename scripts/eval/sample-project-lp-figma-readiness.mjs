#!/usr/bin/env node
/**
 * sample-project-lp の real Figma smoke 実行前に必要条件を監査する。
 *
 * build/capture/API は呼ばず、manifest / token / LP repo の準備状態だけを
 * fail-loud に確認する。
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ARG_PREFIX_LENGTH = 2;
const ERROR_EXIT_CODE = 2;
const PLACEHOLDER_PATTERN = /REPLACE_/u;
const repoDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const options = parseArgs(process.argv.slice(ARG_PREFIX_LENGTH));
const lpRepo = resolve(requiredOption(options, "lp-repo"));
const figmaManifest = resolve(
  optionalString(
    options,
    "figma-manifest",
    join(repoDir, "verification/fixtures/sample-project-lp-figma-pages.template.json"),
  ),
);
const tokenEnv = optionalString(options, "token-env", "FIGMA_TOKEN");
const out = resolve(
  optionalString(options, "out", join(tmpdir(), "sample-project-lp-figma-readiness.md")),
);
const jsonOut = resolve(optionalString(options, "json-out", deriveJsonOutPath(out)));
const htmlOut = options["html-out"] ? resolve(optionalString(options, "html-out", "")) : null;

const checks = [];
const lpPackageJson = join(lpRepo, "package.json");
checks.push(check("LP repo package.json", existsSync(lpPackageJson), lpPackageJson));
checks.push(check("Figma manifest file", existsSync(figmaManifest), figmaManifest));
checks.push(check(`${tokenEnv} environment variable`, Boolean(process.env[tokenEnv]), tokenEnv));

let pages = [];
let manifestError = null;
let manifestRaw = null;
if (existsSync(figmaManifest)) {
  try {
    manifestRaw = await readFile(figmaManifest, "utf8");
    const manifest = JSON.parse(manifestRaw);
    pages = Array.isArray(manifest.pages) ? manifest.pages : [];
    checks.push(check("Manifest pages", pages.length > 0, `${pages.length} page(s)`));
  } catch (error) {
    manifestError = error;
    checks.push(check("Manifest JSON", false, error.message));
  }
}

const placeholderPages = pages.filter(hasPlaceholderFigmaTarget);
const invalidPages = pages.filter((page) => !hasIngestiblePageShape(page));
checks.push(
  check(
    "Ingestible page schema",
    invalidPages.length === 0,
    invalidPages.length === 0 ? "ok" : invalidPages.map(pageName).join(", "),
  ),
);
checks.push(
  check(
    "No REPLACE_* placeholders",
    placeholderPages.length === 0,
    placeholderPages.length === 0
      ? "ok"
      : placeholderPages.map((page) => page.name ?? "(unnamed)").join(", "),
  ),
);

const ready = checks.every((entry) => entry.ok) && !manifestError;
const smokeCommand = buildSmokeCommand();
const readinessCommand = buildReadinessCommand();
const nextActions = buildNextActions({ ready, checks, placeholderPages });
await writeReport({ ready, checks, placeholderPages, smokeCommand, readinessCommand, nextActions });
await writeJsonEvidence({
  ready,
  checks,
  placeholderPages,
  smokeCommand,
  manifestRaw,
  manifestPageCount: pages.length,
  pages,
});
if (htmlOut) {
  await writeHtmlReport({
    ready,
    checks,
    placeholderPages,
    smokeCommand,
    readinessCommand,
    nextActions,
  });
}

if (ready) {
  process.stdout.write(`Ready: ${out}\nEvidence JSON: ${jsonOut}\n`);
  process.exit(0);
}

process.stderr.write(`Not ready: ${out}\nEvidence JSON: ${jsonOut}\n`);
process.exit(ERROR_EXIT_CODE);

function parseArgs(args) {
  const parsed = {};
  const normalized = args[0] === "--" ? args.slice(1) : args;
  for (let index = 0; index < normalized.length; index += 1) {
    const arg = normalized[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(ARG_PREFIX_LENGTH);
    const next = normalized[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}
function requiredOption(options, key) {
  if (!options[key] || options[key] === true) {
    fail(`--${key} is required`);
  }
  return String(options[key]);
}
function optionalString(options, key, fallback) {
  if (!options[key]) {
    return fallback;
  }
  if (options[key] === true) {
    fail(`--${key} requires a value`);
  }
  return String(options[key]);
}
function check(name, ok, detail) {
  return { name, ok, detail };
}
function hasPlaceholderFigmaTarget(page) {
  if (!page || typeof page !== "object") {
    return false;
  }
  return ["figma_url", "file_key", "node_id", "figmaUrl", "fileKey", "nodeId"].some((key) =>
    PLACEHOLDER_PATTERN.test(String(page[key] ?? "")),
  );
}
function hasIngestiblePageShape(page) {
  if (!page || typeof page !== "object" || !page.name) {
    return false;
  }
  if (page.figma_url) {
    return isSupportedFigmaUrl(page.figma_url);
  }
  return Boolean(page.file_key && page.node_id);
}
function pageName(page, index) {
  if (!page || typeof page !== "object") {
    return `index-${index}`;
  }
  return String(page.name ?? `index-${index}`);
}
function isSupportedFigmaUrl(value) {
  try {
    const url = new URL(String(value));
    const [, type, fileKey] = url.pathname.split("/");
    return ["design", "file"].includes(type) && Boolean(fileKey) && url.searchParams.has("node-id");
  } catch {
    return false;
  }
}
async function writeReport({
  ready,
  checks,
  placeholderPages,
  smokeCommand,
  readinessCommand,
  nextActions,
}) {
  const lines = [
    "# sample-project-lp Figma readiness",
    "",
    `- Ready: ${ready ? "yes" : "no"}`,
    `- LP repo: ${lpRepo}`,
    `- Figma manifest: ${figmaManifest}`,
    `- Token env: ${tokenEnv}`,
    `- Evidence JSON: ${jsonOut}`,
    "",
    "| Check | OK | Detail |",
    "|---|---:|---|",
  ];
  for (const entry of checks) {
    lines.push(
      `| ${escapeTable(entry.name)} | ${entry.ok ? "yes" : "no"} | ${escapeTable(entry.detail)} |`,
    );
  }
  lines.push("", "## 1-minute demo (readiness re-run)", "", "```bash", readinessCommand, "```");
  lines.push("", "## Next command", "");
  if (ready) {
    lines.push("```bash", smokeCommand, "```");
  } else {
    for (const action of nextActions) {
      lines.push(`- ${action}`);
    }
  }
  if (placeholderPages.length > 0) {
    lines.push("", "## Placeholder pages", "");
    for (const page of placeholderPages) {
      lines.push(`- ${page.name ?? "(unnamed)"}`);
    }
  }
  lines.push("");
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${lines.join("\n")}\n`);
}
async function writeHtmlReport({
  ready,
  checks,
  placeholderPages,
  smokeCommand,
  readinessCommand,
  nextActions,
}) {
  const rows = checks
    .map(
      (entry) =>
        `<tr class="${entry.ok ? "ok" : "ng"}"><td>${escapeHtml(entry.name)}</td><td>${
          entry.ok ? "できています" : "未完了"
        }</td><td>${escapeHtml(entry.detail)}</td></tr>`,
    )
    .join("\n");
  const nextActionItems = nextActions.map((action) => `<li>${escapeHtml(action)}</li>`).join("\n");
  const placeholderItems = placeholderPages
    .map((page) => `<li>${escapeHtml(page.name ?? "(unnamed)")}</li>`)
    .join("\n");
  const html = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>sample-project-lp Figma 比較準備</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f7f7f5; color: #1f2933; }
    main { max-width: 980px; margin: 0 auto; padding: 32px 24px 48px; }
    h1 { margin: 0 0 12px; font-size: 30px; letter-spacing: 0; }
    h2 { margin-top: 28px; font-size: 20px; letter-spacing: 0; }
    .status { display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 6px; font-weight: 700; }
    .status.ready { background: #dff7ea; color: #166534; }
    .status.blocked { background: #fff1d6; color: #8a4b00; }
    .panel { background: #ffffff; border: 1px solid #d7d7d2; border-radius: 8px; padding: 20px; margin-top: 16px; }
    table { width: 100%; border-collapse: collapse; background: #ffffff; }
    th, td { border-bottom: 1px solid #e5e5df; padding: 10px 12px; text-align: left; vertical-align: top; }
    th { background: #efefea; font-size: 13px; }
    tr.ok td:nth-child(2) { color: #166534; font-weight: 700; }
    tr.ng td:nth-child(2) { color: #b45309; font-weight: 700; }
    code, pre { font-family: "SFMono-Regular", Consolas, monospace; }
    pre { overflow-x: auto; background: #1f2933; color: #f8fafc; padding: 14px; border-radius: 6px; }
    .path { overflow-wrap: anywhere; }
  </style>
</head>
<body>
  <main>
    <h1>sample-project-lp Figma 比較準備</h1>
    <div class="status ${ready ? "ready" : "blocked"}">${
      ready ? "比較を始められます" : "まだ比較を始められません"
    }</div>

    <section class="panel">
      <h2>ユーザーが今できるようになったこと</h2>
      <p>${
        ready
          ? "実デザイン画像とサイト画面の比較を始めるための準備がそろっているか、一目で確認できます。"
          : "実デザイン画像とサイト画面の比較を始める前に、何が足りないかを日本語の画面で確認できます。"
      }</p>
    </section>

    <section class="panel">
      <h2>今足りないもの</h2>
      ${nextActionItems ? `<ul>${nextActionItems}</ul>` : "<p>追加で直すものはありません。</p>"}
    </section>

    <section class="panel">
      <h2>動作確認</h2>
      <table>
        <thead><tr><th>確認項目</th><th>状態</th><th>内容</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>

    ${
      placeholderItems
        ? `<section class="panel"><h2>仮のまま残っている画面</h2><ul>${placeholderItems}</ul></section>`
        : ""
    }

    <section class="panel">
      <h2>次に実行するコマンド</h2>
      <pre>${escapeHtml(ready ? smokeCommand : readinessCommand)}</pre>
    </section>

    <section class="panel">
      <h2>保存先</h2>
      <p class="path">Markdown: ${escapeHtml(out)}</p>
      <p class="path">JSON: ${escapeHtml(jsonOut)}</p>
      <p class="path">HTML: ${escapeHtml(htmlOut)}</p>
    </section>
  </main>
</body>
</html>
`;
  await mkdir(dirname(htmlOut), { recursive: true });
  await writeFile(htmlOut, html);
}
async function writeJsonEvidence({
  ready,
  checks,
  placeholderPages,
  smokeCommand,
  manifestRaw,
  manifestPageCount,
  pages,
}) {
  const missingRequirements = checks.filter((entry) => !entry.ok).map((entry) => entry.name);
  const manifestSha256 = manifestRaw
    ? createHash("sha256").update(manifestRaw).digest("hex")
    : null;
  const expectedManifestMetadata = {
    manifestPageCount: manifestPageCount > 0,
    manifestSha256: true,
  };
  const actualManifestMetadata = {
    manifestPageCount,
    manifestSha256,
  };
  const semanticAnchors = buildSemanticAnchors(pages);
  const evidence = {
    ready,
    missingRequirements,
    placeholderPageNames: placeholderPages.map((page) => page.name ?? "(unnamed)"),
    manifestPath: figmaManifest,
    lpRepoPath: lpRepo,
    realSmokeCommand: ready ? smokeCommand : null,
    expectedPaths: { lpRepoPackageJson: join(lpRepo, "package.json"), figmaManifest },
    expectedManifestMetadata,
    actualManifestMetadata,
    semanticAnchors,
    actualPaths: {
      lpRepoPackageJsonExists: existsSync(join(lpRepo, "package.json")),
      figmaManifestExists: existsSync(figmaManifest),
      markdownReport: out,
      jsonEvidence: jsonOut,
    },
    checks,
  };
  await mkdir(dirname(jsonOut), { recursive: true });
  await writeFile(jsonOut, `${JSON.stringify(evidence, null, 2)}\n`);
}

function buildSemanticAnchors(pages) {
  const pageAnchors = pages.map((page, index) => {
    const expectedTexts = normalizeExpectedTexts(page);
    return {
      name: pageName(page, index),
      expectedTextCount: expectedTexts.length,
      expectedTexts,
    };
  });

  return {
    pageCount: pageAnchors.length,
    pagesWithExpectedTexts: pageAnchors.filter((page) => page.expectedTextCount > 0).length,
    totalExpectedTextCount: pageAnchors.reduce((total, page) => total + page.expectedTextCount, 0),
    missingExpectedTextPageNames: pageAnchors
      .filter((page) => page.expectedTextCount === 0)
      .map((page) => page.name),
    pages: pageAnchors,
  };
}

function normalizeExpectedTexts(page) {
  if (!page || typeof page !== "object") {
    return [];
  }
  const value = page.expected_texts ?? page.expectedTexts;
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => String(entry)).filter(Boolean);
}

function buildReadinessCommand() {
  const args = [
    "node",
    "scripts/eval/sample-project-lp-figma-readiness.mjs",
    "--lp-repo",
    shellQuote(lpRepo),
    "--figma-manifest",
    shellQuote(figmaManifest),
    "--token-env",
    shellQuote(tokenEnv),
    "--out",
    shellQuote(out),
    "--json-out",
    shellQuote(jsonOut),
  ];
  if (htmlOut) {
    args.push("--html-out", shellQuote(htmlOut));
  }
  return args.join(" ");
}

function buildNextActions({ ready, checks, placeholderPages }) {
  if (ready) {
    return ["このまま実デザイン画像の取得と画面比較に進めます。"];
  }
  const missingNames = new Set(checks.filter((entry) => !entry.ok).map((entry) => entry.name));
  const actions = [];
  if (missingNames.has("LP repo package.json")) {
    actions.push("sample-project-lp のフォルダを正しく指定してください。");
  }
  if (missingNames.has("Figma manifest file")) {
    actions.push("Figma の画面一覧ファイルを用意してください。");
  }
  if (missingNames.has("Manifest pages") || missingNames.has("Ingestible page schema")) {
    actions.push("画面一覧ファイルに、画面名と Figma のリンクを入れてください。");
  }
  if (placeholderPages.length > 0 || missingNames.has("No REPLACE_* placeholders")) {
    actions.push("仮の Figma 値を、実際の Figma ファイルと画面 ID に置き換えてください。");
  }
  if (missingNames.has(`${tokenEnv} environment variable`)) {
    actions.push(`${tokenEnv} を環境変数に入れてください。値はリポジトリに保存しないでください。`);
  }
  if (actions.length === 0) {
    actions.push("未完了の確認項目を直して、もう一度 readiness を実行してください。");
  }
  return actions;
}

function buildSmokeCommand() {
  return `pnpm eval:sample-project-lp-figma -- --lp-repo ${shellQuote(lpRepo)} --figma-manifest ${shellQuote(figmaManifest)} --out ${shellQuote(join(tmpdir(), "sample-project-lp-figma-smoke"))} --real --token-env ${shellQuote(tokenEnv)}`;
}
function deriveJsonOutPath(markdownOutPath) {
  return markdownOutPath.endsWith(".md")
    ? `${markdownOutPath.slice(0, -3)}.json`
    : `${markdownOutPath}.json`;
}
function escapeTable(value) {
  return String(value).replaceAll("|", "\\|");
}
function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
function shellQuote(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(ERROR_EXIT_CODE);
}

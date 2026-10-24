#!/usr/bin/env node
// Enforce repo naming rules on tracked files:
//   - file names: lowercase kebab-case (rule #7 — no PascalCase file names)
//   - folder names: lowercase kebab-case, with curated known plural → singular mappings
// English meaning and domain cohesion still require review. See doc/dev-guide.md#命名規約.
// Tool-convention paths/names are exempt (see allow/deny lists below).
// Runs on `git ls-files`; exits non-zero with a per-violation message.
import { execFileSync } from "node:child_process";

// 生成元が名前を決める領域だけを除外する。vendor という名前だけでは除外しない。
const GENERATED_PREFIXES = ["app/desktop/src-tauri/gen/"];
// 同梱した外部 skill の参照名。自作ソースには適用しない。
const VENDORED_FILES = new Set([".claude/skills/frontend-slides/STYLE_PRESETS.md"]);
// ツールの予約ディレクトリと、参照を維持する既存文書の置き場。
// ディレクトリ自身だけが例外。配下のファイル・ディレクトリは引き続き検査する。
const DIRECTORY_EXCEPTIONS = new Map([
  [".github/ISSUE_TEMPLATE", "GitHub issue template discovery"],
  [".github/workflows", "GitHub Actions discovery"],
  [".github/scripts", "existing workflow script paths"],
  [".github/instructions", "Copilot instruction discovery"],
  [".claude/agents", "Claude agent discovery"],
  [".claude/commands", "Claude command discovery"],
  [".claude/skills", "Claude skill discovery"],
  [".claude/hooks", "existing harness hook paths"],
  [".claude/contexts", "bundled harness context paths"],
  [".claude/plans", "existing harness plan paths"],
  [".claude/rules", "Claude rule discovery"],
  ["docs", "existing specifications and evidence links; migration requires a separate audit"],
  ["logs", "historical session log storage"],
  ["docs/evidence/residual-parity-359/logs", "committed evidence paths referenced by the report"],
]);

// Uppercase / non-kebab basenames that are established tool conventions.
const EXEMPT_BASENAMES = new Set([
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  "SECURITY.md",
  "TODO.md",
  "AGENTS.md",
  "CLAUDE.md",
  "CODEOWNERS",
  "Taskfile.yml",
  "Dockerfile",
  "SKILL.md",
]);

// 既知の複数形だけを登録する。末尾の s から英語の単複を推測しない。
const PLURAL_DIRS = new Map([
  ["scripts", "script"],
  ["commands", "command"],
  ["contexts", "context"],
  ["fixtures", "fixture"],
  ["receipts", "receipt"],
  ["attempts", "attempt"],
  ["screenshots", "screenshot"],
  ["components", "component"],
  ["utils", "util"],
  ["helpers", "helper"],
  ["services", "service"],
  ["models", "model"],
  ["controllers", "controller"],
  ["pages", "page"],
  ["hooks", "hook"],
  ["types", "type"],
  ["interfaces", "interface"],
  ["constants", "constant"],
  ["configs", "config"],
  ["tests", "test"],
  ["specs", "spec"],
  ["styles", "style"],
  ["assets", "asset"],
  ["images", "image"],
  ["icons", "icon"],
  ["libs", "lib"],
  ["modules", "module"],
  ["features", "feature"],
  ["layouts", "layout"],
  ["containers", "container"],
  ["views", "view"],
  ["routes", "route"],
  ["stores", "store"],
  ["actions", "action"],
  ["reducers", "reducer"],
  ["selectors", "selector"],
  ["providers", "provider"],
  ["middlewares", "middleware"],
  ["plugins", "plugin"],
  ["extensions", "extension"],
  ["packages", "package"],
  ["apps", "app"],
  ["signals", "signal"],
  ["tools", "tool"],
  ["docs", "doc"],
  ["logs", "log"],
  ["agents", "agent"],
  ["plans", "plan"],
  ["rules", "rule"],
  ["instructions", "instruction"],
]);

// kebab-case filename: lowercase alnum segments joined by "-", with any number
// of dot-separated extension-ish parts (allows .test., .d.ts, multi-dot names).
const KEBAB_FILE = /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)*$/;
// kebab-case dir, or the __x__ testing convention (e.g. __mock__).
const KEBAB_DIR = /^([a-z0-9]+(-[a-z0-9]+)*|__[a-z0-9]+__)$/;
// セッションログは日時を ISO 8601 の T 区切りで記録する既存の永続形式。
const HISTORICAL_SESSION_LOG =
  /^logs\/\d{4}\/\d{2}\/\d{4}-\d{2}-\d{2}T\d{4}(?:--[a-z0-9]+(?:-[a-z0-9]+)*){3}--[a-f0-9]{8}\.md$/;

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const violations = [];
for (const file of files) {
  if (GENERATED_PREFIXES.some((prefix) => file.startsWith(prefix))) continue;
  if (VENDORED_FILES.has(file)) continue;
  if (HISTORICAL_SESSION_LOG.test(file)) continue;

  const parts = file.split("/");
  const base = parts.pop();

  for (const [index, seg] of parts.entries()) {
    if (DIRECTORY_EXCEPTIONS.has(parts.slice(0, index + 1).join("/"))) continue;
    if (PLURAL_DIRS.has(seg)) {
      violations.push(`${file}: known plural folder "${seg}/" — use "${PLURAL_DIRS.get(seg)}/"`);
    } else if (!KEBAB_DIR.test(seg.startsWith(".") ? seg.slice(1) : seg)) {
      violations.push(
        `${file}: folder "${seg}/" is not lowercase kebab-case — rename the folder and its references`,
      );
    }
  }

  if (EXEMPT_BASENAMES.has(base)) continue;
  if (!KEBAB_FILE.test(base.startsWith(".") ? base.slice(1) : base)) {
    violations.push(
      `${file}: file "${base}" is not kebab-case — use lowercase names for the stem and every dot-separated role`,
    );
  }
}

const unique = [...new Set(violations)];
if (unique.length > 0) {
  console.error("Naming violations found:\n");
  for (const v of unique) console.error(`  ${v}`);
  console.error(
    `\n${unique.length} violation(s). Rules: kebab-case file names (#7), ` +
      "singular folders (#6). Add legitimate tool-convention exceptions to " +
      "script/check-naming.mjs.",
  );
  process.exit(1);
}
console.info(`Naming check passed: ${files.length} tracked files.`);

#!/usr/bin/env node
// Enforce repo naming rules on tracked files:
//   - file names: lowercase kebab-case (rule #7 — no PascalCase file names)
//   - folder names: singular, kebab-case (rule #6 — no plural folder names)
// Tool-convention paths/names are exempt (see allow/deny lists below).
// Runs on `git ls-files`; exits non-zero with a per-violation message.
import { execSync } from "node:child_process";

// Path prefixes fully exempt from ALL naming checks (harness / tooling dirs
// whose layout is dictated by the tool, not by us).
const EXEMPT_PREFIXES = [".github/", ".claude/", ".gemini/", ".agents/", ".vscode/", ".idea/"];

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

// Directory segments explicitly banned as plural (rule #6). Curated and
// extensible: add a word here when a new plural folder name slips in.
const PLURAL_DIRS = new Set([
  "scripts",
  "commands",
  "contexts",
  "fixtures",
  "receipts",
  "attempts",
  "screenshots",
  "components",
  "utils",
  "helpers",
  "services",
  "models",
  "controllers",
  "pages",
  "hooks",
  "types",
  "interfaces",
  "constants",
  "configs",
  "tests",
  "specs",
  "styles",
  "assets",
  "images",
  "icons",
  "libs",
  "modules",
  "features",
  "layouts",
  "containers",
  "views",
  "routes",
  "stores",
  "actions",
  "reducers",
  "selectors",
  "providers",
  "middlewares",
  "plugins",
  "extensions",
  "packages",
  "apps",
  "signals",
  "tools",
]);

// kebab-case filename: lowercase alnum segments joined by "-", with any number
// of dot-separated extension-ish parts (allows .test., .d.ts, multi-dot names).
const KEBAB_FILE = /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)*$/;
// kebab-case dir, or the __x__ testing convention (e.g. __mock__).
const KEBAB_DIR = /^([a-z0-9]+(-[a-z0-9]+)*|__[a-z0-9]+__)$/;

const files = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);

const violations = [];
for (const file of files) {
  if (EXEMPT_PREFIXES.some((p) => file.startsWith(p))) continue;

  const parts = file.split("/");
  const base = parts.pop();

  for (const seg of parts) {
    // Dotted tool-config dirs (e.g. .serena) follow their own conventions.
    if (seg.startsWith(".")) continue;
    if (PLURAL_DIRS.has(seg)) {
      violations.push(`${file}: plural folder "${seg}/" — use singular`);
    } else if (!KEBAB_DIR.test(seg)) {
      violations.push(`${file}: folder "${seg}/" is not kebab-case`);
    }
  }

  if (EXEMPT_BASENAMES.has(base)) continue;
  if (base.startsWith(".")) continue; // dotfiles (.gitignore, .mise.toml, ...)
  if (!KEBAB_FILE.test(base)) {
    violations.push(`${file}: file "${base}" is not kebab-case`);
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

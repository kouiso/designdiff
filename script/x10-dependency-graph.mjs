// X10: 依存グラフの静的検査。
// - コア層 (shared / credential-store / mobile-capture) が app/* へ依存しない
// - 全パッケージの @figdiff 依存が宣言どおり
// - pixelmatch 直接利用が package/shared に限定される
//   (chrome-extension は scope 制約で pixelmatch を持てず、YIQ 移植版を
//    pixel-diff-service.ts に持つ — これは意図した機能差として証跡に記録する)
// - コア層に UI 層 / AI 層の都合 (electron, playwright, MCP SDK, DOM) が
//   持ち込まれていない

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const evidenceDir = process.argv[2] ? resolve(process.argv[2]) : undefined;

const PACKAGES = [
  "package/shared",
  "package/credential-store",
  "package/mobile-capture",
  "app/desktop",
  "app/chrome-extension",
  "app/figma-plugin",
  "app/mcp-server",
];
const CORE = new Set([
  "@figdiff/shared",
  "@figdiff/credential-store",
  "@figdiff/mobile-capture",
]);
const CORE_DIRS = ["package/shared", "package/credential-store", "package/mobile-capture"];
const APP_PACKAGES = new Set([
  "@figdiff/desktop",
  "@figdiff/chrome-extension",
  "@figdiff/figma-plugin",
  "@figdiff/mcp-server",
]);

const walk = async (dir, out = []) => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(p)));
    else if (/\.(ts|tsx|mts)$/.test(entry.name) && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".test.tsx")) {
      out.push(p);
    }
  }
  return out;
};

const importsOf = (source) => {
  const found = [];
  for (const m of source.matchAll(/from\s+["']([^"']+)["']|import\s+["']([^"']+)["']/g)) {
    found.push(m[1] ?? m[2]);
  }
  return found;
};

const results = {};

// 1. パッケージ宣言レベルの依存方向
{
  const violations = [];
  const graph = {};
  for (const pkg of PACKAGES) {
    const json = JSON.parse(await readFile(join(root, pkg, "package.json"), "utf8"));
    const figDeps = Object.keys(json.dependencies ?? {}).filter((d) => d.startsWith("@figdiff/"));
    graph[json.name] = figDeps;
    if (CORE.has(json.name)) {
      for (const dep of figDeps) {
        if (!CORE.has(dep)) violations.push(`${json.name} depends on non-core ${dep}`);
      }
    }
  }
  results.packageDeps = graph;
  assert.equal(violations.length, 0, violations.join("; "));
}

// 2. ソースレベルの逆依存: コア層が app 層を import しない
{
  const violations = [];
  for (const dir of CORE_DIRS) {
    for (const file of await walk(join(root, dir, "src"))) {
      const src = await readFile(file, "utf8");
      for (const imp of importsOf(src)) {
        if ([...APP_PACKAGES].some((a) => imp.startsWith(a)) || imp.includes("/app/")) {
          violations.push(`${relative(root, file)} imports ${imp}`);
        }
      }
    }
  }
  assert.equal(violations.length, 0, violations.join("; "));
  results.coreToAppImports = "none";
}

// 3. pixelmatch 直接利用の所在
{
  const users = [];
  for (const pkg of PACKAGES) {
    for (const file of await walk(join(root, pkg, "src"))) {
      const src = await readFile(file, "utf8");
      if (/from\s+["']pixelmatch["']|import\s+pixelmatch|require\(["']pixelmatch/.test(src)) {
        users.push(relative(root, file));
      }
    }
  }
  // pixelmatch の直接 import は shared だけ。chrome-extension は vendored port。
  const outside = users.filter((f) => !f.startsWith("package/shared/"));
  assert.equal(outside.length, 0, `pixelmatch imported outside shared: ${outside.join(", ")}`);
  results.pixelmatchImporters = users;
}

// 4. コア層への UI/AI 都合の混入
{
  // Figma API の document フィールドと区別するため DOM アクセス形だけを見る。
  const banned = /electron|playwright|@modelcontextprotocol|document\.(?:createElement|getElementById|querySelector|body|title)|OffscreenCanvas|chrome\.(?:runtime|tabs|storage)/;
  const violations = [];
  for (const dir of CORE_DIRS) {
    for (const file of await walk(join(root, dir, "src"))) {
      const src = await readFile(file, "utf8");
      const m = src.match(banned);
      if (m) violations.push(`${relative(root, file)}: ${m[0]}`);
    }
  }
  results.coreBannedRefs = violations;
  assert.equal(violations.length, 0, violations.join("; "));
}

// 5. 意図した機能差の記録: extension の pixelmatch 移植が唯一の複製であること
{
  const extSrc = await readFile(
    join(root, "app/chrome-extension/src/service/pixel-diff-service.ts"),
    "utf8",
  );
  assert.ok(
    extSrc.includes("pixelmatch") && extSrc.includes("移植"),
    "extension pixel-diff-service must remain the documented port",
  );
  results.documentedDifference =
    "chrome-extension vendors a pixelmatch-compatible YIQ diff (no pixelmatch dep allowed in extension scope)";
}

results.ok = true;
if (evidenceDir) {
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(join(evidenceDir, "x10-dependency-graph.json"), `${JSON.stringify(results, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify({ ok: true, checks: Object.keys(results).length })}\n`);

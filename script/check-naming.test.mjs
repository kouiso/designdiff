import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checker = join(repository, "script/check-naming.mjs");

const createFixture = async () => {
  const fixture = await mkdtemp(join(tmpdir(), "figdiff-naming-"));
  execFileSync("git", ["init", "--quiet"], { cwd: fixture });
  return fixture;
};

const track = async (fixture, path) => {
  const target = join(fixture, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, "fixture\n");
  execFileSync("git", ["add", "--", path], { cwd: fixture });
};

test("accepts the established ISO-dated historical session log path", async (context) => {
  const fixture = await createFixture();
  context.after(() => rm(fixture, { recursive: true, force: true }));
  await track(fixture, "logs/2026/09/2026-09-11T1413--mini--cx--designdiff--ddeedf68.md");

  const result = spawnSync(process.execPath, [checker], { cwd: fixture, encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr);
});

test("continues to reject uppercase names outside the historical session log convention", async (context) => {
  const fixture = await createFixture();
  context.after(() => rm(fixture, { recursive: true, force: true }));
  await track(fixture, "src/BadName.ts");
  await track(fixture, "logs/2026/09/2026-09-11T1413--mini--ddeedf68.md");

  const result = spawnSync(process.execPath, [checker], { cwd: fixture, encoding: "utf8" });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /src\/BadName\.ts: file "BadName\.ts" is not kebab-case/);
  assert.match(result.stderr, /2026-09-11T1413--mini--ddeedf68\.md.*is not kebab-case/);
});

const checkPaths = async (context, paths) => {
  const fixture = await createFixture();
  context.after(() => rm(fixture, { recursive: true, force: true }));
  for (const path of paths) await track(fixture, path);
  return spawnSync(process.execPath, [checker], { cwd: fixture, encoding: "utf8" });
};

test("accepts role suffixes, test suffixes, and singular words ending in s", async (context) => {
  const result = await checkPaths(context, [
    "horse/horse.icon.tsx",
    "horse/horse-card.test.tsx",
    "lens/status.ts",
    "analysis/diagnosis.ts",
    "README.md",
    "src/env.d.ts",
    "vite.web.config.ts",
  ]);
  assert.equal(result.status, 0, result.stderr);
});

test("rejects uppercase and empty role parts, uppercase directories, and known plurals", async (context) => {
  const result = await checkPaths(context, [
    "src/Horse.icon.tsx",
    "src/horse.Icon.tsx",
    "src/horse..icon.tsx",
    "Horse/horse.ts",
    ".Horse/horse.ts",
    "components/horse.tsx",
    "docs/components/horse.tsx",
  ]);
  assert.equal(result.status, 1);
  for (const path of ["Horse.icon.tsx", "horse.Icon.tsx", "horse..icon.tsx", "Horse/horse.ts"])
    assert.ok(result.stderr.includes(path), path);
  assert.match(result.stderr, /components\/horse.tsx.*use "component\/"/);
  assert.match(result.stderr, /docs\/components\/horse.tsx.*use "component\/"/);
});

test("limits convention, generated and vendored exceptions to their recorded paths", async (context) => {
  const result = await checkPaths(context, [
    ".github/workflows/build.yml",
    ".github/scripts/check.mjs",
    ".github/ISSUE_TEMPLATE/bugfix.yml",
    ".claude/skills/horse/SKILL.md",
    ".claude/skills/frontend-slides/STYLE_PRESETS.md",
    "app/desktop/src-tauri/gen/GeneratedType.ts",
    ".storybook/main.ts",
    "docs/evidence/residual-parity-359/logs/classify-9789-glyph.log",
  ]);
  assert.equal(result.status, 0, result.stderr);

  const invalid = await checkPaths(context, [
    ".github/scripts/Horse.ts",
    ".storybook/Horse.ts",
    "vendor/Horse.ts",
    "src/generated/Horse.ts",
    ".claude/skills/horse/Horse.ts",
    "app/desktop/src-tauri/GeneratedType.ts",
  ]);
  assert.equal(invalid.status, 1);
  for (const path of [
    ".github/scripts/Horse.ts",
    ".storybook/Horse.ts",
    "vendor/Horse.ts",
    "src/generated/Horse.ts",
    ".claude/skills/horse/Horse.ts",
    "app/desktop/src-tauri/GeneratedType.ts",
  ])
    assert.ok(invalid.stderr.includes(path), path);
});

test("does not assume file-based routing or exempt arbitrary route directories", async (context) => {
  const result = await checkPaths(context, ["routes/[horse-id]/page.tsx"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /use "route\/"/);
  // この repo は file-based router を使わない。導入時に予約パスを個別に確認する。
  assert.match(result.stderr, /\[horse-id\]/);
});

test("reads tracked paths with spaces and non-ASCII bytes without Git quoting", async (context) => {
  const result = await checkPaths(context, ["horse card.ts", "馬.ts"]);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes("horse card.ts"));
  assert.ok(result.stderr.includes("馬.ts"));
});

test("uses the installed Biome rule for filename stems and every role suffix", async (context) => {
  const { readFile } = await import("node:fs/promises");
  const configuration = JSON.parse(await readFile(join(repository, "biome.json"), "utf8"));
  const rule = configuration.linter.rules.style.useFilenamingConvention;
  assert.equal(rule.level, "error");
  assert.deepEqual(rule.options.filenameCases, ["kebab-case"]);
  const fixture = await createFixture();
  context.after(() => rm(fixture, { recursive: true, force: true }));
  await writeFile(
    join(fixture, "biome.json"),
    JSON.stringify({
      linter: { rules: { recommended: false, style: { useFilenamingConvention: rule } } },
    }),
  );
  const biome = join(repository, "node_modules/@biomejs/biome/bin/biome");
  for (const [file, expected] of [
    ["horse.icon.tsx", 0],
    ["horse-card.test.tsx", 0],
    ["status.ts", 0],
    ["lens.ts", 0],
    ["[horse-id].tsx", 0],
    ["Horse.icon.tsx", 1],
    ["horse.Icon.tsx", 1],
    ["horse..icon.tsx", 1],
  ]) {
    await writeFile(join(fixture, file), "export {};\n");
    const result = spawnSync(
      process.execPath,
      [biome, "lint", "--only=style/useFilenamingConvention", file],
      {
        cwd: fixture,
        encoding: "utf8",
      },
    );
    assert.equal(result.status, expected, `${file}: ${result.stdout}\n${result.stderr}`);
  }
});

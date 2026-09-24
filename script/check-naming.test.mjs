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

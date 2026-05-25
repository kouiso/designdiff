import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveTopPcImplPath } from "./top-pc-smoke-paths.mjs";

test("top-pc.png がある場合は canonical を優先する", () => {
  const outDir = mkdtempSync(join(tmpdir(), "top-pc-smoke-paths-"));
  const implDir = join(outDir, "impl");
  mkdirSync(implDir, { recursive: true });
  const canonical = join(implDir, "top-pc.png");
  const legacy = join(implDir, "top-pc-pc.png");
  writeFileSync(canonical, "canonical");
  writeFileSync(legacy, "legacy");

  assert.equal(resolveTopPcImplPath(outDir), canonical);
});

test("top-pc.png がない場合は legacy top-pc-pc.png を受け入れる", () => {
  const outDir = mkdtempSync(join(tmpdir(), "top-pc-smoke-paths-"));
  const implDir = join(outDir, "impl");
  mkdirSync(implDir, { recursive: true });
  const legacy = join(implDir, "top-pc-pc.png");
  writeFileSync(legacy, "legacy");

  assert.equal(resolveTopPcImplPath(outDir), legacy);
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("same-run build exchange restores outputs and cache, rejects identity and closure mismatch", () => {
  const fixture = mkdtempSync(join(tmpdir(), "figdiff-build-contract-"));
  try {
    mkdirSync(join(fixture, "script"));
    mkdirSync(join(fixture, "bin"));
    copyFileSync(
      join(import.meta.dirname, "ci-build-cache.mjs"),
      join(fixture, "script/ci-build-cache.mjs"),
    );
    writeFileSync(join(fixture, "pnpm-lock.yaml"), "fixture-lock");
    writeFileSync(join(fixture, ".mise.toml"), "fixture-tools");
    writeFileSync(
      join(fixture, "turbo.json"),
      JSON.stringify({ tasks: { build: { outputs: ["dist/**"] } } }),
    );
    writeFileSync(join(fixture, "bin/pnpm"), "#!/bin/sh\nprintf '%s' \"$TURBO_DRY_RUN\"\n", {
      mode: 0o755,
    });
    const env = {
      ...process.env,
      PATH: `${join(fixture, "bin")}:${process.env.PATH}`,
      GITHUB_SHA: "fixture-sha",
      GITHUB_RUN_ID: "1234",
      GITHUB_RUN_ATTEMPT: "1",
      TURBO_DRY_RUN: JSON.stringify({
        tasks: [
          {
            taskId: "desktop#build",
            task: "build",
            hash: "fixture-hash",
            cache: { status: "HIT" },
          },
        ],
      }),
    };
    for (const path of ["app/desktop/dist", "package/shared/dist", ".turbo/cache"]) {
      mkdirSync(join(fixture, path), { recursive: true });
      writeFileSync(join(fixture, path, "output"), "compiled-fixture", {
        mode: 0o755,
      });
    }
    for (const name of ["app/desktop", "package/shared"])
      writeFileSync(
        join(fixture, name, "package.json"),
        JSON.stringify({
          name: name === "app/desktop" ? "desktop" : "shared",
          scripts: { build: "fixture-build" },
        }),
      );
    env.TURBO_DRY_RUN = JSON.stringify({
      tasks: ["desktop", "shared"].map((name) => ({
        taskId: `${name}#build`,
        command: "fixture-build",
        hash: `hash-${name}`,
        cache: { status: "HIT" },
      })),
    });
    const run = (mode, overrides = {}) =>
      spawnSync(process.execPath, [join(fixture, "script/ci-build-cache.mjs"), mode], {
        cwd: fixture,
        encoding: "utf8",
        env: { ...env, ...overrides },
      });
    assert.equal(run("save").status, 0);
    rmSync(join(fixture, "app/desktop/dist"), { recursive: true });
    assert.equal(run("restore").status, 0);
    assert.equal(
      readFileSync(join(fixture, "app/desktop/dist/output"), "utf8"),
      "compiled-fixture",
    );
    assert.notEqual(run("restore", { GITHUB_RUN_ATTEMPT: "2" }).status, 0);
    assert.notEqual(run("restore", { GITHUB_SHA: "other-sha" }).status, 0);
    assert.notEqual(
      run("restore", {
        TURBO_DRY_RUN: JSON.stringify({
          tasks: [
            {
              taskId: "desktop#build",
              task: "build",
              hash: "fixture-hash",
              cache: { status: "MISS" },
            },
          ],
        }),
      }).status,
      0,
    );
    assert.notEqual(run("restore", { TURBO_DRY_RUN: "{broken" }).status, 0);
    writeFileSync(join(fixture, "pnpm-lock.yaml"), "changed-lock");
    assert.notEqual(run("restore").status, 0);
    writeFileSync(join(fixture, "pnpm-lock.yaml"), "fixture-lock");
    writeFileSync(join(fixture, ".ci-build/payload.tar.gz"), "corrupt");
    assert.notEqual(run("restore").status, 0);
    assert.notEqual(run("unknown").status, 0);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

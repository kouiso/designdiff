import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const root = join(import.meta.dirname, "..");
test("full and fast CI preserve cloud command profiles and stop on each tool failure", () => {
  const fixture = mkdtempSync(join(tmpdir(), "figdiff-ci-contract-"));
  try {
    mkdirSync(join(fixture, "script"));
    mkdirSync(join(fixture, "bin"));
    copyFileSync(join(root, "script/ci.mjs"), join(fixture, "script/ci.mjs"));
    copyFileSync(join(root, "Taskfile.yml"), join(fixture, "Taskfile.yml"));
    const log = join(fixture, "commands");
    for (const tool of ["pnpm", "node", "xvfb-run"]) {
      writeFileSync(
        join(fixture, "bin", tool),
        `#!/bin/sh\nif [ "$1" = script/ci.mjs ]; then exec "$REAL_NODE" "$@"; fi\nprintf '%s\\n' '${tool} '"$*" >> "$COMMAND_LOG"\ntest "$FAIL_COMMAND" != '${tool} '"$*" || exit 42\n`,
        { mode: 0o755 },
      );
    }
    const run = (mode, fail = "never") =>
      spawnSync(process.execPath, [join(fixture, "script/ci.mjs"), mode], {
        cwd: fixture,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${join(fixture, "bin")}:${process.env.PATH}`,
          REAL_NODE: process.execPath,
          COMMAND_LOG: log,
          FAIL_COMMAND: fail,
          CI_EVIDENCE_DIR: "/tmp/figdiff-contract-evidence",
        },
      });
    assert.equal(run("all").status, 0);
    const full = readFileSync(log, "utf8").trim().split("\n");
    for (const command of [
      "pnpm lint",
      "pnpm check",
      "pnpm lint:eslint",
      "pnpm typecheck",
      "pnpm -r run test:coverage",
      "node script/oracle-compare.mjs self-test",
      "pnpm --filter @figdiff/mcp-server run test:stdio-smoke",
      "node script/check-pixelmatch-usage.mjs",
    ])
      assert.ok(full.includes(command), command);
    assert.equal(full.filter((line) => line === "pnpm build").length, 1);
    writeFileSync(log, "");
    const task = spawnSync(
      "/opt/homebrew/bin/task",
      ["--taskfile", join(fixture, "Taskfile.yml"), "ci"],
      {
        cwd: fixture,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${join(fixture, "bin")}:${process.env.PATH}`,
          REAL_NODE: process.execPath,
          COMMAND_LOG: log,
          FAIL_COMMAND: "never",
          CI_EVIDENCE_DIR: "/tmp/figdiff-contract-evidence",
        },
      },
    );
    assert.equal(task.status, 0, task.stderr);
    assert.deepEqual(readFileSync(log, "utf8").trim().split("\n"), full);
    assert.ok(full.some((line) => line.includes("plugin-frame-handoff-e2e.mjs")));
    assert.ok(full.some((line) => line.includes("electron-ipc-smoke.mjs")));
    for (const command of full) {
      writeFileSync(log, "");
      assert.equal(run("all", command).status, 42, command);
      assert.equal(readFileSync(log, "utf8").trim().split("\n").at(-1), command);
    }
    writeFileSync(log, "");
    assert.equal(run("fast").status, 0);
    assert.deepEqual(readFileSync(log, "utf8").trim().split("\n"), [
      "pnpm install --frozen-lockfile",
      "pnpm check:naming",
      "pnpm lint",
      "pnpm build",
      "pnpm test",
    ]);
    assert.equal(run("unknown").status, 2);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

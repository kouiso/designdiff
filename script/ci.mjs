import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

process.chdir(resolve(import.meta.dirname, ".."));
process.env.CI = "true";
const evidence = process.env.CI_EVIDENCE_DIR || resolve(tmpdir(), "figdiff-local-ci-evidence");
const display = process.platform === "linux" ? ["xvfb-run", "-a"] : [];
const plans = {
  install: [["pnpm", "install", "--frozen-lockfile"]],
  build: [["pnpm", "build"]],
  lint: [
    ["pnpm", "check"],
    ["pnpm", "lint:eslint"],
  ],
  typecheck: [["pnpm", "typecheck"]],
  test: [
    ["pnpm", "test"],
    ["pnpm", "--filter", "@figdiff/mcp-server", "run", "test:stdio-smoke"],
  ],
  coverage: [["pnpm", "-r", "run", "test:coverage"]],
  naming: [
    ["node", "script/check-naming.mjs"],
    ["node", "script/check-action-pins.mjs"],
    ["node", "script/check-pixelmatch-usage.mjs"],
  ],
  oracle: [
    ["node", "script/oracle-compare.mjs", "self-test"],
    ["node", "script/oracle-verdict-agreement.mjs"],
    [
      "pnpm",
      "--filter",
      "@figdiff/mcp-server",
      "exec",
      "vitest",
      "run",
      "src/service/p5-oracle-gate.test.ts",
    ],
  ],
  browser: [
    [
      "pnpm",
      "--filter",
      "@figdiff/desktop",
      "exec",
      "playwright",
      "install",
      "--with-deps",
      "chromium",
    ],
  ],
  e2e: [["pnpm", "--filter", "@figdiff/desktop", "run", "e2e"]],
  plugin: [["node", "app/figma-plugin/e2e/real-iframe-host.mjs"]],
  electron: [
    [
      ...display,
      "node",
      "app/desktop/e2e/electron-ipc-smoke.mjs",
      resolve(evidence, "electron-ipc-evidence"),
    ],
  ],
  extension: [
    [
      "node",
      "app/chrome-extension/script/real-chrome-e2e.mjs",
      resolve(evidence, "chrome-ext-evidence"),
    ],
    [
      "node",
      "app/chrome-extension/script/prepare-e2e-dist.mjs",
      resolve(evidence, "chrome-ext-e2e-dist"),
    ],
    [
      "node",
      "app/chrome-extension/script/real-chrome-e2e.mjs",
      resolve(evidence, "chrome-ext-compare-evidence"),
    ],
    [
      ...display,
      "node",
      "app/chrome-extension/script/plugin-frame-handoff-e2e.mjs",
      resolve(evidence, "plugin-extension-evidence"),
    ],
  ],
  fast: [
    ["pnpm", "install", "--frozen-lockfile"],
    ["pnpm", "check:naming"],
    ["pnpm", "lint"],
    ["pnpm", "build"],
    ["pnpm", "test"],
  ],
};
plans["extension-initial"] = [plans.extension[0]];
plans["extension-prepare"] = [plans.extension[1]];
plans["extension-compare"] = [plans.extension[2]];
plans["extension-handoff"] = [plans.extension[3]];
const mode = process.argv[2] || "all";
const phases =
  mode === "all"
    ? [
        "install",
        "naming",
        "build",
        "local-lint",
        "lint",
        "typecheck",
        "test",
        "coverage",
        "oracle",
        "browser",
        "e2e",
        "plugin",
        "electron",
        "extension",
      ]
    : [mode];
plans["local-lint"] = [["pnpm", "lint"]];
if (phases.some((phase) => !Object.hasOwn(plans, phase))) {
  process.stderr.write(`Unknown CI mode: ${mode}\n`);
  process.exit(2);
}
for (const phase of phases) {
  for (const [index, command] of plans[phase].entries()) {
    const env = { ...process.env };
    if (phase === "plugin")
      env.FIGDIFF_PLUGIN_HOST_EVIDENCE = resolve(evidence, "figma-plugin-evidence");
    if (
      (phase === "extension" && (index === 0 || index === 2)) ||
      phase === "extension-initial" ||
      phase === "extension-compare"
    )
      env.FIGDIFF_HEADLESS = "new";
    if ((phase === "extension" && index === 2) || phase === "extension-compare") {
      env.FIGDIFF_EXT_DIR = resolve(evidence, "chrome-ext-e2e-dist");
      env.FIGDIFF_EXPECT_COMPARE = "1";
    }
    const result = spawnSync(command[0], command.slice(1), {
      stdio: "inherit",
      env,
    });
    if (result.error) process.stderr.write(`${result.error.message}\n`);
    if (result.status !== 0) process.exit(result.status || 1);
  }
}

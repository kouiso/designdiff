import { spawn } from "node:child_process";
import { resolve } from "node:path";

const runtimeSmokeScript = resolve("script/runtime-smoke.mjs");

const runSmoke = async (env) => {
  const child = spawn(process.execPath, [runtimeSmokeScript], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const exit = await new Promise((resolveExit) => {
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });

  return { ...exit, stderr, stdout };
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const shortProbeResult = await runSmoke({ FIGDIFF_RUNTIME_SMOKE_MS: "1499" });
assert(shortProbeResult.code !== 0, "runtime smoke must reject probe durations below 1500ms.");
assert(
  shortProbeResult.stderr.includes("FIGDIFF_RUNTIME_SMOKE_MS must be an integer >= 1500."),
  "runtime smoke must explain the minimum probe duration.",
);

const shortShutdownResult = await runSmoke({ FIGDIFF_RUNTIME_SHUTDOWN_MS: "499" });
assert(shortShutdownResult.code !== 0, "runtime smoke must reject shutdown timeouts below 500ms.");
assert(
  shortShutdownResult.stderr.includes("FIGDIFF_RUNTIME_SHUTDOWN_MS must be an integer >= 500."),
  "runtime smoke must explain the minimum shutdown duration.",
);

process.stdout.write("MCP runtime smoke self-test passed.\n");

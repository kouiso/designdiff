import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";

const entry = resolve("dist/index.js");
const readDuration = (envName, fallbackMs, minMs) => {
  const rawValue = process.env[envName];
  if (!rawValue) return fallbackMs;

  const parsedValue = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsedValue) || parsedValue < minMs) {
    throw new Error(`${envName} must be an integer >= ${minMs}.`);
  }

  return parsedValue;
};

const probeMs = readDuration("FIGDIFF_RUNTIME_SMOKE_MS", 5000, 1500);
const shutdownMs = readDuration("FIGDIFF_RUNTIME_SHUTDOWN_MS", 1000, 500);

await access(entry);

const child = spawn(process.execPath, [entry], {
  stdio: ["pipe", "pipe", "pipe"],
});

let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

const exitCode = await new Promise((resolveExit) => {
  child.once("exit", (code, signal) => {
    resolveExit({ code, signal });
  });
  setTimeout(() => resolveExit(null), probeMs);
});

if (exitCode) {
  throw new Error(
    `MCP server exited within ${probeMs}ms (code=${exitCode.code}, signal=${exitCode.signal}). ${stderr}`.trim(),
  );
}

child.kill("SIGTERM");

const stopped = await new Promise((resolveStopped) => {
  child.once("exit", () => resolveStopped(true));
  setTimeout(() => resolveStopped(false), shutdownMs);
});

if (!stopped) {
  child.kill("SIGKILL");
  throw new Error(`MCP server did not stop within ${shutdownMs}ms after SIGTERM.`);
}

process.stdout.write(`MCP server stayed alive for ${probeMs}ms and shut down cleanly.\n`);

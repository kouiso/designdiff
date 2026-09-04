import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const runtimeSmokeScript = resolve("script/runtime-smoke.mjs");

const runSmoke = async (env, cwd) => {
  const child = spawn(process.execPath, [runtimeSmokeScript], {
    cwd,
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
  shortProbeResult.stderr.includes("FIGDIFF_RUNTIME_SMOKE_MS must be an integer between 1500"),
  "runtime smoke must explain the minimum probe duration.",
);

for (const invalid of ["1500junk", "2147483648", "9007199254740991d", "9007199254740992"]) {
  const invalidResult = await runSmoke({ FIGDIFF_RUNTIME_SMOKE_MS: invalid });
  assert(invalidResult.code !== 0, `runtime smoke must reject ${invalid}.`);
  assert(
    invalidResult.stderr.includes("FIGDIFF_RUNTIME_SMOKE_MS must be an integer between 1500"),
    `runtime smoke must explain invalid duration ${invalid}.`,
  );
}

const shortShutdownResult = await runSmoke({ FIGDIFF_RUNTIME_SHUTDOWN_MS: "499" });
assert(shortShutdownResult.code !== 0, "runtime smoke must reject shutdown timeouts below 500ms.");
assert(
  shortShutdownResult.stderr.includes("FIGDIFF_RUNTIME_SHUTDOWN_MS must be an integer between 500"),
  "runtime smoke must explain the minimum shutdown duration.",
);

const FAST_PROBE = {
  FIGDIFF_RUNTIME_SMOKE_MS: "1500",
  FIGDIFF_RUNTIME_SHUTDOWN_MS: "500",
};
const withStubServer = async (body) => {
  const dir = mkdtempSync(join(tmpdir(), "figdiff-smoke-selftest-"));
  try {
    mkdirSync(join(dir, "dist"), { recursive: true });
    writeFileSync(join(dir, "dist", "index.js"), `${body}\nsetInterval(() => {}, 1000);\n`);
    return await runSmoke(FAST_PROBE, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const plainTextResult = await withStubServer('process.stdout.write("starting up\\n");');
assert(plainTextResult.code !== 0, "runtime smoke must reject plain text on stdout.");
assert(
  plainTextResult.stderr.includes("non-JSON-RPC line"),
  `runtime smoke must name the offending line. stderr=${plainTextResult.stderr}`,
);

const jsonButNotRpcResult = await withStubServer(
  'process.stdout.write(JSON.stringify({ level: "info" }) + "\\n");',
);
assert(jsonButNotRpcResult.code !== 0, "runtime smoke must reject JSON that is not JSON-RPC.");

const validEnvelopeResult = await withStubServer(
  'process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }) + "\\n");',
);
assert(
  validEnvelopeResult.code === 0,
  `runtime smoke must accept a valid JSON-RPC response. stderr=${validEnvelopeResult.stderr}`,
);

for (const id of ['"request-id"', "null"]) {
  const validIdResult = await withStubServer(
    `process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: ${id}, result: {} }) + "\\n");`,
  );
  assert(validIdResult.code === 0, `runtime smoke must accept JSON-RPC id=${id}.`);
}

for (const id of ["true", "{}", "[]"]) {
  const invalidIdResult = await withStubServer(
    `process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: ${id}, result: {} }) + "\\n");`,
  );
  assert(invalidIdResult.code !== 0, `runtime smoke must reject JSON-RPC id=${id}.`);
}

const bothMembersResult = await withStubServer(
  'process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {}, error: { code: -1, message: "x" } }) + "\\n");',
);
assert(
  bothMembersResult.code !== 0,
  "runtime smoke must reject a response carrying both result and error.",
);

const badErrorShapeResult = await withStubServer(
  'process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 1, error: ["nope"] }) + "\\n");',
);
assert(badErrorShapeResult.code !== 0, "runtime smoke must reject a malformed error member.");

const validErrorResult = await withStubServer(
  'process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32603, message: "failed" } }) + "\\n");',
);
assert(validErrorResult.code === 0, "runtime smoke must accept a valid JSON-RPC error response.");

const fractionalErrorCodeResult = await withStubServer(
  'process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32603.5, message: "failed" } }) + "\\n");',
);
assert(
  fractionalErrorCodeResult.code !== 0,
  "runtime smoke must reject a non-integer JSON-RPC error code.",
);

const overflowResult = await withStubServer(
  'process.stdout.write("x".repeat(1024 * 1024 + 1) + "\\n");',
);
assert(overflowResult.code !== 0, "runtime smoke must reject a stdout flood.");
assert(
  overflowResult.stderr.includes("bytes to stdout"),
  `runtime smoke must report the stdout cap. stderr=${overflowResult.stderr}`,
);

process.stdout.write("MCP runtime smoke self-test passed.\n");

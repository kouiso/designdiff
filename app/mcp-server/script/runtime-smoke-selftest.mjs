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
  shortProbeResult.stderr.includes("FIGDIFF_RUNTIME_SMOKE_MS must be an integer >= 1500."),
  "runtime smoke must explain the minimum probe duration.",
);

const shortShutdownResult = await runSmoke({ FIGDIFF_RUNTIME_SHUTDOWN_MS: "499" });
assert(shortShutdownResult.code !== 0, "runtime smoke must reject shutdown timeouts below 500ms.");
assert(
  shortShutdownResult.stderr.includes("FIGDIFF_RUNTIME_SHUTDOWN_MS must be an integer >= 500."),
  "runtime smoke must explain the minimum shutdown duration.",
);

// stdout の検証そのものを試す。dist/index.js を差し替えた作業ディレクトリを作り、
// 「JSON-RPC 以外を stdout に出すサーバー」を smoke が弾くことを確かめる。
// ここが無いと、今回足した検証ロジック自体は一度も実行されないまま出荷される。
const FAST_PROBE = { FIGDIFF_RUNTIME_SMOKE_MS: "1500", FIGDIFF_RUNTIME_SHUTDOWN_MS: "500" };

const withStubServer = async (body) => {
  const dir = mkdtempSync(join(tmpdir(), "figdiff-smoke-selftest-"));
  try {
    mkdirSync(join(dir, "dist"), { recursive: true });
    // SIGTERM で素直に終わり、それまでは生きているだけのサーバー。
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
assert(
  jsonButNotRpcResult.stderr.includes("not a JSON-RPC 2.0 message"),
  `runtime smoke must explain why the JSON line failed. stderr=${jsonButNotRpcResult.stderr}`,
);

const validEnvelopeResult = await withStubServer(
  'process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }) + "\\n");',
);
assert(
  validEnvelopeResult.code === 0,
  `runtime smoke must accept a valid JSON-RPC response. stderr=${validEnvelopeResult.stderr}`,
);
assert(
  validEnvelopeResult.stdout.includes("stdout carried 1 line(s), all valid JSON-RPC"),
  `runtime smoke must report the line count. stdout=${validEnvelopeResult.stdout}`,
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

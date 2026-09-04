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

// 異常な依存が stdout へ大量出力しても probe 中にメモリを食い潰さないよう上限を設ける。
const MAX_STDOUT_BYTES = 1024 * 1024; // 1 MiB
let stdout = "";
let stdoutBytes = 0;
let stdoutOverflowed = false;
child.stdout.on("data", (chunk) => {
  stdoutBytes += chunk.length;
  if (stdoutBytes > MAX_STDOUT_BYTES) {
    stdoutOverflowed = true;
    return;
  }
  stdout += chunk.toString();
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

// overflow を検知した後も、通常終了と同じ SIGTERM → close 待機 → SIGKILL の手順を
// 必ず最後まで終わらせてから throw する。ここで即 throw すると、SIGTERM を無視する
// 子プロセスが kill されないまま probe だけ抜けてしまう。
child.kill("SIGTERM");

// "exit" はプロセス終了の合図でしかなく、stdio ストリームがまだ開いている場合がある。
// "close" を待つと、stdout/stderr の書き込みが完全に終わってから検証できる —
// 終了直前の最後の書き込みを取りこぼさないため。
const stopped = await new Promise((resolveStopped) => {
  child.once("close", () => resolveStopped(true));
  setTimeout(() => resolveStopped(false), shutdownMs);
});

if (!stopped) {
  child.kill("SIGKILL");
  if (stdoutOverflowed) {
    throw new Error(
      `MCP server wrote more than ${MAX_STDOUT_BYTES} bytes to stdout during the ${probeMs}ms probe, and did not stop within ${shutdownMs}ms after SIGTERM; sent SIGKILL.`,
    );
  }
  throw new Error(`MCP server did not stop within ${shutdownMs}ms after SIGTERM.`);
}

if (stdoutOverflowed) {
  throw new Error(
    `MCP server wrote more than ${MAX_STDOUT_BYTES} bytes to stdout; aborting before validation.`,
  );
}

// JSON 構文が通るだけでは JSON-RPC とは言えない (`42` や `{"level":"info"}` も通ってしまう)。
// request/notification は method を、response は id と result/error のどちらかを持つ、
// という JSON-RPC 2.0 のエンベロープ最低限を確認する。
const isJsonRpcMessage = (value) => {
  // 配列 (JSON-RPC のバッチ) は弾く。このサーバーはバッチを出さないので、
  // 出てきたら仕様上は妥当でも「想定外のものが stdout に出た」として扱いたい。
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  if (value.jsonrpc !== "2.0") return false;
  if (typeof value.method === "string") return true; // request または notification
  const hasResult = Object.hasOwn(value, "result");
  const hasError = typeof value.error === "object" && value.error !== null;
  return (hasResult || hasError) && Object.hasOwn(value, "id");
};

// stdout は JSON-RPC の本線。依存ライブラリやログが stderr 以外へ漏れていないか
// ここで確認する — 空行以外の全行が有効な JSON-RPC メッセージであることを要求する。
const stdoutLines = stdout.split("\n").filter((line) => line.length > 0);
for (const line of stdoutLines) {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new Error(`MCP server wrote a non-JSON-RPC line to stdout: ${JSON.stringify(line)}`);
  }
  if (!isJsonRpcMessage(parsed)) {
    throw new Error(
      `MCP server wrote a JSON line that is not a JSON-RPC 2.0 message: ${JSON.stringify(line)}`,
    );
  }
}

process.stdout.write(
  `MCP server stayed alive for ${probeMs}ms, shut down cleanly, and stdout carried ${stdoutLines.length} line(s), all valid JSON-RPC.\n`,
);

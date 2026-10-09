import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { access, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entry = join(packageRoot, "dist/index.js");
const serverModule = join(packageRoot, "dist/server.js");
const MAX_TIMER_MS = 2_147_483_647;
// 壊れたサーバーが stderr や不正な stdout を吐き続けても、診断用に溜める量で runner のメモリを食わせない。
const MAX_STDERR_CHARS = 64 * 1024;
const MAX_PROTOCOL_ERRORS = 20;

const readDuration = (envName, fallbackMs, minMs) => {
  const rawValue = process.env[envName];
  if (!rawValue) return fallbackMs;
  const parsedValue = /^\d+$/.test(rawValue) ? Number(rawValue) : Number.NaN;
  if (!Number.isSafeInteger(parsedValue) || parsedValue < minMs || parsedValue > MAX_TIMER_MS) {
    throw new Error(`${envName} must be an integer between ${minMs} and ${MAX_TIMER_MS}.`);
  }
  return parsedValue;
};

// initialize はサーバーの起動 (sharp などの読み込み) も待つので、CI の遅いランナーでも
// 正常系が落ちない幅を取る。応答しないサーバーはこの時間で必ず赤になる。
const requestTimeoutMs = readDuration("FIGDIFF_STDIO_SMOKE_REQUEST_MS", 20_000, 1_000);
// 個々の要求のタイムアウトをすり抜けて止まった場合 (close が終わらない等) の最後の砦。
const deadlineMs = readDuration("FIGDIFF_STDIO_SMOKE_DEADLINE_MS", 90_000, 5_000);

await access(entry).catch(() => {
  throw new Error(`${entry} not found. Run \`pnpm build\` before the stdio smoke.`);
});

// 利用者の ~/.figdiff や Figma トークンに触れないよう、HOME と FIGDIFF_HOME を空の一時領域へ向ける。
const sandbox = await mkdtemp(join(tmpdir(), "figdiff-stdio-smoke-"));
const home = join(sandbox, "home");
const figdiffHome = join(sandbox, "figdiff");
try {
  await Promise.all([mkdir(home), mkdir(figdiffHome)]);
} catch (error) {
  await rm(sandbox, { recursive: true, force: true });
  throw error;
}

let stderrTail = "";
const protocolErrors = [];
let droppedProtocolErrors = 0;
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entry],
  cwd: sandbox,
  // SDK は PATH などの安全な変数だけを引き継ぎ、ここで渡したものを上書きする。
  // FIGMA_TOKEN は引き継がれないので、トークン無しで通ることもここで保証される。
  env: { HOME: home, FIGDIFF_HOME: figdiffHome },
  stderr: "pipe",
});
transport.stderr?.on("data", (chunk) => {
  stderrTail = (stderrTail + chunk.toString()).slice(-MAX_STDERR_CHARS);
});
const client = new Client({ name: "figdiff-stdio-roundtrip-smoke", version: "1.0.0" });
client.onerror = (error) => {
  if (protocolErrors.length < MAX_PROTOCOL_ERRORS) protocolErrors.push(error.message);
  else droppedProtocolErrors += 1;
};
// SDK 1.31 の StdioClientTransport は子の終了コードを捨てる。最後の応答の後にサーバーが落ちても
// 要求が残っていなければ何も reject されないので、こちらが閉じる前の切断を自前で検知する。
let closeRequested = false;
let closedBeforeRequest = false;
client.onclose = () => {
  if (!closeRequested) closedBeforeRequest = true;
};

const errorMessage = (error) => (error instanceof Error ? error.message : String(error));

const fail = (message) => {
  const tail = stderrTail.trim().split("\n").slice(-20).join("\n");
  process.stderr.write(`stdio round-trip smoke FAILED: ${message}\n`);
  // stdout に JSON-RPC 以外が混ざると、表に出るのが後続のタイムアウトだけになることがある。原因はこちらに残る。
  for (const protocolError of protocolErrors) {
    process.stderr.write(`client protocol error: ${protocolError}\n`);
  }
  if (droppedProtocolErrors > 0) {
    process.stderr.write(`(${droppedProtocolErrors} more protocol error(s) omitted)\n`);
  }
  if (tail) process.stderr.write(`--- MCP server stderr (last 20 lines) ---\n${tail}\n`);
};

const watchdog = setTimeout(() => {
  fail(`did not finish within ${deadlineMs}ms; killing the server.`);
  // close() の穏当な停止手順を待つと、それ自体が止まっている可能性がある。子を確実に残さない。
  // 子が同時に終了していると kill が ESRCH で投げるが、その場合も後始末と exit は必ず行う。
  const pid = transport.pid;
  try {
    if (pid !== null) process.kill(pid, "SIGKILL");
  } catch (error) {
    process.stderr.write(`could not SIGKILL MCP server pid ${pid}: ${errorMessage(error)}\n`);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
    process.exit(1);
  }
}, deadlineMs);

// 期待値は同じビルドの createMcpServer を InMemoryTransport で直接つないだ結果。
// ツール数をスクリプトに直書きすると、ツール追加のたびに stdio と関係ない理由で赤になる。
// 比較したいのは「stdio を通しても登録済みの定義が欠けず・化けずに届くか」。
const listToolsInProcess = async () => {
  // Windows の絶対パス (C:\...) をそのまま import() に渡すと URL スキームと解釈されて落ちる。
  const { createMcpServer } = await import(pathToFileURL(serverModule).href);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer();
  const inProcessClient = new Client({ name: "figdiff-stdio-smoke-oracle", version: "1.0.0" });
  await server.connect(serverSide);
  await inProcessClient.connect(clientSide);
  try {
    // InMemoryTransport はオブジェクトをそのまま渡すので undefined のキーが残る。
    // 線上の JSON と同じ形に揃えてから比べる。
    return JSON.parse(JSON.stringify((await inProcessClient.listTools()).tools));
  } finally {
    await inProcessClient.close();
    await server.close();
  }
};

let summary;
let exitCode = 0;
try {
  const requestOptions = { timeout: requestTimeoutMs };
  const startedAt = performance.now();
  await client.connect(transport, requestOptions).catch((error) => {
    throw new Error(`initialize failed: ${error.message}`);
  });
  const serverInfo = client.getServerVersion();
  assert.equal(serverInfo?.name, "figdiff", "initialize returned an unexpected serverInfo.name");

  const { tools } = await client.listTools(undefined, requestOptions).catch((error) => {
    throw new Error(`tools/list failed: ${error.message}`);
  });
  const expectedTools = await listToolsInProcess();
  assert.ok(expectedTools.length > 0, "createMcpServer registered no tools");
  const byName = (a, b) => a.name.localeCompare(b.name);
  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    expectedTools.map((tool) => tool.name).sort(),
    `tools/list over stdio returned ${tools.length} tool(s), expected ${expectedTools.length}`,
  );
  assert.deepEqual(
    [...tools].sort(byName),
    [...expectedTools].sort(byName),
    "tool definitions differ between stdio and in-process tools/list",
  );

  const result = await client
    .callTool({ name: "list_projects", arguments: {} }, undefined, requestOptions)
    .catch((error) => {
      throw new Error(`tools/call list_projects failed: ${error.message}`);
    });
  const text = result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
  assert.equal(result.isError ?? false, false, `list_projects returned isError: ${text}`);
  // 空の一時 FIGDIFF_HOME を渡したので 0 件が正解。実ホームを読んでいればここで食い違う。
  assert.deepEqual(JSON.parse(text), { projectCount: 0, projects: [] });
  assert.deepEqual(await readdir(join(figdiffHome, "projects")), []);

  const elapsedMs = Math.round(performance.now() - startedAt);
  summary = `MCP stdio round-trip OK in ${elapsedMs}ms: initialize (${serverInfo.name} ${serverInfo.version}) -> tools/list (${tools.length} tools, identical to in-process) -> list_projects (isError: false, projectCount: 0).`;
} catch (error) {
  exitCode = 1;
  fail(errorMessage(error));
}

// 応答直後に落ちた場合、close イベントはこちらの判定より少し遅れて届く。その分だけ待つ。
if (exitCode === 0) await new Promise((resolveSettle) => setTimeout(resolveSettle, 500));
if (exitCode === 0 && closedBeforeRequest) {
  exitCode = 1;
  fail("the MCP server closed the stdio connection before the client did");
}
closeRequested = true;
// 停止手順の失敗も stdio 経路の異常なので、往復が通っていても赤にする。
await client.close().catch((error) => {
  exitCode = 1;
  fail(`client.close failed: ${errorMessage(error)}`);
});
clearTimeout(watchdog);
// 最後の応答の後や停止処理中に stdout が汚れることもある。close で読み切ってから判定する。
if (exitCode === 0 && (protocolErrors.length > 0 || droppedProtocolErrors > 0)) {
  exitCode = 1;
  fail("the client reported protocol errors");
}
await rm(sandbox, { recursive: true, force: true });
if (exitCode === 0) process.stdout.write(`${summary}\n`);
process.exitCode = exitCode;

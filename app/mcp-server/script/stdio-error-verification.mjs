import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const entry = join(root, "app/mcp-server/dist/index.js");
const entryBytes = await readFile(entry);
const sandbox = await mkdtemp(join(tmpdir(), "figdiff-stdio-errors-"));
const home = join(sandbox, "home");
const store = join(sandbox, "store");
await mkdir(home);
await mkdir(store);
const results = [];
const protocolErrors = [];
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entry],
  cwd: sandbox,
  env: { HOME: home, PATH: dirname(process.execPath), FIGDIFF_HOME: store },
  stderr: "pipe",
});
const client = new Client({ name: "figdiff-error-verification", version: "1.0.0" });
// SDK の復号失敗も記録し、通常ログが stdout に混ざるケースを見逃さない。
client.onerror = (error) => protocolErrors.push(error.message);
const errorText = (result) =>
  result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
const checkError = async (name, args, expected) => {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 15000 });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent, undefined);
  const text = errorText(result);
  assert.match(text, expected);
  assert.doesNotMatch(text, /output schema|outputSchema|structured content.*required/i);
  results.push({ name, text, isError: true, structuredContentAbsent: true });
  return text;
};
try {
  await client.connect(transport);
  transport.stderr?.resume();
  transport.stderr?.resume();
  const inventory = await client.listTools();
  assert.ok(inventory.tools.some((tool) => tool.name === "compare_design" && tool.outputSchema));
  await checkError(
    "compare_design",
    { design_source: "missing.png", threshold: 2 },
    /threshold|validation/i,
  );
  await checkError(
    "compare_design",
    { design_source: "missing.png", typo_argument: true },
    /typo_argument/,
  );
  await checkError(
    "get_design_tokens",
    {
      figma_url: "https://www.figma.com/design/VerificationFixture/File?node-id=1-2",
    },
    /token|認証|credential/i,
  );
  await chmod(store, 0o500);
  // OS による拒否を先に確認する。root 実行で chmod が無効なら成功扱いにしない。
  await assert.rejects(writeFile(join(store, "independent-write-probe"), "probe"), {
    code: "EACCES",
  });
  const storageText = await checkError(
    "compare_design",
    { design_source: "missing.png", screenshot: "missing.png" },
    /FIGDIFF_STORAGE_NOT_WRITABLE/,
  );
  const payload = JSON.parse(storageText);
  assert.equal(payload.location, "home");
  assert.equal(payload.retryable, true);
  assert.ok(payload.actions.some((action) => action.includes("FIGDIFF_HOME")));
  await chmod(store, 0o700);
  const restored = await client.callTool({
    name: "compare_design",
    arguments: { design_source: "missing.png", screenshot: "missing.png" },
  });
  assert.equal(restored.isError, true);
  assert.doesNotMatch(errorText(restored), /FIGDIFF_STORAGE_NOT_WRITABLE/);
  results.push({
    name: "permission-restored-without-restart",
    text: errorText(restored),
    isError: true,
  });
  assert.deepEqual(protocolErrors, []);
  const evidence = {
    revision: execFileSync("/usr/bin/git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
    sourceStatus: execFileSync("/usr/bin/git", ["status", "--porcelain"], {
      cwd: root,
      encoding: "utf8",
    }),
    entrySha256: createHash("sha256").update(entryBytes).digest("hex"),
    platform: process.platform,
    node: process.version,
    executedAt: new Date().toISOString(),
    toolCount: inventory.tools.length,
    protocolErrors,
    results,
    scope:
      "Actual SDK over stdio; isolated home; no credentials; OS EACCES; recovery removes storage error, not a successful image comparison. Build identity records entry only, not every dependency.",
  };
  const evidencePath = join(sandbox, "evidence.json");
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
  process.stdout.write(`${evidencePath}\n`);
} finally {
  await chmod(store, 0o700);
  await client.close();
}

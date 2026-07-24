#!/usr/bin/env node
/**
 * Figma ingest の API 境界を mock server で検証する。
 *
 * 実 FIGMA_TOKEN や実 Figma node がない環境でも、images API -> PNG download
 * -> figdiff manifest 生成までの結合を fail-loud に確認する。
 */

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SUCCESS_EXIT_CODE = 0;
const ERROR_EXIT_CODE = 2;
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);
const repoDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const options = parseArgs(process.argv.slice(2));
const outDir = resolve(
  options.out ? String(options.out) : await mkdtemp(join(tmpdir(), "figma-ingest-mock-")),
);
const workDir = join(outDir, "work");
const implDir = join(workDir, "impl");
const figmaManifest = join(workDir, "figma-pages.json");
const ingestOut = join(outDir, "figma-ingest");
const summaryOut = join(outDir, "summary.md");

await mkdir(implDir, { recursive: true });
await writeFixtures();

const server = createMockFigmaServer();
const { port } = await listen(server);
const apiBase = `http://127.0.0.1:${port}/v1`;

try {
  await run("node", [
    join(repoDir, "script/eval/ingest-figma-pages.mjs"),
    "--figma-manifest",
    figmaManifest,
    "--out",
    ingestOut,
    "--impl-dir",
    implDir,
    "--token",
    "mock-token",
    "--api-base",
    apiBase,
  ]);
  await assertOutput();
  await writeSummary();
  process.stdout.write(`Mock ingest verified: ${summaryOut}\n`);
} finally {
  await close(server);
}

function parseArgs(args) {
  const parsed = {};
  const normalized = args[0] === "--" ? args.slice(1) : args;
  for (let index = 0; index < normalized.length; index += 1) {
    const arg = normalized[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const next = normalized[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

async function writeFixtures() {
  const manifest = {
    pages: [
      {
        name: "top-pc",
        figma_url: "https://www.figma.com/design/mockFile/sample-project?node-id=1-2",
      },
      {
        name: "contact-sp",
        file_key: "mockFile",
        node_id: "3-4",
      },
    ],
  };
  await writeFile(figmaManifest, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(implDir, "top-pc.png"), PNG_BYTES);
  await writeFile(join(implDir, "contact-sp.png"), PNG_BYTES);
}

function createMockFigmaServer() {
  return createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/v1/images/mockFile") {
      if (
        url.searchParams.get("contents_only") !== "true" ||
        url.searchParams.get("use_absolute_bounds") !== "true"
      ) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ err: "frame-bound render parameters are required" }));
        return;
      }
      const ids = String(url.searchParams.get("ids") ?? "")
        .split(",")
        .filter(Boolean);
      const images = Object.fromEntries(
        ids.map((id) => [id, `http://127.0.0.1:${serverAddressPort(response)}/download/${id}.png`]),
      );
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ images }));
      return;
    }
    if (url.pathname.startsWith("/download/")) {
      response.writeHead(200, { "content-type": "image/png" });
      response.end(PNG_BYTES);
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ err: `not found: ${url.pathname}` }));
  });
}

function serverAddressPort(response) {
  const address = response.socket?.localAddress ? response.socket.localPort : null;
  if (!address) {
    fail("Mock server port is unavailable.");
  }
  return address;
}

async function listen(server) {
  return await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Mock server address is unavailable."));
        return;
      }
      resolvePromise(address);
    });
  });
}

async function close(server) {
  await new Promise((resolvePromise, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolvePromise();
    });
  });
}

async function run(command, args) {
  process.stdout.write(`$ ${[command, ...args].join(" ")}\n`);
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: repoDir,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("close", (code) => {
      if (code === SUCCESS_EXIT_CODE) {
        resolvePromise();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
    });
  });
}

async function assertOutput() {
  const manifestPath = join(ingestOut, "figdiff-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!Array.isArray(manifest.pages) || manifest.pages.length !== 2) {
    fail(`Expected 2 manifest pages, got ${manifest.pages?.length ?? 0}.`);
  }
  for (const page of manifest.pages) {
    if (!page.figma || !page.impl || !page.meta?.file_key || !page.meta?.node_id) {
      fail(`Manifest page is incomplete: ${JSON.stringify(page)}`);
    }
    await readFile(page.figma);
    await readFile(page.impl);
  }
}

async function writeSummary() {
  const lines = [
    "# Figma ingest mock verification",
    "",
    `- Output: ${outDir}`,
    `- Source manifest: ${figmaManifest}`,
    `- Implementation screenshots: ${implDir}`,
    `- Ingest output: ${ingestOut}`,
    `- Figdiff manifest: ${join(ingestOut, "figdiff-manifest.json")}`,
    "",
    "| 何 | 期待 | 実測 | 一致 |",
    "|---|---|---|---|",
    "| mock images API | node id ごとの download URL を返す | 2 page 分を返却 | yes |",
    "| PNG download | figma PNG を保存する | `top-pc.png`, `contact-sp.png` を保存 | yes |",
    "| manifest join | figma/impl/meta を持つ 2 page manifest を生成 | `figdiff-manifest.json` 生成 | yes |",
    "",
  ];
  await writeFile(summaryOut, lines.join("\n"));
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(ERROR_EXIT_CODE);
}

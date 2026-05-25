#!/usr/bin/env node
/**
 * sample-project-lp の capture -> Figma ingest -> eval を 1 コマンドで実行する。
 *
 * 実 Figma token / node mapping がない時は validate-only で実装 screenshot と
 * manifest の名前対応だけを検証する。
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ARG_PREFIX_LENGTH = 2;
const ERROR_EXIT_CODE = 2;
const SUCCESS_EXIT_CODE = 0;
const PLACEHOLDER_PATTERN = /REPLACE_/u;
const repoDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const options = parseArgs(process.argv.slice(ARG_PREFIX_LENGTH));
const lpRepo = resolve(requiredOption(options, "lp-repo"));
const figmaManifest = resolve(
  optionalString(
    options,
    "figma-manifest",
    join(repoDir, "verification/fixtures/sample-project-lp-figma-pages.template.json"),
  ),
);
const outDir = resolve(optionalString(options, "out", "/tmp/sample-project-lp-figma-smoke"));
const realRun = Boolean(options.real);
const mockFigmaApi = Boolean(options["mock-figma-api"]);
const explicitValidateOnly = Boolean(options["validate-only"]);
const skipInstall = Boolean(options["skip-install"]);
const skipBuild = Boolean(options["skip-build"]);
const tokenEnv = optionalString(options, "token-env", "FIGMA_TOKEN");
const capturePages = optionalString(options, "pages", null);
const captureDir = join(outDir, "capture");
const figmaDir = join(outDir, "figma");
const evalJson = join(outDir, "eval.json");
const evalMd = join(outDir, "eval.md");
const summaryPath = join(outDir, "summary.md");
const readinessMd = join(outDir, "readiness.md");
const readinessJson = join(outDir, "readiness.json");
let readinessBlocked = false;

validateDirectory(lpRepo, "--lp-repo");
validateFile(figmaManifest, "--figma-manifest");
const placeholderPages = await findPlaceholderPages(figmaManifest);
if ((mockFigmaApi || explicitValidateOnly) && placeholderPages.length > 0) {
  fail(
    `Figma manifest contains placeholder values: ${placeholderPages.join(", ")}. ` +
      "Replace REPLACE_* file keys/node IDs before running real or mock API smoke.",
  );
}
if (realRun && mockFigmaApi) {
  fail("--real and --mock-figma-api are mutually exclusive.");
}
const modeFlags = [realRun, mockFigmaApi, explicitValidateOnly].filter(Boolean).length;
if (modeFlags !== 1) {
  fail("You must specify exactly one mode: --real, --mock-figma-api, or --validate-only.");
}
await mkdir(outDir, { recursive: true });
let mockServer = null;
let mockApiBase = null;

if (realRun) {
  const readinessArgs = [
    join(repoDir, "scripts/eval/sample-project-lp-figma-readiness.mjs"),
    "--lp-repo",
    lpRepo,
    "--figma-manifest",
    figmaManifest,
    "--token-env",
    tokenEnv,
    "--out",
    readinessMd,
    "--json-out",
    readinessJson,
  ];
  try {
    await run("node", readinessArgs);
  } catch {
    readinessBlocked = true;
    await writeSummary();
    process.stdout.write(`Summary: ${summaryPath}\n`);
    process.stderr.write(
      `Readiness blocked real mode. Evidence: ${readinessMd} / ${readinessJson}\n`,
    );
    process.exit(ERROR_EXIT_CODE);
  }
}

const captureArgs = [
  join(repoDir, "scripts/eval/capture-lp-screenshots.mjs"),
  "--repo",
  lpRepo,
  "--out",
  captureDir,
];
if (skipInstall) {
  captureArgs.push("--skip-install");
}
if (capturePages) {
  captureArgs.push("--pages", capturePages);
}
try {
  await run("node", captureArgs);

  if (mockFigmaApi) {
    mockServer = createMockFigmaServer();
    const { port } = await listen(mockServer);
    mockApiBase = `http://127.0.0.1:${port}/v1`;
  }

  const ingestArgs = [
    join(repoDir, "scripts/eval/ingest-figma-pages.mjs"),
    "--figma-manifest",
    figmaManifest,
    "--out",
    figmaDir,
    "--impl-dir",
    join(captureDir, "impl"),
    "--token-env",
    tokenEnv,
  ];
  if (mockFigmaApi) {
    ingestArgs.push("--token", "mock-token", "--api-base", mockApiBase);
  } else if (explicitValidateOnly) {
    ingestArgs.push("--validate-only");
  }
  await run("node", ingestArgs);

  if (realRun) {
    if (!skipBuild) {
      await run("pnpm", ["--filter", "@figdiff/shared", "build"]);
      await run("pnpm", ["--filter", "@figdiff/mcp-server", "build"]);
    }
    await run("node", [join(repoDir, "scripts/eval/figdiff-cluster-bench.mjs")], {
      env: {
        ...process.env,
        FIGDIFF_MANIFEST: join(figmaDir, "figdiff-manifest.json"),
        FIGDIFF_OUT: evalJson,
        FIGDIFF_MD_OUT: evalMd,
      },
    });
  }
} finally {
  if (mockServer) {
    await close(mockServer);
  }
}

await writeSummary();
process.stdout.write(`Summary: ${summaryPath}\n`);

function parseArgs(args) {
  const parsed = {};
  const normalized = args[0] === "--" ? args.slice(1) : args;
  for (let index = 0; index < normalized.length; index += 1) {
    const arg = normalized[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(ARG_PREFIX_LENGTH);
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

function requiredOption(options, key) {
  if (!options[key] || options[key] === true) {
    fail(`--${key} is required`);
  }
  return String(options[key]);
}

function optionalString(options, key, fallback) {
  if (!options[key]) {
    return fallback;
  }
  if (options[key] === true) {
    fail(`--${key} requires a value`);
  }
  return String(options[key]);
}

function validateDirectory(path, label) {
  if (!existsSync(path)) {
    fail(`${label} directory not found: ${path}`);
  }
}

function validateFile(path, label) {
  if (!existsSync(path)) {
    fail(`${label} file not found: ${path}`);
  }
}

async function findPlaceholderPages(manifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!Array.isArray(manifest.pages)) {
    return [];
  }
  return manifest.pages
    .filter((page) => {
      if (!page || typeof page !== "object") {
        return false;
      }
      return ["figma_url", "file_key", "node_id"].some((key) =>
        PLACEHOLDER_PATTERN.test(String(page[key] ?? "")),
      );
    })
    .map((page, index) => String(page.name ?? `index-${index}`));
}

async function run(command, args, options = {}) {
  process.stdout.write(`$ ${[command, ...args].join(" ")}\n`);
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: repoDir,
      stdio: "inherit",
      shell: process.platform === "win32",
      ...options,
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

function createMockFigmaServer() {
  return createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname.startsWith("/v1/images/")) {
      const ids = String(url.searchParams.get("ids") ?? "")
        .split(",")
        .filter(Boolean);
      const port = serverAddressPort(response);
      const images = Object.fromEntries(
        ids.map((id) => [id, `http://127.0.0.1:${port}/download/${encodeURIComponent(id)}.png`]),
      );
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ images }));
      return;
    }
    if (url.pathname.startsWith("/download/")) {
      response.writeHead(200, { "content-type": "image/png" });
      response.end(mockPngBytes());
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ err: `not found: ${url.pathname}` }));
  });
}

function serverAddressPort(response) {
  const port = response.socket?.localPort;
  if (!port) {
    fail("Mock Figma API port is unavailable.");
  }
  return port;
}

function mockPngBytes() {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64",
  );
}

async function listen(server) {
  return await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Mock Figma API address is unavailable."));
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

async function writeSummary() {
  const lines = [
    "# sample-project-lp Figma smoke",
    "",
    `- lp repo: ${lpRepo}`,
    `- figma manifest: ${figmaManifest}`,
    `- mode: ${modeName()}`,
    `- pages: ${capturePages ?? "(default)"}`,
    `- placeholder pages: ${placeholderPages.length}`,
    `- capture: ${captureDir}`,
    `- figma output: ${figmaDir}`,
  ];
  if (mockApiBase) {
    lines.push(`- mock API base: ${mockApiBase}`);
  }
  if (realRun) {
    lines.push(`- eval markdown: ${evalMd}`, `- eval json: ${evalJson}`);
    lines.push(`- readiness markdown: ${readinessMd}`);
    lines.push(`- readiness json: ${readinessJson}`);
    lines.push(`- readiness status: ${readinessBlocked ? "blocked" : "passed"}`);
  }
  lines.push("");
  await mkdir(dirname(summaryPath), { recursive: true });
  await writeFile(summaryPath, `${lines.join("\n")}\n`);
}

function modeName() {
  if (mockFigmaApi) {
    return "mock-figma-api";
  }
  return realRun ? "real" : "validate-only";
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(ERROR_EXIT_CODE);
}

#!/usr/bin/env node
/**
 * LP のスクリーンショットを取得し、designdiff eval 用 manifest を生成する補助スクリプト。
 *
 * 例:
 *   node script/eval/capture-lp-screenshots.mjs \
 *     --repo /path/to/sample-project-lp \
 *     --out /tmp/sample-project-lp-screenshots \
 *     --figma-dir /tmp/sample-project-lp-figma
 *
 * Figma PNG が未準備のときは --self-manifest で自己比較 manifest を生成し、
 * capture -> eval の動線だけを先に検証できる。
 */

import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";

const DEFAULT_PAGES = [
  { name: "top", path: "/" },
  { name: "contact", path: "/contact" },
  { name: "privacy-policy", path: "/privacy-policy" },
  { name: "terms-of-use", path: "/terms-of-use" },
  { name: "tokushoho", path: "/tokushoho" },
  { name: "account-deletion", path: "/account-deletion" },
];
const VIEWPORTS = [
  { suffix: "pc", width: 1440, height: 1200 },
  { suffix: "sp", width: 390, height: 844 },
];

const options = parseArgs(process.argv.slice(2));
const repoDir = resolve(requiredOption(options, "repo"));
const outDir = resolve(options.out ?? join(process.cwd(), "lp-screenshots"));
const implDir = resolve(outDir, "impl");
const figmaDir = options["figma-dir"] ? resolve(options["figma-dir"]) : null;
const selfManifest = Boolean(options["self-manifest"]);
const skipInstall = Boolean(options["skip-install"]);
const pages = options.pages ? parsePages(options.pages) : DEFAULT_PAGES;

validateRepo(repoDir);
await mkdir(implDir, { recursive: true });

if (!skipInstall && !existsSync(join(repoDir, "node_modules"))) {
  await runCommand(packageManagerInstallCommand(repoDir), { cwd: repoDir });
}
await runCommand(packageManagerCommand(repoDir, "run", "build"), { cwd: repoDir });

const port = await getFreePort();
const preview = spawnAstroPreview(repoDir, port);
const baseUrl = `http://127.0.0.1:${port}`;

try {
  await waitForServer(baseUrl);
  const captured = await capturePages({ baseUrl, implDir, pages });
  const manifests = await writeManifests({ captured, figmaDir, outDir, selfManifest });
  await writeSummary({ outDir, repoDir, baseUrl, captured, manifests });
  process.stdout.write(`Captured ${captured.length} screenshots into ${implDir}\n`);
  for (const [name, file] of Object.entries(manifests)) {
    process.stdout.write(`${name}: ${file}\n`);
  }
} finally {
  preview.kill("SIGTERM");
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const next = args[index + 1];
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
    throw new Error(`--${key} is required`);
  }
  return String(options[key]);
}

function validateRepo(repoDir) {
  const packageJson = join(repoDir, "package.json");
  if (!existsSync(packageJson)) {
    throw new Error(`package.json not found in ${repoDir}`);
  }
}

function parsePages(value) {
  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, path = `/${name}`] = entry.split("=");
      return { name, path };
    });
}

function packageManagerCommand(repoDir, ...args) {
  if (existsSync(join(repoDir, "package-lock.json"))) {
    return ["npm", ...args];
  }
  if (existsSync(join(repoDir, "pnpm-lock.yaml"))) {
    return ["pnpm", ...args];
  }
  return ["npm", ...args];
}

function packageManagerInstallCommand(repoDir) {
  if (existsSync(join(repoDir, "package-lock.json"))) {
    return ["npm", "ci"];
  }
  if (existsSync(join(repoDir, "pnpm-lock.yaml"))) {
    return ["pnpm", "install", "--frozen-lockfile"];
  }
  return ["npm", "install"];
}

// astro の CLI 入口は version でファイル名が変わる (4/5 系は astro.js、6 系は bin/astro.mjs)。
// 固定パスだと preview サーバーが起動せず capture が timeout するので、package.json の bin から解決する。
function resolveAstroCli(repoDir) {
  const requireFromRepo = createRequire(join(repoDir, "package.json"));
  const astroPkgPath = requireFromRepo.resolve("astro/package.json");
  const astroPkg = requireFromRepo("astro/package.json");
  const binEntry = typeof astroPkg.bin === "string" ? astroPkg.bin : astroPkg.bin?.astro;
  if (binEntry) {
    return join(dirname(astroPkgPath), binEntry);
  }
  return join(repoDir, "node_modules/astro/astro.js");
}

function spawnAstroPreview(repoDir, port) {
  const child = spawn(
    process.execPath,
    [resolveAstroCli(repoDir), "preview", "--host", "127.0.0.1", "--port", String(port)],
    {
      cwd: repoDir,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

async function runCommand(command, options) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command[0], command.slice(1), {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => process.stdout.write(chunk));
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`${command.join(" ")} failed with exit code ${code}`));
    });
  });
}

async function getFreePort() {
  return await new Promise((resolvePromise, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolvePromise(address.port));
    });
  });
}

async function waitForServer(baseUrl) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 60_000) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) {
        return;
      }
    } catch {
      // preview サーバー起動待ち。
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error(`Timed out waiting for ${baseUrl}`);
}

async function capturePages({ baseUrl, implDir, pages }) {
  const browser = await chromium.launch();
  const captured = [];
  try {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      for (const target of pages) {
        const url = new URL(target.path, baseUrl).toString();
        await page.goto(url, { waitUntil: "load", timeout: 60000 });
        const fileName = `${target.name}-${viewport.suffix}.png`;
        const screenshotPath = join(implDir, fileName);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        captured.push({
          name: `${target.name}-${viewport.suffix}`,
          path: target.path,
          viewport,
          screenshot: screenshotPath,
        });
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  return captured;
}

async function writeManifests({ captured, figmaDir, outDir, selfManifest }) {
  const manifests = {};
  if (figmaDir) {
    const pages = captured.map((entry) => ({
      name: entry.name,
      figma: join(figmaDir, basename(entry.screenshot)),
      impl: entry.screenshot,
      meta: { path: entry.path, viewport: entry.viewport },
    }));
    const file = join(outDir, "figdiff-manifest.json");
    await writeFile(file, `${JSON.stringify({ pages }, null, 2)}\n`);
    manifests.figma = file;
  }

  if (selfManifest) {
    const pages = captured.map((entry) => ({
      name: entry.name,
      figma: entry.screenshot,
      impl: entry.screenshot,
      meta: { path: entry.path, viewport: entry.viewport, self_check: true },
    }));
    const file = join(outDir, "figdiff-self-manifest.json");
    await writeFile(file, `${JSON.stringify({ pages }, null, 2)}\n`);
    manifests.self = file;
  }

  if (!manifests.figma && !manifests.self) {
    const file = join(outDir, "figdiff-manifest.template.json");
    const pages = captured.map((entry) => ({
      name: entry.name,
      figma: `<figma-dir>/${basename(entry.screenshot)}`,
      impl: entry.screenshot,
      meta: { path: entry.path, viewport: entry.viewport },
    }));
    await writeFile(file, `${JSON.stringify({ pages }, null, 2)}\n`);
    manifests.template = file;
  }

  return manifests;
}

async function writeSummary({ outDir, repoDir, baseUrl, captured, manifests }) {
  const packageJson = JSON.parse(await readFile(join(repoDir, "package.json"), "utf8"));
  const lines = [
    "# LP screenshot capture summary",
    "",
    `- Repo: ${repoDir}`,
    `- Package: ${packageJson.name ?? "(unknown)"}`,
    `- Preview URL: ${baseUrl}`,
    `- Captured screenshots: ${captured.length}`,
    "",
    "| Name | Path | Viewport | Screenshot |",
    "|---|---|---:|---|",
  ];
  for (const entry of captured) {
    lines.push(
      `| ${entry.name} | ${entry.path} | ${entry.viewport.width}x${entry.viewport.height} | ${entry.screenshot} |`,
    );
  }
  lines.push("", "## Manifests", "");
  for (const [name, file] of Object.entries(manifests)) {
    lines.push(`- ${name}: ${file}`);
  }
  lines.push("");
  await writeFile(join(outDir, "capture-summary.md"), `${lines.join("\n")}\n`);
}

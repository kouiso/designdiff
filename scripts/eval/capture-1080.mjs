#!/usr/bin/env node
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import net from "node:net";
import { spawn } from "node:child_process";
import { join } from "node:path";

const LP_REPO = "/Users/kouiso/ghq/example-org/sample-project-lp";
const IMPL_DIR = "/tmp/sample-lp-real-smoke/capture/impl";
const WIDTH = 1083;

await mkdir(IMPL_DIR, { recursive: true });

const getFreePort = () =>
  new Promise((res) => {
    const s = net.createServer();
    s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); });
  });

const waitForServer = async (url, timeout = 30000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch { /* not ready yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timed out waiting for ${url}`);
};

const port = await getFreePort();
// spawn with array args so pnpm correctly passes "--" separator to astro
const preview = spawn("pnpm", ["run", "preview", "--host", "127.0.0.1", "--port", String(port)], {
  cwd: LP_REPO,
  stdio: ["ignore", "pipe", "pipe"],
});
preview.stderr.on("data", (c) => process.stderr.write(c));

const baseUrl = `http://127.0.0.1:${port}`;
await waitForServer(baseUrl);
console.log("server ready:", baseUrl);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 1200 } });
const page = await ctx.newPage();

const pages = [
  { name: "top-pc", path: "/" },
  { name: "contact-pc", path: "/contact" },
];

for (const p of pages) {
  await page.goto(`${baseUrl}${p.path}`, { waitUntil: "networkidle" });
  const outPath = join(IMPL_DIR, `${p.name}.png`);
  await page.screenshot({ path: outPath, fullPage: true });
  console.log("captured:", outPath);
}

await browser.close();
preview.kill();
console.log("done");

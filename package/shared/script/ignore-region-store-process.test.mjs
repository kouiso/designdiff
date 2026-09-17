import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

import { createIgnoreRegionStore } from "../dist/node/ignore-region-store.js";

const scriptPath = fileURLToPath(import.meta.url);

async function runChild(args) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`child exited with ${code}`));
    });
  });
}

async function runWorker(projectDir, regionId) {
  const store = createIgnoreRegionStore({
    getProjectDir: () => projectDir,
    assertProjectExists: async () => undefined,
  });
  await store.setIgnoreRegionConfig("project-1", [
    { id: regionId, x: 0, y: 0, width: 1, height: 1 },
  ]);
}

async function runMain() {
  const root = await mkdtemp(join(tmpdir(), "figdiff-ignore-process-"));
  try {
    const projectDir = join(root, "project-1");
    await mkdir(projectDir);
    await writeFile(join(projectDir, "project.json"), "{}", "utf-8");
    const staleLock = join(projectDir, "ignore-regions.yaml.lock");
    await mkdir(staleLock);
    await writeFile(join(staleLock, "owner.json"), JSON.stringify({ pid: 2_147_483_647 }), "utf-8");
    await Promise.all([
      runChild(["--worker", projectDir, "first"]),
      runChild(["--worker", projectDir, "second"]),
    ]);
    const parsed = parse(await readFile(join(projectDir, "ignore-regions.yaml"), "utf-8"));
    const ids = parsed.regions.map((entry) => entry.id).sort();
    if (JSON.stringify(ids) !== JSON.stringify(["first", "second"])) {
      throw new Error(`lost update after stale-lock recovery: ${JSON.stringify(ids)}`);
    }
    process.stdout.write("multiprocess stale-lock recovery: PASS\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const [, , mode, projectDir, regionId] = process.argv;
if (mode === "--worker") {
  if (!projectDir || !regionId) throw new Error("worker arguments missing");
  await runWorker(projectDir, regionId);
} else {
  await runMain();
}

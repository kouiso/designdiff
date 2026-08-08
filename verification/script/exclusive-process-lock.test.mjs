import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";

import {
  acquireExclusiveProcessLock,
  runWithExclusiveProcessLock,
} from "./exclusive-process-lock.mjs";

const WORKER = path.join(import.meta.dirname, "exclusive-process-lock-worker.mjs");
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function spawnWorker(lockPath, bundlePath, contents, holdMilliseconds) {
  const child = spawn(
    process.execPath,
    [WORKER, lockPath, bundlePath, contents, String(holdMilliseconds)],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const completed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  return { child, completed, stdout: () => stdout };
}

async function waitForOutput(worker, expected) {
  const deadline = Date.now() + 5_000;
  while (!worker.stdout().includes(expected)) {
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for worker output: ${worker.stdout()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("a concurrent process is rejected without changing the successful bundle", async () => {
  const temporaryDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "figdiff-exclusive-process-lock-test-"),
  );
  temporaryDirectories.push(temporaryDirectory);
  const lockPath = path.join(temporaryDirectory, "issue-1579.lock");
  const bundlePath = path.join(temporaryDirectory, "bundle.txt");
  const first = spawnWorker(lockPath, bundlePath, "successful-bundle\n", 600);

  await waitForOutput(first, "LOCKED\n");
  const bundleBeforeContention = await fs.readFile(bundlePath);
  const bundleBeforeSha256 = sha256(bundleBeforeContention);

  const second = spawnWorker(lockPath, bundlePath, "intruding-bundle\n", 0);
  const secondResult = await second.completed;
  assert.equal(secondResult.code, 73);
  assert.equal(secondResult.signal, null);
  assert.match(secondResult.stderr, /held by another process/);

  const firstResult = await first.completed;
  assert.equal(firstResult.code, 0);
  assert.equal(firstResult.signal, null);
  const bundleAfterContention = await fs.readFile(bundlePath);
  assert.equal(bundleAfterContention.toString("utf8"), "successful-bundle\n");
  assert.equal(sha256(bundleAfterContention), bundleBeforeSha256);
});

test("a thrown exception releases only the acquired lock", async () => {
  const temporaryDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "figdiff-exclusive-process-lock-test-"),
  );
  temporaryDirectories.push(temporaryDirectory);
  const lockPath = path.join(temporaryDirectory, "exception.lock");
  await assert.rejects(
    runWithExclusiveProcessLock(
      {
        repositoryRoot: temporaryDirectory,
        task: "exception-release",
        lockPath,
      },
      async () => {
        throw new Error("intentional callback failure");
      },
    ),
    /intentional callback failure/,
  );
  await assert.rejects(fs.access(lockPath), { code: "ENOENT" });
});

test("SIGTERM keeps the lock through callback cleanup and releases it before exit", async () => {
  const temporaryDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "figdiff-exclusive-process-lock-test-"),
  );
  temporaryDirectories.push(temporaryDirectory);
  const lockPath = path.join(temporaryDirectory, "signal.lock");
  const bundlePath = path.join(temporaryDirectory, "signal-bundle.txt");
  const worker = spawnWorker(lockPath, bundlePath, "signal-owner\n", 300);

  await waitForOutput(worker, "LOCKED\n");
  worker.child.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 30));
  await fs.access(lockPath);
  const result = await worker.completed;
  assert.equal(result.code, 143);
  assert.equal(result.signal, null);
  await assert.rejects(fs.access(lockPath), { code: "ENOENT" });
});

test("a dead PID lock is reclaimed while a mismatched release token is preserved", async () => {
  const temporaryDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "figdiff-exclusive-process-lock-test-"),
  );
  temporaryDirectories.push(temporaryDirectory);
  const lockPath = path.join(temporaryDirectory, "stale.lock");
  const staleMetadata = {
    schemaVersion: 1,
    pid: 2_147_483_647,
    processStartTime: "Thu Jan  1 00:00:00 1970",
    processStartTimeSource: "ps",
    ownerToken: "stale-owner-token",
    repositoryRoot: temporaryDirectory,
    task: "stale-recovery",
    acquiredAt: "2026-01-01T00:00:00.000Z",
  };
  await fs.writeFile(lockPath, `${JSON.stringify(staleMetadata)}\n`, "utf8");

  const lock = await acquireExclusiveProcessLock({
    repositoryRoot: temporaryDirectory,
    task: "stale-recovery",
    lockPath,
  });
  const foreignMetadata = {
    ...lock.metadata,
    ownerToken: "foreign-owner-token",
  };
  await fs.writeFile(lockPath, `${JSON.stringify(foreignMetadata)}\n`, "utf8");
  assert.equal(await lock.release(), false);
  const persisted = JSON.parse(await fs.readFile(lockPath, "utf8"));
  assert.equal(persisted.ownerToken, "foreign-owner-token");
});

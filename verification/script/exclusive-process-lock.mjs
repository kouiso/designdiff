import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const LOCK_SCHEMA_VERSION = 1;
const MAX_LOCK_BYTES = 16 * 1024;

export class ProcessLockError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ProcessLockError";
    this.details = details;
  }
}

function readProcessStartTime(pid) {
  try {
    const output = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return output || null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

function validateMetadata(value, lockPath) {
  if (
    value?.schemaVersion !== LOCK_SCHEMA_VERSION ||
    !Number.isSafeInteger(value.pid) ||
    value.pid <= 0 ||
    typeof value.processStartTime !== "string" ||
    value.processStartTime.length === 0 ||
    !["ps", "node-uptime-estimate"].includes(value.processStartTimeSource) ||
    typeof value.ownerToken !== "string" ||
    value.ownerToken.length === 0 ||
    typeof value.repositoryRoot !== "string" ||
    value.repositoryRoot.length === 0 ||
    typeof value.task !== "string" ||
    value.task.length === 0 ||
    typeof value.acquiredAt !== "string" ||
    Number.isNaN(Date.parse(value.acquiredAt))
  ) {
    throw new ProcessLockError(`refusing to replace an invalid process lock: ${lockPath}`, {
      lockPath,
    });
  }
  return value;
}

async function readMetadata(lockPath) {
  const handle = await fs.open(lockPath, "r");
  try {
    const stat = await handle.stat();
    if (stat.size > MAX_LOCK_BYTES) {
      throw new ProcessLockError(`refusing to read an oversized process lock: ${lockPath}`, {
        lockPath,
        size: stat.size,
      });
    }
    const contents = await handle.readFile("utf8");
    let parsed;
    try {
      parsed = JSON.parse(contents);
    } catch {
      throw new ProcessLockError(`refusing to replace a malformed process lock: ${lockPath}`, {
        lockPath,
      });
    }
    return {
      metadata: validateMetadata(parsed, lockPath),
      stat,
    };
  } finally {
    await handle.close();
  }
}

function classifyOwner(metadata) {
  if (!isProcessAlive(metadata.pid)) {
    return { active: false, reason: "pid-not-running" };
  }
  if (metadata.processStartTimeSource === "node-uptime-estimate") {
    return {
      active: true,
      reason: "live-pid-with-fail-closed-start-time-estimate",
    };
  }
  const actualStartTime = readProcessStartTime(metadata.pid);
  if (actualStartTime === null) {
    return {
      active: true,
      reason: "live-pid-start-time-unavailable",
    };
  }
  if (actualStartTime !== metadata.processStartTime) {
    return {
      active: false,
      reason: "pid-reused",
      actualStartTime,
    };
  }
  return { active: true, reason: "pid-and-start-time-match" };
}

async function pathExists(filename) {
  try {
    await fs.lstat(filename);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function sameInode(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function unlinkIfTokenMatches(filename, ownerToken) {
  let current;
  try {
    current = await readMetadata(filename);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  if (current.metadata.ownerToken !== ownerToken) return false;
  await fs.unlink(filename);
  return true;
}

async function createLockFile(lockPath, metadata) {
  const handle = await fs.open(lockPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(metadata)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function recoverClaim(lockPath, claimPath, metadata) {
  const claim = await readMetadata(claimPath);
  if (claim.metadata.ownerToken !== metadata.ownerToken) {
    throw new ProcessLockError(`process lock recovery owner changed: ${claimPath}`, {
      lockPath,
      claimPath,
    });
  }
  const owner = classifyOwner(claim.metadata);
  if (owner.active) {
    throw new ProcessLockError(`process lock is held by a live process: ${lockPath}`, {
      lockPath,
      owner: claim.metadata,
      ownerStatus: owner,
    });
  }

  try {
    const current = await readMetadata(lockPath);
    if (sameInode(current.stat, claim.stat)) {
      await fs.unlink(lockPath);
    } else {
      const currentOwner = classifyOwner(current.metadata);
      if (currentOwner.active) {
        await unlinkIfTokenMatches(claimPath, claim.metadata.ownerToken);
        throw new ProcessLockError(`process lock is held by a live process: ${lockPath}`, {
          lockPath,
          owner: current.metadata,
          ownerStatus: currentOwner,
        });
      }
      throw new ProcessLockError(`process lock changed during stale recovery: ${lockPath}`, {
        lockPath,
      });
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function heldLockError(lockPath, current) {
  return new ProcessLockError(`process lock is held by another process: ${lockPath}`, {
    lockPath,
    owner: current.metadata,
    ownerStatus: classifyOwner(current.metadata),
  });
}

async function acquireThroughRecoveryClaim(lockPath, claimPath, metadata) {
  const claim = await readMetadata(claimPath);
  await recoverClaim(lockPath, claimPath, claim.metadata);
  try {
    await createLockFile(lockPath, metadata);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const current = await readMetadata(lockPath);
    await unlinkIfTokenMatches(claimPath, claim.metadata.ownerToken);
    throw heldLockError(lockPath, current);
  }
  await unlinkIfTokenMatches(claimPath, claim.metadata.ownerToken);
}

async function assertNoRecoveryClaimAfterAcquisition(lockPath, claimPath, metadata) {
  if (!(await pathExists(claimPath))) return;
  const claim = await readMetadata(claimPath);
  if (claim.metadata.ownerToken !== metadata.ownerToken) {
    await unlinkIfTokenMatches(lockPath, metadata.ownerToken);
    throw new ProcessLockError(`process lock recovery raced with acquisition: ${lockPath}`, {
      lockPath,
    });
  }
  await unlinkIfTokenMatches(claimPath, metadata.ownerToken);
}

async function createRecoveryClaim(lockPath, claimPath, current) {
  try {
    await fs.link(lockPath, claimPath);
  } catch (error) {
    if (error?.code === "EEXIST" || error?.code === "ENOENT") return;
    throw error;
  }
  const claim = await readMetadata(claimPath);
  if (
    !sameInode(current.stat, claim.stat) ||
    claim.metadata.ownerToken !== current.metadata.ownerToken
  ) {
    await unlinkIfTokenMatches(claimPath, claim.metadata.ownerToken);
    throw new ProcessLockError(`process lock changed before stale recovery: ${lockPath}`, {
      lockPath,
    });
  }
}

async function acquireLockFile(lockPath, metadata) {
  const claimPath = `${lockPath}.recovery`;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (await pathExists(claimPath)) {
      await acquireThroughRecoveryClaim(lockPath, claimPath, metadata);
      return;
    }

    try {
      await createLockFile(lockPath, metadata);
      await assertNoRecoveryClaimAfterAcquisition(lockPath, claimPath, metadata);
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }

    if (await pathExists(claimPath)) continue;
    const current = await readMetadata(lockPath);
    const owner = classifyOwner(current.metadata);
    if (owner.active) {
      throw heldLockError(lockPath, current);
    }
    await createRecoveryClaim(lockPath, claimPath, current);
  }

  throw new ProcessLockError(`process lock acquisition did not converge: ${lockPath}`, {
    lockPath,
  });
}

export function resolveTaskLockPath(repositoryRoot, task) {
  const normalizedRoot = path.resolve(repositoryRoot);
  const digest = createHash("sha256")
    .update(normalizedRoot)
    .update("\0")
    .update(task)
    .digest("hex");
  return path.join(os.tmpdir(), "figdiff-exclusive-locks", `${digest}.lock`);
}

export const acquireExclusiveProcessLock = async ({ repositoryRoot, task, lockPath }) => {
  const resolvedLockPath = lockPath ?? resolveTaskLockPath(repositoryRoot, task);
  const observedProcessStartTime = readProcessStartTime(process.pid);
  const processStartTimeSource = observedProcessStartTime === null ? "node-uptime-estimate" : "ps";
  const processStartTime =
    observedProcessStartTime ??
    new Date(Date.now() - Math.floor(process.uptime() * 1_000)).toISOString();
  const metadata = {
    schemaVersion: LOCK_SCHEMA_VERSION,
    pid: process.pid,
    processStartTime,
    processStartTimeSource,
    ownerToken: randomUUID(),
    repositoryRoot: path.resolve(repositoryRoot),
    task,
    acquiredAt: new Date().toISOString(),
  };

  await fs.mkdir(path.dirname(resolvedLockPath), { recursive: true });
  await acquireLockFile(resolvedLockPath, metadata);

  let released = false;
  let releasePromise;
  return {
    lockPath: resolvedLockPath,
    metadata,
    release: async () => {
      if (released) return false;
      if (releasePromise) return releasePromise;
      releasePromise = (async () => {
        const removed = await unlinkIfTokenMatches(resolvedLockPath, metadata.ownerToken);
        released = true;
        return removed;
      })();
      try {
        return await releasePromise;
      } finally {
        if (!released) releasePromise = undefined;
      }
    },
  };
};

export const runWithExclusiveProcessLock = async (options, callback) => {
  const lock = await acquireExclusiveProcessLock(options);
  const abortController = new AbortController();
  let pendingSignalExitCode;
  const signalHandlers = new Map();

  for (const [signal, exitCode] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ]) {
    const handler = () => {
      pendingSignalExitCode ??= exitCode;
      if (!abortController.signal.aborted) {
        abortController.abort(new Error(`received ${signal}`));
      }
    };
    signalHandlers.set(signal, handler);
    process.once(signal, handler);
  }

  let callbackFailed = false;
  let callbackResult;
  let callbackError;
  let releaseError;
  try {
    callbackResult = await callback(lock, abortController.signal);
  } catch (error) {
    callbackFailed = true;
    callbackError = error;
  } finally {
    for (const [signal, handler] of signalHandlers) {
      process.removeListener(signal, handler);
    }
    try {
      await lock.release();
    } catch (error) {
      if (callbackFailed) {
        process.emitWarning(error);
      } else {
        releaseError = error;
      }
    }
    if (pendingSignalExitCode !== undefined) {
      process.exit(pendingSignalExitCode);
    }
  }
  if (callbackFailed) throw callbackError;
  if (releaseError) throw releaseError;
  return callbackResult;
};

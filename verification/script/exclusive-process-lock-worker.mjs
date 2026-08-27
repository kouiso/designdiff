import * as fs from "node:fs/promises";

import { ProcessLockError, runWithExclusiveProcessLock } from "./exclusive-process-lock.mjs";

const [lockPath, bundlePath, contents, holdMilliseconds] = process.argv.slice(2);

const waitForHoldOrRelease = async (holdMs, signal) => {
  await new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(), Number(holdMs));
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.stdin.removeListener("data", onData);
      signal.removeEventListener("abort", onAbort);
      process.stdin.pause();
      resolve();
    };
    const onData = (chunk) => {
      if (String(chunk).includes("RELEASE")) finish();
    };
    const onAbort = () => {
      process.stdout.write("ABORTED\n", (error) => {
        if (error) reject(error);
      });
    };
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", onData);
    process.stdin.resume();
    signal.addEventListener("abort", onAbort, { once: true });
  });
};

try {
  await runWithExclusiveProcessLock(
    {
      repositoryRoot: import.meta.dirname,
      task: "exclusive-process-lock-regression",
      lockPath,
    },
    async (_lock, signal) => {
      await fs.writeFile(bundlePath, contents, "utf8");
      await new Promise((resolve, reject) => {
        process.stdout.write("LOCKED\n", (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      await waitForHoldOrRelease(holdMilliseconds, signal);
    },
  );
} catch (error) {
  if (error instanceof ProcessLockError) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 73;
  } else {
    throw error;
  }
}

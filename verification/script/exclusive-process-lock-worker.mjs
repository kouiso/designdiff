import * as fs from "node:fs/promises";

import { ProcessLockError, runWithExclusiveProcessLock } from "./exclusive-process-lock.mjs";

const [lockPath, bundlePath, contents, holdMilliseconds] = process.argv.slice(2);

try {
  await runWithExclusiveProcessLock(
    {
      repositoryRoot: import.meta.dirname,
      task: "exclusive-process-lock-regression",
      lockPath,
    },
    async () => {
      await fs.writeFile(bundlePath, contents, "utf8");
      await new Promise((resolve, reject) => {
        process.stdout.write("LOCKED\n", (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      await new Promise((resolve) => setTimeout(resolve, Number(holdMilliseconds)));
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

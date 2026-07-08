import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface RunFlutterGoldenOptions {
  testTarget: string;
  flutterProjectDir: string;
  goldenRelativePath: string;
}

function createFlutterFailureMessage(stderr: string, error: Error): string {
  const trimmedStderr = stderr.trim();
  if (trimmedStderr.length > 0) {
    return `flutter test --update-goldens failed: ${trimmedStderr}`;
  }
  return `flutter test --update-goldens failed: ${error.message}`;
}

async function execFlutterGolden(testTarget: string, flutterProjectDir: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile(
      "flutter",
      ["test", "--update-goldens", testTarget],
      { cwd: flutterProjectDir, maxBuffer: 10 * 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(createFlutterFailureMessage(String(stderr), error)));
          return;
        }
        resolve();
      },
    );
  });
}

export async function runFlutterGolden(opts: RunFlutterGoldenOptions): Promise<string> {
  await execFlutterGolden(opts.testTarget, opts.flutterProjectDir);

  const goldenPath = path.resolve(opts.flutterProjectDir, opts.goldenRelativePath);
  try {
    await fs.access(goldenPath);
  } catch {
    throw new Error(`Flutter golden PNG was not found after test run: ${goldenPath}`);
  }

  return goldenPath;
}

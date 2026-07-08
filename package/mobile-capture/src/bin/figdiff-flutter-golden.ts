#!/usr/bin/env node
import { runFlutterGolden } from "../flutter-golden.js";

interface CliOptions {
  testTarget: string;
  flutterProjectDir: string;
  goldenRelativePath: string;
}

function readRequiredValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function parseArgs(args: string[]): CliOptions {
  let testTarget: string | undefined;
  let flutterProjectDir: string | undefined;
  let goldenRelativePath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--test":
        testTarget = readRequiredValue(args, index, arg);
        index += 1;
        break;
      case "--project-dir":
        flutterProjectDir = readRequiredValue(args, index, arg);
        index += 1;
        break;
      case "--golden":
        goldenRelativePath = readRequiredValue(args, index, arg);
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!testTarget || !flutterProjectDir || !goldenRelativePath) {
    throw new Error(
      "Usage: figdiff-flutter-golden --test <testTarget> --project-dir <flutterProjectDir> --golden <goldenRelativePath>",
    );
  }

  return { testTarget, flutterProjectDir, goldenRelativePath };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const goldenPath = await runFlutterGolden(opts);
  process.stdout.write(`${goldenPath}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

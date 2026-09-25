// round-2 runner 骨子: generate-runs-manifest.mjs が出した plan を読み、
// 各 driver を順に実行して assemble-campaign-ledger.mjs が食べられる
// runs-manifest.json を書き出す。
//
// usage:
//   node script/run-campaign-round.mjs --manifest docs/evidence/runs-linux-wsl-r2.json \
//     [--only <driver-substring>] [--dry-run] [--skip-missing-deps]
//
// 動作:
//   - 各 entry について evidenceDir を作り、passEvidenceVia に従って
//     `node <driver> <dir>` または `env <VAR>=<dir> node <driver>` を実行する。
//   - desktop route の driver は linux 系ホストで xvfb-run -a を挟む。
//   - 成功した entry だけを `--manifest` の隣に `<manifest>.manifest.json` へ書く
//     (assembler は evidence 欠損で止まるため、失敗分は除外する)。
//   - 全試行は `<manifest>.attempts.json` に status/stdout末尾/stderr末尾つきで残す。
//
// 環境前提は host capability に依存するため、runner は required deps を
// 実行前に静的に報告するだけで、満たせない場合の実行可否判断は operator に委ねる。

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const usage = () => {
  process.stderr.write(
    [
      "usage: node script/run-campaign-round.mjs --manifest <runs-plan.json> \\",
      "  [--only <driver-substring>] [--dry-run]",
    ].join("\n") + "\n",
  );
};

const parseArgs = (argv) => {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i].replace(/^--/, "");
    if (key === "dry-run") {
      args[key] = true;
      continue;
    }
    args[key] = argv[i + 1];
    i += 1;
  }
  return args;
};

const tail = (text, lines = 40) => text.split("\n").slice(-lines).join("\n").slice(-8000);

const runDriver = async (entry, platform) => {
  const driverPath = join(root, entry.driver);
  const evidenceDir = isAbsolute(entry.evidenceDir)
    ? entry.evidenceDir
    : resolve(root, entry.evidenceDir);
  await mkdir(evidenceDir, { recursive: true });
  const env = { ...process.env };
  const argv = [driverPath];
  if (entry.passEvidenceVia?.startsWith("env:")) {
    env[entry.passEvidenceVia.slice(4)] = evidenceDir;
  } else {
    argv.push(evidenceDir);
  }
  // linux 系ホストでは desktop driver に仮想 display が要る。
  const needsDisplay = entry.requires?.includes("display-or-xvfb");
  const command =
    needsDisplay && process.platform === "linux" && !process.env.DISPLAY
      ? ["xvfb-run", "-a", process.execPath, ...argv]
      : [process.execPath, ...argv];
  const result = spawnSync(command[0], command.slice(1), {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 1_800_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  const evidenceFile = join(evidenceDir, entry.evidenceFile ?? "evidence.json");
  const evidenceExists = existsSync(evidenceFile);
  let buildDigest = "";
  if (evidenceExists) {
    try {
      const evidence = JSON.parse(await readFile(evidenceFile, "utf8"));
      buildDigest = evidence.build?.sha256 ?? evidence.product?.buildDigest ?? "";
    } catch (error) {
      process.stderr.write(
        `warning: ${entry.driver} evidence unreadable: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }
  return {
    status: result.status === 0 && evidenceExists ? "ok" : "failed",
    exitStatus: result.status,
    signal: result.signal ?? null,
    evidenceExists,
    buildDigest,
    stdoutTail: tail(result.stdout ?? ""),
    stderrTail: tail(result.stderr ?? ""),
  };
};

const main = async () => {
  const args = parseArgs(process.argv);
  if (!args.manifest) {
    usage();
    process.exitCode = 2;
    return;
  }
  const manifestPath = resolve(args.manifest);
  const plan = JSON.parse(await readFile(manifestPath, "utf8"));
  const entries = plan.entries.filter((entry) => !args.only || entry.driver.includes(args.only));
  process.stdout.write(
    `${JSON.stringify({ manifest: manifestPath, platform: plan.platform, round: plan.round, entries: entries.length, dryRun: args["dry-run"] === true })}\n`,
  );

  const attempts = [];
  const manifestEntries = [];
  for (const entry of entries) {
    process.stdout.write(`[driver] ${entry.driver}\n`);
    if (args["dry-run"] === true) {
      attempts.push({ driver: entry.driver, status: "dry-run", requires: entry.requires });
      continue;
    }
    const startedAt = new Date().toISOString();
    const outcome = await runDriver(entry, plan.platform);
    attempts.push({ driver: entry.driver, startedAt, ...outcome });
    process.stdout.write(
      `  -> ${outcome.status} (exit=${outcome.exitStatus} evidence=${outcome.evidenceExists})\n`,
    );
    if (outcome.status === "ok") {
      manifestEntries.push({
        driver: entry.driver,
        evidenceDir: entry.evidenceDir,
        ...(entry.evidenceFile ? { evidenceFile: entry.evidenceFile } : {}),
        executedAt: startedAt,
        environment: plan.platform,
        buildDigest: outcome.buildDigest,
        roundExecutionId: plan.roundExecutionId,
      });
    }
  }
  const stem = manifestPath.replace(/\.json$/, "");
  await writeFile(`${stem}.attempts.json`, `${JSON.stringify(attempts, null, 2)}\n`);
  await writeFile(`${stem}.manifest.json`, `${JSON.stringify(manifestEntries, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ attempted: attempts.length, succeeded: manifestEntries.length, manifestOut: `${stem}.manifest.json`, attemptsOut: `${stem}.attempts.json` })}\n`,
  );
};

await main();

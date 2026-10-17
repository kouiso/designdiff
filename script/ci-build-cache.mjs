import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

process.chdir(resolve(import.meta.dirname, ".."));
process.env.CI = "true";
const fail = (message) => {
  throw new Error(message);
};
const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const call = (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error || result.status !== 0)
    fail(result.error?.message || result.stderr || `${command} failed`);
  return result.stdout;
};
const identity = () => {
  for (const name of ["GITHUB_SHA", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"])
    if (!process.env[name]) fail(`${name} is required`);
  return {
    sha: process.env.GITHUB_SHA,
    run: process.env.GITHUB_RUN_ID,
    attempt: process.env.GITHUB_RUN_ATTEMPT,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    lock: digest("pnpm-lock.yaml"),
    tools: digest(".mise.toml"),
    turbo: digest("turbo.json"),
  };
};
const packages = () =>
  ["app", "package"].flatMap((parent) =>
    existsSync(parent)
      ? readdirSync(parent).flatMap((name) => {
          const path = `${parent}/${name}`;
          if (!existsSync(`${path}/package.json`)) return [];
          const manifest = JSON.parse(readFileSync(`${path}/package.json`, "utf8"));
          return manifest.scripts?.build
            ? [{ id: `${manifest.name}#build`, output: `${path}/dist` }]
            : [];
        })
      : [],
  );
const buildPlan = (expected) => {
  const plan = JSON.parse(call("pnpm", ["exec", "turbo", "run", "build", "--dry=json"]));
  const tasks = plan.tasks?.filter((task) => task.command !== "<NONEXISTENT>");
  if (!tasks?.length || tasks.length !== expected.length)
    fail("Unexpected Turbo build task closure");
  const expectedIds = new Set(expected.map((item) => item.id));
  const hashes = {};
  for (const task of tasks) {
    if (
      !expectedIds.delete(task.taskId) ||
      task.cache?.status !== "HIT" ||
      typeof task.hash !== "string" ||
      !task.hash
    )
      fail("Every declared build task must be a cache HIT");
    hashes[task.taskId] = task.hash;
  }
  if (expectedIds.size) fail("Missing build task");
  return Object.fromEntries(
    Object.entries(hashes).sort(([left], [right]) => left.localeCompare(right)),
  );
};
const rejectLinks = (path) => {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) fail(`Symlink is not allowed in build exchange: ${path}`);
  if (stat.isDirectory()) for (const name of readdirSync(path)) rejectLinks(`${path}/${name}`);
  else if (!stat.isFile()) fail(`Unsupported build output: ${path}`);
};
try {
  const mode = process.argv[2];
  if (mode !== "save" && mode !== "restore") fail("Expected save or restore");
  const current = identity();
  const expected = packages();
  if (!expected.length) fail("No declared build packages");
  const paths = [...expected.map((item) => item.output), ".turbo/cache"].sort();
  mkdirSync(".ci-build", { recursive: true });
  const archive = ".ci-build/payload.tar.gz";
  const manifestFile = ".ci-build/manifest.json";
  if (mode === "save") {
    // なぜ: build 以外の宣言や壊れた cache を別ジョブへ渡さない。
    const config = JSON.parse(readFileSync("turbo.json", "utf8"));
    if (JSON.stringify(config.tasks?.build?.outputs) !== JSON.stringify(["dist/**"]))
      fail("Build output declaration changed");
    const tasks = buildPlan(expected);
    for (const path of paths) rejectLinks(path);
    call("tar", ["-czf", archive, ...paths]);
    writeFileSync(
      manifestFile,
      `${JSON.stringify({ identity: current, paths, tasks, archive: digest(archive) })}\n`,
    );
  } else {
    const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
    if (
      JSON.stringify(manifest.identity) !== JSON.stringify(current) ||
      JSON.stringify(manifest.paths) !== JSON.stringify(paths) ||
      manifest.archive !== digest(archive)
    )
      fail("Build exchange identity, outputs or checksum mismatch");
    const entries = call("tar", ["-tzf", archive]).trim().split("\n");
    if (
      entries.some(
        (entry) =>
          entry.startsWith("/") ||
          entry.split("/").includes("..") ||
          !paths.some((path) => entry === path || entry.startsWith(`${path}/`)),
      )
    )
      fail("Unexpected archive member");
    if (
      call("tar", ["-tvzf", archive])
        .split("\n")
        .some((line) => line && !["-", "d"].includes(line[0]))
    )
      fail("Archive must contain only regular files and directories");
    for (const path of paths) if (existsSync(path)) rejectLinks(path);
    call("tar", ["-xzf", archive]);
    // なぜ: dist だけの復元では lint/test の暗黙の ^build が再実行される。
    if (JSON.stringify(buildPlan(expected)) !== JSON.stringify(manifest.tasks))
      fail("Restored build cache does not match producer task hashes");
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Build exchange failed"}\n`);
  process.exit(1);
}

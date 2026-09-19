// 台帳組立器: driver が吐いた evidence を campaign-ledger.json の run record へ変換する。
// 各 run は verify-campaign-evidence.mjs の requiredCampaignRuns キーに対応し、
// 期待・実測・oracle・証跡をケース単位で区別する。ここでは証跡の機械的整合だけを組み立て、
// 実測の意味判断は各 driver の独立 oracle が担った前提を変えない。

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { caseDescriptions, driverCoverage } from "./campaign-case-map.mjs";
import { requiredCampaignRuns } from "./verify-campaign-evidence.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const usage = () => {
  process.stderr.write(
    [
      "usage: node script/assemble-campaign-ledger.mjs \\",
      "  --sha <frozen product sha> --round <1|2> --platform <linux-wsl|windows|macos|repository> \\",
      "  --runs <runs-manifest.json> --out <ledger-dir> [--known-defects <registry.json>]",
      "",
      "runs-manifest.json: [{ driver, evidenceDir, executedAt, environment, buildDigest }]",
      "evidenceDir: driver が evidence.json を置いた dir (repo相対または絶対パス)",
    ].join("\n") + "\n",
  );
};

const parseArgs = (argv) => {
  const args = {};
  for (let i = 2; i < argv.length; i += 2) args[argv[i].replace(/^--/, "")] = argv[i + 1];
  return args;
};

// driver エントリの route 表記を ledger の必須経路名へ正規化する。
const normalizeRoute = (route) =>
  route === "x09-mcp" ? "mcp" : route === "x09-desktop" ? "desktop" : route;

// case+route+platform に対応する driverCoverage エントリを全て返す。
// 同一ケースへ複数 driver が別角度の証拠を出す構成を許す (X09 相互方向・
// M04 の合成+実Figma 等)。先勝ち1件にすると片側の検証が台帳から抜ける。
const providersFor = (caseId, route, platform) =>
  driverCoverage.filter(
    (entry) =>
      normalizeRoute(entry.route) === route &&
      entry.provides.includes(caseId) &&
      (entry.platforms ?? ["linux-wsl", "windows", "macos"]).includes(platform),
  );

// results のキーは `C04` または `C04_xxx` 形式 — 接頭辞でケースへ帰属させる。
const entriesForCase = (results, caseId) =>
  Object.entries(results ?? {}).filter(
    ([key]) => key === caseId || key.startsWith(`${caseId}_`),
  );

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const copyArtifact = async (source, targetDir, targetName) => {
  await mkdir(targetDir, { recursive: true });
  const target = join(targetDir, targetName);
  await copyFile(source, target);
  const bytes = await readFile(target);
  assert.ok(bytes.length > 0, `empty artifact ${target}`);
  return { path: target, sha256: sha256(bytes), bytes };
};

const assemble = async ({ sha, round, platform, runsPath, outDir, knownDefectsPath }) => {
  const runManifest = await readJson(resolve(runsPath));
  const knownDefectIds = new Set(
    knownDefectsPath
      ? (await readJson(resolve(knownDefectsPath))).map((d) => (typeof d === "string" ? d : d.id))
      : [],
  );
  const out = resolve(outDir);
  const roundRuns = requiredCampaignRuns.filter(
    (run) => run.round === round && run.platform === platform,
  );

  const evidenceByDriver = new Map();
  for (const entry of runManifest) {
    const dir = resolve(root, entry.evidenceDir);
    const evidencePath = join(dir, entry.evidenceFile ?? "evidence.json");
    evidenceByDriver.set(entry.driver, {
      manifest: entry,
      dir,
      evidencePath,
      evidence: await readJson(evidencePath),
    });
  }

  const ledgerDir = join(out, "ledger", platform, `round-${round}`);
  const records = [];
  const skipped = [];

  for (const required of roundRuns) {
    const providers = providersFor(required.case, required.route, platform);
    const requiredProviders = providers.filter((p) => !p.optional);
    const optionalProviders = providers.filter((p) => p.optional);
    if (requiredProviders.length === 0) {
      skipped.push({ ...required, reason: "no required driver coverage declared" });
      continue;
    }

    // 必須 provider は全て証跡必須。optional provider は証跡があれば併記する。
    const contributions = [];
    const missing = [];
    const failed = [];
    for (const provider of [...requiredProviders, ...optionalProviders]) {
      const bundle = evidenceByDriver.get(provider.driver);
      if (!bundle) {
        if (!provider.optional) missing.push(provider.driver);
        continue;
      }
      const entries = entriesForCase(bundle.evidence.results, required.case);
      if (entries.length === 0) {
        if (!provider.optional) missing.push(`${provider.driver} (no ${required.case}* entries)`);
        continue;
      }
      for (const [key, result] of entries) {
        const status =
          result?.status ??
          ((bundle.evidence.verificationFailures ?? []).includes(key) ? "FAIL" : "PASS");
        if (status !== "PASS") failed.push(`${provider.driver}:${key}`);
        else contributions.push({ provider, bundle, key, result });
      }
    }
    if (missing.length > 0) {
      skipped.push({ ...required, reason: `driver evidence missing: ${missing.join("; ")}` });
      continue;
    }
    if (failed.length > 0) {
      skipped.push({ ...required, reason: `driver checks failed: ${failed.join("; ")}` });
      continue;
    }

    const caseDir = join(ledgerDir, required.case, required.route);
    const description = caseDescriptions[required.case];
    assert.ok(description, `case description missing: ${required.case}`);

    const evidenceRefs = [];
    const actualByDriver = {};
    const expectedParts = [];
    const driverNames = [];
    const observedDefects = new Set();
    let buildDigest = "";
    let environment = "";
    let executedAt = "";
    let roundExecutionId = "";

    const idOf = (d) => (typeof d === "string" ? d : (d.id ?? JSON.stringify(d)));
    const copied = new Set();
    for (const { provider, bundle, key, result } of contributions) {
      const driverSlug = basename(provider.driver).replace(/\.mjs$/, "");
      const full = await copyArtifact(
        bundle.evidencePath,
        caseDir,
        `${driverSlug}-evidence.json`,
      );
      evidenceRefs.push(full);
      copied.add(bundle.evidencePath);
      // screenshot や manifest 等の副産物も case 証跡として収める。
      for (const extra of bundle.manifest.extraArtifacts ?? []) {
        const source = resolve(bundle.dir, extra);
        if (copied.has(source)) continue;
        const artifact = await copyArtifact(source, caseDir, `${driverSlug}-${basename(extra)}`);
        evidenceRefs.push(artifact);
        copied.add(source);
      }
      if (!driverNames.includes(provider.driver)) driverNames.push(provider.driver);
      actualByDriver[`${driverSlug}:${key}`] = result.actual ?? result;
      if (result.expected) expectedParts.push(`${key}: ${result.expected}`);
      for (const id of (Array.isArray(result.knownDefects) ? result.knownDefects : []).map(idOf))
        observedDefects.add(id);
      for (const d of Array.isArray(bundle.evidence.knownDefects) ? bundle.evidence.knownDefects : []) {
        if (typeof d === "object" && typeof d.observedIn === "string" && d.observedIn.split(".")[0] === required.case)
          observedDefects.add(idOf(d));
      }
      buildDigest ||= bundle.manifest.buildDigest ?? bundle.evidence.product?.buildDigest ?? "";
      environment ||= bundle.manifest.environment ?? platform;
      executedAt ||= bundle.manifest.executedAt ?? "";
      roundExecutionId ||= bundle.manifest.roundExecutionId ?? "";
    }

    const defectList = [...observedDefects];
    const newDefects = defectList.filter((id) => !knownDefectIds.has(id));
    if (newDefects.length > 0) {
      skipped.push({ ...required, reason: `uncatalogued defects observed: ${newDefects.join(",")}` });
      continue;
    }

    const slicePath = join(caseDir, `${required.case}-result.json`);
    await writeFile(
      slicePath,
      `${JSON.stringify({ case: required.case, route: required.route, platform, drivers: driverNames, checks: contributions.map((c) => c.key), actual: actualByDriver }, null, 2)}\n`,
    );
    const sliceBytes = await readFile(slicePath);
    evidenceRefs.push({ path: slicePath, sha256: sha256(sliceBytes) });

    records.push({
      case: required.case,
      round,
      platform,
      route: required.route,
      roundExecutionId: roundExecutionId || runManifest[0]?.roundExecutionId || "",
      executedAt,
      productSha: sha,
      dirty: false,
      status: "PASS",
      newBugs: 0,
      observedKnownDefects: defectList,
      buildDigest,
      environment,
      input: description.input,
      steps: `${description.steps} [drivers: ${driverNames.join(", ")}]`,
      expected: expectedParts.length > 0 ? expectedParts.join(" | ") : description.oracle.description,
      actual: JSON.stringify(actualByDriver),
      oracle: description.oracle,
      evidence: evidenceRefs.map((a) => ({
        path: relative(out, a.path).split(sep).join("/"),
        sha256: a.sha256,
      })),
    });
  }

  await mkdir(ledgerDir, { recursive: true });
  const partial = {
    version: 1,
    platform,
    round,
    productSha: sha,
    generatedAt: new Date().toISOString(),
    recordCount: records.length,
    records,
    skipped,
  };
  const outFile = join(ledgerDir, "records.json");
  await writeFile(outFile, `${JSON.stringify(partial, null, 2)}\n`);
  return { records, skipped, outFile, ledgerDir };
};

// 各 platform の partial records を統合し、rounds metadata と併せて最終台帳を出す。
// merge は records の並び替えだけを行い、内容の再評価は validator へ委ねる。
const mergePartials = async ({ ledgerRoot, sha, roundsPath, outFile }) => {
  const rootDir = resolve(ledgerRoot);
  const rounds = await readJson(resolve(roundsPath));
  const partialFiles = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name === "records.json") partialFiles.push(full);
    }
  };
  await walk(join(rootDir, "ledger"));
  const runs = [];
  for (const file of partialFiles.sort()) {
    const partial = await readJson(file);
    for (const record of partial.records ?? []) runs.push(record);
  }
  const ledger = {
    version: 1,
    productSha: sha,
    scope: "Final 49-case campaign, two rounds and mandatory platform routes. Pre-final recovery evidence is not a completed run.",
    rounds,
    runs,
  };
  const target = join(rootDir, outFile ?? "campaign-ledger.json");
  await writeFile(target, `${JSON.stringify(ledger, null, 2)}\n`);
  return { target, runCount: runs.length, partials: partialFiles.length };
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv);
  if (args.merge) {
    try {
      const result = await mergePartials({
        ledgerRoot: args.merge,
        sha: args.sha,
        roundsPath: args.rounds,
        outFile: args.out,
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
      process.exitCode = 1;
    }
  } else if (!args.sha || !args.round || !args.platform || !args.runs || !args.out) {
    usage();
    process.exitCode = 2;
  } else {
    try {
      const { records, skipped, outFile } = await assemble({
        sha: args.sha,
        round: Number(args.round),
        platform: args.platform,
        runsPath: args.runs,
        outDir: args.out,
        knownDefectsPath: args["known-defects"],
      });
      process.stdout.write(
        `${JSON.stringify({ outFile, records: records.length, skipped: skipped.length, skippedDetail: skipped }, null, 2)}\n`,
      );
      if (skipped.length > 0) process.exitCode = 1;
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
      process.exitCode = 1;
    }
  }
}

export { assemble };

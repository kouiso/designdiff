import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const platforms = ["linux-wsl", "windows", "macos"];
const cases = (prefix, count) =>
  Array.from({ length: count }, (_, i) => `${prefix}${String(i + 1).padStart(2, "0")}`);
const cross = (ids, routes, systems = platforms) =>
  ids.flatMap((id) =>
    systems.flatMap((platform) => routes.map((route) => ({ case: id, platform, route }))),
  );

// 対応している経路の前提不足をN/Aへ置き換えて、見かけの全件合格にしない。
export const requiredCampaignRuns = [
  ...cross(cases("C", 13), ["mcp", "desktop"]),
  ...cross(cases("M", 16), ["mcp"]),
  ...cross(cases("D", 10), ["desktop"]),
  ...cross(["X01", "X02"], ["chrome-extension"]),
  ...cross(["X03", "X04"], ["figma-plugin"]),
  ...cross(["X05", "X07"], ["android"]),
  // X07 の iOS 経路は OS 固有の非対応機能 (scroll 結合なし・明示拒否を X06 で検証)
  // のため spec 上の必須経路から除外する。test-specification.md の注記を参照。
  ...cross(["X06"], ["ios-simulator", "ios-device"], ["macos"]),
  ...cross(["X08"], ["mcp", "desktop", "chrome-extension", "figma-plugin"]),
  ...cross(["X09"], ["mcp", "desktop"]),
  ...cross(["X10"], ["dependency-graph"], ["repository"]),
].flatMap((run) => [1, 2].map((round) => ({ ...run, round })));

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const nonempty = (value) => typeof value === "string" && value.trim().length > 0;
const key = (run) => `${run.case}/${run.round}/${run.platform}/${run.route}`;
const digestPattern = /^[a-f0-9]{64}$/;
const shaPattern = /^[a-f0-9]{40}$/;
const oracleKinds = new Set([
  "source-pixels",
  "dom-geometry",
  "host-observation",
  "schema-contract",
  "dependency-graph",
]);

const checkRunMetadata = (run, productSha, rounds) => {
  const errors = [];
  if (run.productSha !== productSha) errors.push("product SHA differs");
  if (run.dirty !== false) errors.push("tested product is not clean");
  if (run.status !== "PASS") errors.push(run.status ?? "NOT RUN");
  if (run.newBugs !== 0) errors.push("new bug count must be zero");
  if (!digestPattern.test(run.buildDigest ?? "")) errors.push("build digest missing");
  for (const field of ["environment", "input", "steps", "expected", "actual"]) {
    if (!nonempty(run[field])) errors.push(`${field} missing`);
  }
  if (
    !isRecord(run.oracle) ||
    !oracleKinds.has(run.oracle.kind) ||
    !nonempty(run.oracle.description)
  ) {
    errors.push("independent oracle missing");
  }
  if (!Array.isArray(run.evidence) || run.evidence.length === 0) errors.push("evidence missing");
  const round = rounds.get(run.round);
  const executedAt = Date.parse(run.executedAt);
  if (!round || run.roundExecutionId !== round.executionId)
    errors.push("round execution reference differs");
  if (
    !Number.isFinite(executedAt) ||
    !round ||
    executedAt < Date.parse(round.startedAt) ||
    executedAt > Date.parse(round.finishedAt)
  ) {
    errors.push("execution time is outside its round");
  }
  return errors;
};

const checkRounds = (ledger) => {
  const errors = [];
  const rounds = new Map();
  if (!Array.isArray(ledger.rounds) || ledger.rounds.length !== 2)
    errors.push("Two execution round records are required");
  for (const round of Array.isArray(ledger.rounds) ? ledger.rounds : []) {
    if (!isRecord(round) || ![1, 2].includes(round.round)) {
      errors.push("Invalid round record");
      continue;
    }
    if (rounds.has(round.round)) errors.push("Duplicate round record");
    rounds.set(round.round, round);
    if (!nonempty(round.executionId)) errors.push(`Round ${round.round}: execution ID missing`);
    if (round.productSha !== ledger.productSha)
      errors.push(`Round ${round.round}: product SHA differs`);
    const start = Date.parse(round.startedAt);
    const finish = Date.parse(round.finishedAt);
    if (!Number.isFinite(start) || !Number.isFinite(finish) || finish <= start)
      errors.push(`Round ${round.round}: invalid execution interval`);
  }
  const first = rounds.get(1);
  const second = rounds.get(2);
  if (!first || !second) errors.push("Both execution rounds are required");
  else {
    if (first.executionId === second.executionId)
      errors.push("Rounds must have distinct execution IDs");
    if (Date.parse(second.startedAt) < Date.parse(first.finishedAt))
      errors.push("Round 2 must follow round 1");
  }
  return { errors, rounds };
};

const checkArtifact = async (item, root) => {
  if (
    !isRecord(item) ||
    !nonempty(item.path) ||
    isAbsolute(item.path) ||
    !digestPattern.test(item.sha256 ?? "")
  ) {
    return ["invalid evidence reference"];
  }
  try {
    const target = await realpath(resolve(root, item.path));
    const location = relative(root, target);
    if (location === ".." || location.startsWith(`..${sep}`) || isAbsolute(location)) {
      return ["evidence escapes durable directory"];
    }
    const bytes = await readFile(target);
    return bytes.length === 0 || createHash("sha256").update(bytes).digest("hex") !== item.sha256
      ? [`empty or changed evidence ${item.path}`]
      : [];
  } catch (error) {
    return [`evidence unreadable (${error instanceof Error ? error.message : String(error)})`];
  }
};

// これは台帳と証跡の整合検査であり、画像や動作の正しさを自動認定するものではない。
export const validateCampaignEvidence = async (ledger, evidenceDirectory) => {
  const errors = [];
  if (!isRecord(ledger)) return ["Ledger must be an object"];
  if (ledger.version !== 1) errors.push("Unsupported ledger version");
  if (!shaPattern.test(ledger.productSha ?? "")) errors.push("Final product SHA is not frozen");
  if (!Array.isArray(ledger.runs)) return [...errors, "runs must be an array"];
  const roundCheck = checkRounds(ledger);
  errors.push(...roundCheck.errors);
  const required = new Set(requiredCampaignRuns.map(key));
  const seen = new Set();
  const root = await realpath(evidenceDirectory);
  for (const run of ledger.runs) {
    if (!isRecord(run)) {
      errors.push("Run must be an object");
      continue;
    }
    const id = key(run);
    if (!required.has(id)) errors.push(`${id}: unsupported case/round/platform/route`);
    if (seen.has(id)) errors.push(`${id}: duplicate run`);
    seen.add(id);
    errors.push(
      ...checkRunMetadata(run, ledger.productSha, roundCheck.rounds).map(
        (error) => `${id}: ${error}`,
      ),
    );
    if (!Array.isArray(run.evidence)) continue;
    for (const item of run.evidence) {
      errors.push(...(await checkArtifact(item, root)).map((error) => `${id}: ${error}`));
    }
  }
  for (const id of required) if (!seen.has(id)) errors.push(`${id}: NOT RUN`);
  return errors;
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const ledgerPath = resolve(process.argv[2] ?? "docs/evidence/campaign-ledger.json");
    const errors = await validateCampaignEvidence(
      JSON.parse(await readFile(ledgerPath, "utf8")),
      dirname(ledgerPath),
    );
    process.stdout.write(
      `${JSON.stringify({ requiredRuns: requiredCampaignRuns.length, errors: errors.length, details: errors.slice(0, 20), scope: "ledger and artifact integrity only" }, null, 2)}\n`,
    );
    process.exitCode = errors.length > 0 ? 1 : 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

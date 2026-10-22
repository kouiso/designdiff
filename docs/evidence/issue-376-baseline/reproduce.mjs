import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import process from "node:process";
import { URL, pathToFileURL } from "node:url";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fixturePath = (directory, name) => {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error(`Invalid fixture filename in ${directory}`);
  }
  const file = resolve(directory, name);
  if (!file.startsWith(`${resolve(directory)}${sep}`)) {
    throw new Error(`Fixture path escapes its pair directory: ${file}`);
  }
  return file;
};

export const loadFixtureCases = async (fixtures, historicalCases) => {
  if (!Array.isArray(historicalCases) || historicalCases.length === 0) {
    throw new Error("Historical fixture inventory must not be empty");
  }
  const expectedPairs = [...new Set(historicalCases.map((entry) => entry.pair))].sort();
  const actualPairs = (await readdir(fixtures)).filter((name) => name.includes("hm-gate1")).sort();
  const missing = expectedPairs.filter((pair) => !actualPairs.includes(pair));
  const unexpected = actualPairs.filter((pair) => !expectedPairs.includes(pair));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `Incomplete Gate1 fixture inventory; missing manifests: ${missing.map((pair) => join(fixtures, pair, "expected.json")).join(", ")}; unexpected pairs: ${unexpected.join(", ")}`,
    );
  }
  const cases = [];
  for (const pair of expectedPairs) {
    const directory = join(fixtures, pair);
    const manifest = join(directory, "expected.json");
    const expectation = JSON.parse(await readFile(manifest, "utf8"));
    if (!Array.isArray(expectation.variants) || expectation.variants.length === 0) {
      throw new Error(`Missing or empty variants in ${manifest}`);
    }
    const expectedVariants = historicalCases.filter((entry) => entry.pair === pair);
    const names = expectation.variants.map((variant) => variant.name);
    if (
      new Set(names).size !== names.length ||
      names.length !== expectedVariants.length ||
      expectedVariants.some((entry) => !names.includes(entry.variant))
    ) {
      throw new Error(`Gate1 variant inventory differs from historical cases: ${manifest}`);
    }
    const design = await readFile(fixturePath(directory, expectation.figmaFrame));
    for (const variant of expectation.variants) {
      const historical = expectedVariants.find((entry) => entry.variant === variant.name);
      if (variant.expectedVerdict !== historical.declaredExpectedVerdict) {
        throw new Error(`Gate1 declared verdict changed: ${pair}/${variant.name}`);
      }
      const screenshot = await readFile(fixturePath(directory, variant.image));
      const inputHashes = { design: hash(design), screenshot: hash(screenshot) };
      if (
        inputHashes.design !== historical.inputHashes.design ||
        inputHashes.screenshot !== historical.inputHashes.screenshot
      ) {
        throw new Error(`Gate1 input hashes differ from historical cases: ${pair}/${variant.name}`);
      }
      cases.push({ pair, expectation, variant, design, screenshot, inputHashes });
    }
  }
  return cases;
};

export const run = async (args) => {
  if (args.length !== 3) {
    throw new Error("Usage: node reproduce.mjs <repository> <gate1-fixtures> <output.json>");
  }
  const [repo, fixtures, output] = args.map((argument) => resolve(argument));
  const historical = JSON.parse(await readFile(new URL("./summary.json", import.meta.url), "utf8"));
  if (historical.cases.length !== 33) {
    throw new Error("Historical Gate1 inventory must contain exactly 33 cases");
  }
  // 検体が無い実行をゼロ件合格として残さないため、製品の読み込みより先に全入力を検証する。
  const inputs = await loadFixtureCases(fixtures, historical.cases);
  const sourceCommit = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const { compareImages } = await import(
    pathToFileURL(join(repo, "app/mcp-server/dist/service/image-compare-service.js"))
  );
  const cases = [];
  for (const { pair, expectation, variant, design, screenshot, inputHashes } of inputs) {
    const result = await compareImages(
      {
        designBase64: design.toString("base64"),
        screenshotBase64: screenshot.toString("base64"),
        threshold: 0.1,
        rasterizationTolerance: variant.rasterizationTolerance === true,
      },
      expectation.figmaRootNode,
    );
    cases.push({
      pair,
      variant: variant.name,
      declaredExpectedVerdict: variant.expectedVerdict,
      actualVerdict: result.diffReport?.aggregateVerdict,
      inputHashes,
      normalization: result.normalization,
      issues: result.diffReport?.issues.map(({ kind, severity, evidence }) => ({
        kind,
        severity,
        signal: evidence.signal,
      })),
    });
    process.stdout.write(
      `${pair}/${variant.name}: ${variant.expectedVerdict} -> ${result.diffReport?.aggregateVerdict}\n`,
    );
  }
  const summary = {
    cases: cases.length,
    expectedPass: cases.filter((entry) => entry.declaredExpectedVerdict === "pass").length,
    falseFail: cases.filter(
      (entry) => entry.declaredExpectedVerdict === "pass" && entry.actualVerdict === "fail",
    ).length,
    falsePass: cases.filter(
      (entry) => entry.declaredExpectedVerdict === "fail" && entry.actualVerdict === "pass",
    ).length,
    inconclusive: cases.filter((entry) => entry.actualVerdict === "inconclusive").length,
  };
  await mkdir(resolve(output, ".."), { recursive: true });
  await writeFile(
    output,
    `${JSON.stringify({ sourceCommit, groundTruth: historical.groundTruth, summary, cases }, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(summary)}\n`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await run(process.argv.slice(2));
}

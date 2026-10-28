import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const repo = resolve(process.argv[2]);
const fixtures = resolve(process.argv[3]);
const output = resolve(process.argv[4]);
const { compareImages } = await import(
  pathToFileURL(join(repo, "app/mcp-server/dist/service/image-compare-service.js"))
);
const cases = [];
for (const pair of (await readdir(fixtures)).filter((name) => name.includes("hm-gate1")).sort()) {
  const directory = join(fixtures, pair);
  const expectation = JSON.parse(await readFile(join(directory, "expected.json"), "utf8"));
  const design = await readFile(join(directory, expectation.figmaFrame));
  for (const variant of expectation.variants) {
    const screenshot = await readFile(join(directory, variant.image));
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
      inputHashes: {
        design: createHash("sha256").update(design).digest("hex"),
        screenshot: createHash("sha256").update(screenshot).digest("hex"),
      },
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
}
const summary = {
  cases: cases.length,
  expectedPass: cases.filter((c) => c.declaredExpectedVerdict === "pass").length,
  falseFail: cases.filter((c) => c.declaredExpectedVerdict === "pass" && c.actualVerdict === "fail")
    .length,
  falsePass: cases.filter((c) => c.declaredExpectedVerdict === "fail" && c.actualVerdict === "pass")
    .length,
  inconclusive: cases.filter((c) => c.actualVerdict === "inconclusive").length,
};
await mkdir(resolve(output, ".."), { recursive: true });
await writeFile(
  output,
  `${JSON.stringify({ sourceCommit: "ea13c68354412868f46b808a5069b707481293a4", groundTruth: "Existing PR #375 declarations, not newly independently certified here. No real Figma API/host or AI source edits.", summary, cases }, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(summary)}\n`);

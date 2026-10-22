import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { URL, fileURLToPath, pathToFileURL } from "node:url";

import { loadFixtureCases } from "../issue-376-baseline/reproduce.mjs";

const TRACE_KEY = "designdiff.issue376.stroke-trace";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const replaceOnce = (source, before, after) => {
  assert.equal(source.split(before).length, 2, `Instrumentation anchor changed: ${before}`);
  return source.replace(before, after);
};

export const instrumentGlyphSource = (source) => {
  const innerStart = source.indexOf("const classifySameTokenRasterizationAtHalo = ");
  const outerStart = source.indexOf("export const classifySameTokenRasterization = ");
  assert.ok(innerStart >= 0 && outerStart > innerStart, "Built classifier declarations missing");
  let inner = source.slice(innerStart, outerStart);
  let outer = source.slice(outerStart);
  inner = replaceOnce(
    inner,
    "effectiveShape, ignoreMask) => {",
    'effectiveShape, ignoreMask, trace) => {\n    const haloTrace = { halo, effectiveShape, stage: "window" };\n    trace.halos.push(haloTrace);',
  );
  inner = replaceOnce(
    inner,
    "if (!window)\n        return undefined;",
    'if (!window) { haloTrace.stage = "window"; return undefined; }\n    haloTrace.window = window;',
  );
  inner = replaceOnce(
    inner,
    "if (!backgrounds)\n        return undefined;",
    'if (!backgrounds) { haloTrace.stage = "background"; return undefined; }\n    haloTrace.backgrounds = backgrounds;',
  );
  inner = replaceOnce(
    inner,
    "if (!designForeground || !screenshotForeground)\n        return undefined;",
    'haloTrace.foregrounds = { design: designForeground, screenshot: screenshotForeground };\n    if (!designForeground || !screenshotForeground) { haloTrace.stage = "foreground"; return undefined; }\n    haloTrace.foregroundTokenDelta = maxChannelDelta(designForeground, screenshotForeground);',
  );
  inner = replaceOnce(
    inner,
    "if (maxChannelDelta(designForeground, screenshotForeground) > FOREGROUND_TOKEN_TOLERANCE) {\n        return undefined;",
    'if (maxChannelDelta(designForeground, screenshotForeground) > FOREGROUND_TOKEN_TOLERANCE) {\n        haloTrace.stage = "token";\n        return undefined;',
  );
  inner = replaceOnce(
    inner,
    "!isOnAxisBlend(screenshotPixels, width, window, backgrounds.screenshot, screenshotForeground, ignoreMask)) {\n        return undefined;",
    '!isOnAxisBlend(screenshotPixels, width, window, backgrounds.screenshot, screenshotForeground, ignoreMask)) {\n        haloTrace.stage = "blendAxis";\n        return undefined;',
  );
  inner = replaceOnce(
    inner,
    "if (!Number.isFinite(inkDelta) || inkDelta > inkLimit)\n        return undefined;",
    'haloTrace.ink = { design: designInk, screenshot: screenshotInk, delta: inkDelta, limit: inkLimit };\n    if (!Number.isFinite(inkDelta) || inkDelta > inkLimit) { haloTrace.stage = "ink"; return undefined; }',
  );
  inner = replaceOnce(
    inner,
    "if (changedPixelCount === 0)\n        return undefined;",
    'haloTrace.changedPixelCount = changedPixelCount;\n    if (changedPixelCount === 0) { haloTrace.stage = "noChanged"; return undefined; }',
  );
  inner = replaceOnce(
    inner,
    'classification: "same-token-rasterization",',
    'classification: (haloTrace.stage = "accepted", "same-token-rasterization"),',
  );
  outer = replaceOnce(
    outer,
    "    let effectiveShape = topologyShape;",
    `    const trace = { bbox: { ...bbox }, width, height, topologyShape, stage: "topology", halos: [] };\n    globalThis[Symbol.for(${JSON.stringify(TRACE_KEY)})](trace);\n    let effectiveShape = topologyShape;`,
  );
  outer = replaceOnce(
    outer,
    "if (tolerantWindow === undefined)\n            return undefined;",
    'if (tolerantWindow === undefined) { trace.stage = "window"; return undefined; }',
  );
  outer = replaceOnce(
    outer,
    "if (effectiveShape > MAX_TOPOLOGY_SHAPE)\n            return undefined;",
    'trace.effectiveShape = effectiveShape;\n        if (effectiveShape > MAX_TOPOLOGY_SHAPE) { trace.stage = "topology"; return undefined; }',
  );
  outer = replaceOnce(
    outer,
    "    for (const halo of SAME_TOKEN_HALO_CANDIDATES) {",
    "    trace.effectiveShape = effectiveShape;\n    for (const halo of SAME_TOKEN_HALO_CANDIDATES) {",
  );
  outer = replaceOnce(
    outer,
    "bbox, halo, effectiveShape, ignoreMask);",
    "bbox, halo, effectiveShape, ignoreMask, trace);",
  );
  outer = replaceOnce(
    outer,
    "if (evidence)\n            return evidence;",
    'if (evidence) { trace.stage = "accepted"; trace.acceptedHalo = halo; return evidence; }',
  );
  outer = replaceOnce(
    outer,
    "    return undefined;\n};",
    '    trace.stage = trace.halos.at(-1)?.stage ?? "window";\n    return undefined;\n};',
  );
  return source.slice(0, innerStart) + inner + outer;
};

const histogram = (stages) => {
  const counts = {};
  for (const stage of stages) counts[stage] = (counts[stage] ?? 0) + 1;
  return counts;
};
const boxKey = (box) => `${box.x},${box.y},${box.w},${box.h}`;

const example = (trace, halo) => ({
  bbox: trace.bbox,
  matchingRegionIds: trace.matchingRegionIds,
  topologyShape: trace.topologyShape,
  effectiveShape: trace.effectiveShape,
  halo: halo?.halo,
  ink: halo?.ink,
  foregroundTokenDelta: halo?.foregroundTokenDelta,
});

export const compactDiagnosticDocument = (document) => ({
  ...document,
  summary: {
    ...document.summary,
    declaredPass: document.cases.filter((entry) => entry.declaredExpectedVerdict === "pass").length,
    declaredVerdictMismatches: document.cases.filter(
      (entry) => entry.declaredExpectedVerdict !== entry.actualVerdict,
    ).length,
    falsePassAgainstDeclarations: document.cases.filter(
      (entry) => entry.declaredExpectedVerdict === "fail" && entry.actualVerdict === "pass",
    ).length,
    finalStagesForDeclaredPass: histogram(
      document.cases
        .filter((entry) => entry.declaredExpectedVerdict === "pass")
        .flatMap((entry) => entry.traces.map((trace) => trace.stage)),
    ),
    haloStagesForDeclaredPass: histogram(
      document.cases
        .filter((entry) => entry.declaredExpectedVerdict === "pass")
        .flatMap((entry) => entry.traces.flatMap((trace) => trace.halos.map((halo) => halo.stage))),
    ),
  },
  limitations: [
    "Fixture verdict labels are preserved historical declarations; stage rejection does not establish a false failure.",
    "Topology is evaluated before halo attempts. Counts cover the actual pipeline's selected regions and its region caps.",
    "At most three examples per stage are retained here; full per-call details stay in the local temporary directory.",
  ],
  cases: document.cases.map(({ traces, ...entry }) => ({
    ...entry,
    finalStageExamples: Object.fromEntries(
      Object.keys(entry.summary.finalStages).map((stage) => [
        stage,
        traces
          .filter((trace) => trace.stage === stage)
          .slice(0, 3)
          .map((trace) => example(trace, trace.halos.at(-1))),
      ]),
    ),
    haloStageExamples: Object.fromEntries(
      Object.keys(entry.summary.haloStages).map((stage) => [
        stage,
        traces
          .flatMap((trace) =>
            trace.halos.filter((halo) => halo.stage === stage).map((halo) => example(trace, halo)),
          )
          .slice(0, 3),
      ]),
    ),
  })),
});

export const run = async (args) => {
  assert.ok(
    args.length === 2 || args.length === 3,
    "Usage: node classify-stroke.mjs <repository> <fixtures> [output.json]",
  );
  const repo = resolve(args[0]);
  const fixtures = resolve(args[1]);
  const output = args[2]
    ? resolve(args[2])
    : fileURLToPath(new URL("./stroke-diagnostics.json", import.meta.url));
  const historical = JSON.parse(
    await readFile(new URL("../issue-376-baseline/summary.json", import.meta.url), "utf8"),
  );
  assert.equal(historical.cases.length, 33, "Historical Gate1 inventory changed");
  // 入力の不足やラベル・画素の差し替えを診断結果の変化と取り違えないため、先に照合する。
  const inputs = await loadFixtureCases(fixtures, historical.cases);
  assert.equal(inputs.length, 33);
  const target = pathToFileURL(join(repo, "package/shared/dist/signal/glyph-edge-raster.js")).href;
  const source = await readFile(fileURLToPath(target), "utf8");
  const transformed = instrumentGlyphSource(source);
  const productPaths = [
    "package/shared/src/signal/glyph-edge-raster.ts",
    "package/shared/src/signal/text-reflow.ts",
    "app/mcp-server/src/service/diff-report-builder.ts",
    "app/mcp-server/src/service/image-compare-service.ts",
    "package/shared/dist/signal/glyph-edge-raster.js",
    "package/shared/dist/signal/text-reflow.js",
    "app/mcp-server/dist/service/diff-report-builder.js",
    "app/mcp-server/dist/service/image-compare-service.js",
  ];
  const productHashes = async () =>
    Object.fromEntries(
      await Promise.all(
        productPaths.map(async (path) => [path, hash(await readFile(join(repo, path)))]),
      ),
    );
  const fileHashes = await productHashes();
  const productDiff = execFileSync("git", ["-C", repo, "diff", "HEAD", "--", ...productPaths], {
    encoding: "utf8",
  });
  let activeTraces;
  const recorderKey = Symbol.for(TRACE_KEY);
  assert.equal(globalThis[recorderKey], undefined, "Diagnostic recorder already installed");
  globalThis[recorderKey] = (trace) => {
    assert.ok(activeTraces, "Classifier ran outside a fixture case");
    activeTraces.push(trace);
  };
  const hooks = registerHooks({
    load(url, context, nextLoad) {
      return url === target
        ? { format: "module", source: transformed, shortCircuit: true }
        : nextLoad(url, context);
    },
  });
  const cases = [];
  try {
    const { compareImages } = await import(
      pathToFileURL(join(repo, "app/mcp-server/dist/service/image-compare-service.js"))
    );
    for (const { pair, expectation, variant, design, screenshot, inputHashes } of inputs) {
      activeTraces = [];
      const result = await compareImages(
        {
          designBase64: design.toString("base64"),
          screenshotBase64: screenshot.toString("base64"),
          threshold: 0.1,
          rasterizationTolerance: variant.rasterizationTolerance === true,
        },
        expectation.figmaRootNode,
      );
      const regions = result.diffReport?.regionScores ?? [];
      const traces = activeTraces.map((trace, callIndex) => ({
        ...trace,
        callIndex,
        matchingRegionIds: regions
          .filter((region) => boxKey(region.bbox) === boxKey(trace.bbox))
          .map((region) => region.regionId),
      }));
      cases.push({
        pair,
        variant: variant.name,
        declaredExpectedVerdict: variant.expectedVerdict,
        actualVerdict: result.diffReport?.aggregateVerdict,
        inputHashes,
        normalization: result.normalization,
        alignment: result.diffReport?.alignment,
        summary: {
          classifierCalls: traces.length,
          uniqueBboxes: new Set(traces.map((trace) => boxKey(trace.bbox))).size,
          finalStages: histogram(traces.map((trace) => trace.stage)),
          haloStages: histogram(traces.flatMap((trace) => trace.halos.map((halo) => halo.stage))),
        },
        traces,
      });
      process.stdout.write(`${pair}/${variant.name}: ${JSON.stringify(cases.at(-1).summary)}\n`);
      activeTraces = undefined;
    }
  } finally {
    hooks.deregister();
    Reflect.deleteProperty(globalThis, recorderKey);
  }
  assert.equal(cases.length, 33);
  assert.ok(
    cases.some((entry) => entry.traces.length > 0),
    "No classifier traces captured",
  );
  assert.deepEqual(
    await productHashes(),
    fileHashes,
    "Product source/build changed during diagnosis",
  );
  const sourceCommit = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const document = {
    sourceCommit,
    environment: { node: process.version, platform: process.platform, arch: process.arch },
    scope:
      "Actual compareImages pipeline; in-memory instrumentation of built classifier. No images copied or uploaded. Stage counts describe rejection, not whether a difference is harmless.",
    groundTruth: historical.groundTruth,
    instrumentation: {
      builtSourceSha256: hash(source),
      instrumentedSourceSha256: hash(transformed),
      persistedProductEdits: false,
    },
    worktree: {
      productFileSha256: fileHashes,
      productDiffFromHeadSha256: hash(productDiff),
      hasUncommittedProductChanges: productDiff.length > 0,
      scriptSha256AtExecution: hash(await readFile(fileURLToPath(import.meta.url))),
      productFilesStableDuringRun: true,
    },
    summary: {
      cases: cases.length,
      finalStages: histogram(cases.flatMap((entry) => entry.traces.map((trace) => trace.stage))),
    },
    cases,
  };
  const detailedJson = `${JSON.stringify(document, null, 2)}\n`;
  const detailDirectory = await mkdtemp(join(tmpdir(), "designdiff-stroke-diagnostics-"));
  await writeFile(join(detailDirectory, "details.json"), detailedJson);
  const compact = compactDiagnosticDocument(document);
  compact.instrumentation.detailedTraceSha256 = hash(detailedJson);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(compact, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(compact.summary)}\n`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await run(process.argv.slice(2));
}

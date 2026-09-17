import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const entry = join(root, "app/mcp-server/dist/index.js");
const evidencePath = resolve(
  process.argv[2] ?? join(root, "docs/evidence/mcp-stdio-error-verification.json"),
);
const evidenceDir = dirname(evidencePath);
const sandbox = await mkdtemp(join(tmpdir(), "figdiff-stdio-errors-"));
const home = join(sandbox, "home");
const store = join(sandbox, "store");
const designPath = join(evidenceDir, "mcp-stdio-error-input-design.png");
const screenshotPath = join(evidenceDir, "mcp-stdio-error-input-identical.png");
await Promise.all([mkdir(home), mkdir(store), mkdir(evidenceDir, { recursive: true })]);

const fixture = await sharp({
  create: {
    width: 32,
    height: 24,
    channels: 3,
    background: { r: 31, g: 87, b: 143 },
  },
})
  .png()
  .toBuffer();
await Promise.all([writeFile(designPath, fixture), writeFile(screenshotPath, fixture)]);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const biomeExecutable = createRequire(import.meta.url).resolve("@biomejs/biome/bin/biome");
const writeFormattedJson = async (filePath, value) => {
  const bytes = Buffer.from(
    execFileSync(biomeExecutable, ["format", "--stdin-file-path", filePath], {
      cwd: root,
      input: `${JSON.stringify(value, null, 2)}\n`,
      encoding: "utf8",
    }),
  );
  await writeFile(filePath, bytes);
};
const collectFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(fullPath)));
    else files.push(fullPath);
  }
  return files;
};
const buildRoots = [
  join(root, "app/mcp-server/dist"),
  join(root, "package/shared/dist"),
  join(root, "package/credential-store/dist"),
];
const buildIdentityFiles = [
  join(root, "pnpm-lock.yaml"),
  join(root, "package.json"),
  join(root, "app/mcp-server/package.json"),
  join(root, "package/shared/package.json"),
  join(root, "package/credential-store/package.json"),
];
const captureBuildManifest = async () => {
  const buildFiles = [
    ...(await Promise.all(buildRoots.map(collectFiles))).flat(),
    ...buildIdentityFiles,
  ].sort();
  return await Promise.all(
    buildFiles.map(async (filePath) => ({
      path: relative(root, filePath),
      size: (await stat(filePath)).size,
      sha256: sha256(await readFile(filePath)),
    })),
  );
};
const digestBuildManifest = (manifest) =>
  sha256(
    Buffer.from(
      manifest.map(({ path, size, sha256: digest }) => `${path}\0${size}\0${digest}`).join("\n"),
    ),
  );
const buildManifest = await captureBuildManifest();
const buildDigest = digestBuildManifest(buildManifest);
const results = [];
const protocolErrors = [];
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entry],
  cwd: sandbox,
  env: {
    HOME: home,
    PATH: dirname(process.execPath),
    FIGDIFF_HOME: store,
    FIGDIFF_ALLOWED_DIRS: evidenceDir,
  },
  stderr: "pipe",
});
const client = new Client({ name: "figdiff-error-verification", version: "1.0.0" });
client.onerror = (error) => protocolErrors.push(error.message);
const errorText = (result) =>
  result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
const sanitize = (value) => value.replaceAll(sandbox, "<sandbox>").replaceAll(store, "<store>");
const checkError = async (caseId, toolName, args, expected) => {
  const result = await client.callTool({ name: toolName, arguments: args }, undefined, {
    timeout: 15_000,
  });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent, undefined);
  const responseText = errorText(result);
  assert.match(responseText, expected);
  assert.doesNotMatch(responseText, /output schema|outputSchema|structured content.*required/i);
  results.push({
    caseId,
    toolName,
    status: "PASS",
    expected: { isError: true, structuredContentAbsent: true, textPattern: String(expected) },
    actual: {
      isError: result.isError,
      structuredContentAbsent: result.structuredContent === undefined,
      text: sanitize(responseText),
    },
  });
  return responseText;
};

try {
  await client.connect(transport);
  transport.stderr?.resume();
  const inventory = await client.listTools();
  assert.ok(inventory.tools.some((tool) => tool.name === "compare_design" && tool.outputSchema));

  await checkError(
    "compare_design-invalid-threshold",
    "compare_design",
    { design_source: "missing.png", threshold: 2 },
    /threshold|validation/i,
  );
  await checkError(
    "compare_design-unknown-argument",
    "compare_design",
    { design_source: "missing.png", typo_argument: true },
    /typo_argument/,
  );
  await checkError(
    "get_design_tokens-missing-credential",
    "get_design_tokens",
    { figma_url: "https://www.figma.com/design/SyntheticFixture/File?node-id=fixture" },
    /token|認証|credential/i,
  );

  await chmod(store, 0o500);
  await assert.rejects(writeFile(join(store, "independent-write-probe"), "probe"), {
    code: "EACCES",
  });
  const storageText = await checkError(
    "compare_design-storage-not-writable",
    "compare_design",
    { design_source: designPath, screenshot: screenshotPath },
    /FIGDIFF_STORAGE_NOT_WRITABLE/,
  );
  const payload = JSON.parse(storageText);
  assert.equal(payload.location, "home");
  assert.equal(payload.retryable, true);
  assert.ok(payload.actions.some((action) => action.includes("FIGDIFF_HOME")));

  await chmod(store, 0o700);
  const restored = await client.callTool(
    {
      name: "compare_design",
      arguments: { design_source: designPath, screenshot: screenshotPath },
    },
    undefined,
    { timeout: 90_000 },
  );
  assert.notEqual(restored.isError, true, errorText(restored));
  const restoredData = restored.structuredContent;
  assert.ok(restoredData && typeof restoredData.comparisonId === "string");
  assert.equal(restoredData.diffPixelCount, 0);
  const persistedResultPath = join(store, "results", `${restoredData.comparisonId}.json`);
  const persistedResult = JSON.parse(await readFile(persistedResultPath, "utf8"));
  assert.equal(persistedResult.comparisonId, restoredData.comparisonId);
  results.push({
    caseId: "permission-restored-success-without-restart",
    toolName: "compare_design",
    status: "PASS",
    oracle: "the two durable fixture PNG byte hashes are identical before FigDiff runs",
    expected: {
      isError: false,
      inputSha256Equal:
        sha256(await readFile(designPath)) === sha256(await readFile(screenshotPath)),
      rawDifferingPixelCount: 0,
      persistedResult: true,
    },
    actual: {
      isError: restored.isError === true,
      comparisonId: restoredData.comparisonId,
      diffPixelCount: restoredData.diffPixelCount,
      persistedComparisonId: persistedResult.comparisonId,
    },
  });

  assert.deepEqual(protocolErrors, []);

  const postBuildManifest = await captureBuildManifest();
  const postBuildDigest = digestBuildManifest(postBuildManifest);
  const buildUnchanged = postBuildDigest === buildDigest;
  const evidence = {
    schemaVersion: 1,
    revision: execFileSync("/usr/bin/git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
    dirtyState: execFileSync("/usr/bin/git", ["status", "--porcelain=v1"], {
      cwd: root,
      encoding: "utf8",
    })
      .trimEnd()
      .split("\n")
      .filter(Boolean),
    build: {
      roots: buildRoots.map((directory) => relative(root, directory)),
      identityFiles: buildIdentityFiles.map((filePath) => relative(root, filePath)),
      fileCount: buildManifest.length,
      sha256: buildDigest,
      files: buildManifest,
      postRun: {
        fileCount: postBuildManifest.length,
        sha256: postBuildDigest,
        files: postBuildManifest,
      },
      unchangedDuringRun: buildUnchanged,
    },
    environment: { platform: process.platform, arch: process.arch, node: process.version },
    executedAt: new Date().toISOString(),
    toolCount: inventory.tools.length,
    transport: "@modelcontextprotocol/sdk Client + StdioClientTransport",
    protocolErrors,
    fixtures: [designPath, screenshotPath].map((filePath) => ({
      path: relative(root, filePath),
      sha256: sha256(fixture),
    })),
    results,
    scope: {
      verified: [
        "M13 invalid input contract",
        "M13 missing credential contract",
        "M13 OS EACCES storage contract",
        "same-process successful recovery after permission restoration",
      ],
      notRun: ["real Figma network failure", "remote web capture failure"],
    },
  };
  await writeFormattedJson(evidencePath, evidence);
  process.stdout.write(`${evidencePath}\n`);
  assert.deepEqual(
    postBuildManifest,
    buildManifest,
    "build files changed during stdio verification",
  );
} finally {
  await chmod(store, 0o700);
  await client.close();
}

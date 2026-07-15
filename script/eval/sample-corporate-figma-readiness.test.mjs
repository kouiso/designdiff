import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoDir = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const script = join(repoDir, "script/eval/sample-corporate-figma-readiness.mjs");

function assertReadinessEvidenceContract(evidence) {
  const requiredTopLevelKeys = [
    "ready",
    "missingRequirements",
    "placeholderPageNames",
    "manifestPath",
    "siteRepoPath",
    "expectedPaths",
    "actualPaths",
    "expectedManifestMetadata",
    "actualManifestMetadata",
    "checks",
  ];

  for (const key of requiredTopLevelKeys) {
    assert.ok(key in evidence, `missing readiness contract key: ${key}`);
  }

  assert.equal(typeof evidence.ready, "boolean");
  assert.equal(Array.isArray(evidence.missingRequirements), true);
  assert.equal(Array.isArray(evidence.placeholderPageNames), true);
  assert.equal(typeof evidence.manifestPath, "string");
  assert.equal(typeof evidence.siteRepoPath, "string");
  assert.equal(Array.isArray(evidence.checks), true);
  assert.ok(evidence.checks.length > 0);
  for (const check of evidence.checks) {
    assert.equal(typeof check.name, "string");
    assert.equal(typeof check.ok, "boolean");
    assert.equal(typeof check.detail, "string");
  }

  assert.equal(typeof evidence.expectedPaths, "object");
  assert.equal(typeof evidence.actualPaths, "object");
  assert.ok("siteRepoPackageJson" in evidence.expectedPaths);
  assert.ok("figmaManifest" in evidence.expectedPaths);
  assert.ok("siteRepoPackageJsonExists" in evidence.actualPaths);
  assert.ok("figmaManifestExists" in evidence.actualPaths);
  assert.ok("markdownReport" in evidence.actualPaths);
  assert.ok("jsonEvidence" in evidence.actualPaths);

  assert.equal(typeof evidence.expectedManifestMetadata, "object");
  assert.equal(typeof evidence.actualManifestMetadata, "object");
  assert.ok("manifestPageCount" in evidence.expectedManifestMetadata);
  assert.ok("manifestSha256" in evidence.expectedManifestMetadata);
  assert.ok("manifestPageCount" in evidence.actualManifestMetadata);
  assert.ok("manifestSha256" in evidence.actualManifestMetadata);
}

function assertReadinessDemoCommand(markdown, { siteRepo, manifestPath, outPath, jsonOutPath }) {
  assert.match(markdown, /## 1-minute demo \(readiness re-run\)/u);
  assert.match(markdown, /```bash[\s\S]*scripts\/eval\/sample-corporate-figma-readiness\.mjs/u);
  assert.ok(markdown.includes(`--site-repo ${shellQuote(siteRepo)}`));
  assert.ok(markdown.includes(`--figma-manifest ${shellQuote(manifestPath)}`));
  assert.ok(markdown.includes(`--out ${shellQuote(outPath)}`));
  assert.ok(markdown.includes(`--json-out ${shellQuote(jsonOutPath)}`));
}

function shellQuote(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function manifestChecksum(path) {
  return createHash("sha256").update(readFileSync(path, "utf8")).digest("hex");
}

function setupFixture({ placeholder = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "sample-corporate-ready-test-"));
  const siteRepo = join(root, "site");
  mkdirSync(siteRepo, { recursive: true });
  writeFileSync(join(siteRepo, "package.json"), '{"name":"sample-corporate"}\n');

  const manifestPath = join(root, "manifest.json");
  const figmaUrl = placeholder
    ? "https://www.figma.com/design/FIGMAFILEKEYSAMPLECORP1/sample-corporate?node-id=REPLACE_TOP_PC"
    : "https://www.figma.com/design/FIGMAFILEKEYSAMPLECORP1/sample-corporate?node-id=1-2";

  writeFileSync(manifestPath, JSON.stringify({ pages: [{ name: "top-pc", figma_url: figmaUrl }] }));

  return { root, siteRepo, manifestPath };
}

test("blocked 時に JSON 証跡へ blocker と expected/actual path を出力する", () => {
  const { root, siteRepo, manifestPath } = setupFixture({ placeholder: true });
  const out = join(tmpdir(), `sample-corp-ready-${Date.now()}.md`);

  try {
    const result = spawnSync(
      "node",
      [script, "--site-repo", siteRepo, "--figma-manifest", manifestPath, "--out", out],
      { cwd: repoDir, encoding: "utf8" },
    );

    assert.equal(result.status, 2);
    const jsonOut = out.replace(/\.md$/u, ".json");
    const evidence = JSON.parse(readFileSync(jsonOut, "utf8"));
    const markdown = readFileSync(out, "utf8");
    assertReadinessDemoCommand(markdown, {
      siteRepo,
      manifestPath,
      outPath: out,
      jsonOutPath: jsonOut,
    });
    assert.match(markdown, /Replace all `REPLACE_\*` values/u);
    assertReadinessEvidenceContract(evidence);
    assert.equal(evidence.ready, false);
    assert.match(evidence.missingRequirements.join("\n"), /No REPLACE_\* placeholders/u);
    assert.deepEqual(evidence.placeholderPageNames, ["top-pc"]);
    assert.equal(evidence.expectedPaths.figmaManifest, manifestPath);
    assert.equal(evidence.actualPaths.figmaManifestExists, true);
    assert.equal(evidence.actualPaths.markdownReport, out);
    assert.equal(evidence.actualPaths.jsonEvidence, jsonOut);
    assert.equal(evidence.realSmokeCommand, null);
    assert.equal(evidence.expectedManifestMetadata.manifestPageCount, true);
    assert.equal(evidence.expectedManifestMetadata.manifestSha256, true);
    assert.equal(evidence.actualManifestMetadata.manifestPageCount, 1);
    assert.equal(evidence.actualManifestMetadata.manifestSha256, manifestChecksum(manifestPath));
  } finally {
    rmSync(root, { force: true, recursive: true });
    rmSync(out, { force: true });
    rmSync(out.replace(/\.md$/u, ".json"), { force: true });
  }
});

test("ready 時に JSON 証跡へ real smoke command と missingRequirements 空配列を出力する", () => {
  const { root, siteRepo, manifestPath } = setupFixture();
  const out = join(tmpdir(), `sample-corp-ready-${Date.now()}-ready.md`);
  const jsonOut = join(tmpdir(), `sample-corp-ready-${Date.now()}-ready-evidence.json`);

  try {
    const result = spawnSync(
      "node",
      [
        script,
        "--site-repo",
        siteRepo,
        "--figma-manifest",
        manifestPath,
        "--out",
        out,
        "--json-out",
        jsonOut,
      ],
      {
        cwd: repoDir,
        encoding: "utf8",
        env: { ...process.env, FIGMA_TOKEN: "token" },
      },
    );

    assert.equal(result.status, 0);
    const evidence = JSON.parse(readFileSync(jsonOut, "utf8"));
    const markdown = readFileSync(out, "utf8");
    assertReadinessDemoCommand(markdown, {
      siteRepo,
      manifestPath,
      outPath: out,
      jsonOutPath: jsonOut,
    });
    assertReadinessEvidenceContract(evidence);
    assert.equal(evidence.ready, true);
    assert.deepEqual(evidence.missingRequirements, []);
    assert.deepEqual(evidence.placeholderPageNames, []);
    assert.equal(evidence.manifestPath, manifestPath);
    assert.equal(evidence.siteRepoPath, siteRepo);
    assert.match(evidence.realSmokeCommand, /--real/u);
    assert.equal(evidence.expectedPaths.siteRepoPackageJson, join(siteRepo, "package.json"));
    assert.equal(evidence.actualPaths.siteRepoPackageJsonExists, true);
    assert.equal(evidence.expectedManifestMetadata.manifestPageCount, true);
    assert.equal(evidence.expectedManifestMetadata.manifestSha256, true);
    assert.equal(evidence.actualManifestMetadata.manifestPageCount, 1);
    assert.equal(evidence.actualManifestMetadata.manifestSha256, manifestChecksum(manifestPath));
  } finally {
    rmSync(root, { force: true, recursive: true });
    rmSync(out, { force: true });
    rmSync(jsonOut, { force: true });
  }
});

test("blocked でも placeholder が無い場合は token だけを next action に出す", () => {
  const { root, siteRepo, manifestPath } = setupFixture();
  const out = join(tmpdir(), `sample-corp-ready-${Date.now()}-token-only.md`);

  try {
    const result = spawnSync(
      "node",
      [script, "--site-repo", siteRepo, "--figma-manifest", manifestPath, "--out", out],
      { cwd: repoDir, encoding: "utf8", env: { ...process.env, FIGMA_TOKEN: "" } },
    );

    assert.equal(result.status, 2);
    const markdown = readFileSync(out, "utf8");
    const evidence = JSON.parse(readFileSync(out.replace(/\.md$/u, ".json"), "utf8"));
    assert.deepEqual(evidence.placeholderPageNames, []);
    assert.deepEqual(evidence.missingRequirements, ["FIGMA_TOKEN environment variable"]);
    assert.match(markdown, /Export FIGMA_TOKEN without storing it in the repo/u);
    assert.doesNotMatch(markdown, /Replace all `REPLACE_\*` values/u);
  } finally {
    rmSync(root, { force: true, recursive: true });
    rmSync(out, { force: true });
    rmSync(out.replace(/\.md$/u, ".json"), { force: true });
  }
});

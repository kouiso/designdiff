import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadGate1Fixtures, validateGate1Fixtures } from "./gate1-fixture.mjs";
import { loadImage } from "./measure-gate1-oracle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixture");
const inputs = async () => ({
  definition: JSON.parse(await readFile(path.join(root, "gate1-independent-oracle.json"), "utf8")),
  entries: await Promise.all(
    (await readdir(root))
      .filter((d) => /^pair-\d+-hm-gate1-/.test(d))
      .sort()
      .map(async (directory) => ({
        directory,
        bytes: await readFile(path.join(root, directory, "expected.json")),
      })),
  ),
});

test("full fixture identities preserve all 33 controls and known RED labels", async () => {
  const result = await loadGate1Fixtures(root);
  assert.equal(result.fixtures.length, 18);
  assert.equal(result.fixtures.flatMap((f) => f.expectation.variants).length, 33);
  assert.equal(
    result.fixtures.flatMap((f) => f.expectation.variants).filter((v) => v.knownRedIssue).length,
    12,
  );
});

test("same-count duplicate or substituted variants are rejected even with refreshed byte hashes", async () => {
  for (const mutation of ["duplicate", "label", "red", "path", "pair"]) {
    const { definition, entries } = await inputs();
    const target = entries[0];
    const e = JSON.parse(target.bytes.toString("utf8"));
    if (mutation === "duplicate") e.variants[1] = e.variants[0];
    if (mutation === "label") e.variants[1].expectedVerdict = "pass";
    if (mutation === "red") delete e.variants[0].knownRedIssue;
    if (mutation === "path") e.variants[1].image = "../impl-drift-2px.png";
    if (mutation === "pair") e.pairId = entries[1].directory;
    target.bytes = Buffer.from(JSON.stringify(e));
    definition.fixtures[target.directory].expectedSha256 = createHash("sha256")
      .update(target.bytes)
      .digest("hex");
    assert.throws(
      () => validateGate1Fixtures(definition, entries),
      /duplicate|contract|path|pairId/,
    );
  }
});

test("missing controls, duplicate pairs, overlap and stale expectation bytes fail closed", async () => {
  const { definition, entries } = await inputs();
  assert.throws(() => validateGate1Fixtures(definition, entries.slice(1)), /18 fixture/);
  assert.throws(
    () => validateGate1Fixtures(definition, [entries[0], ...entries.slice(0, 17)]),
    /duplicate/,
  );
  const overlap = structuredClone(definition);
  overlap.failPairs[0] = overlap.passPairs[0];
  assert.throws(() => validateGate1Fixtures(overlap, entries), /overlap/);
  entries[0].bytes = Buffer.concat([entries[0].bytes, Buffer.from("\n")]);
  assert.throws(() => validateGate1Fixtures(definition, entries), /hash changed/);
});

test("all 51 fixture PNG hashes match the committed measurement evidence", async () => {
  const { fixtures } = await loadGate1Fixtures(root);
  /** @type {{rows: {pairId: string, against: string, image: {file: string, sha256: string}, reference: {sha256: string}}[]}} */
  const measurement = JSON.parse(
    await readFile(path.join(root, "../../docs/evidence/issue-427/measurement.json"), "utf8"),
  );
  let checked = 0;
  for (const { directory, expectation } of fixtures) {
    const rows = measurement.rows.filter((row) => row.pairId === directory);
    const files = new Set([expectation.figmaFrame, ...expectation.variants.map((v) => v.image)]);
    for (const file of files) {
      const recordedHashes = new Set(
        rows.flatMap((row) => [
          ...(row.image.file === file ? [row.image.sha256] : []),
          ...(row.against === "figma" && file === expectation.figmaFrame
            ? [row.reference.sha256]
            : []),
          ...(row.against === "correct" && file === "impl-correct.png"
            ? [row.reference.sha256]
            : []),
        ]),
      );
      assert.equal(recordedHashes.size, 1, `${directory}/${file}: missing or conflicting evidence`);
      const { sha256: actual } = await loadImage(path.join(root, directory, file));
      assert.ok(recordedHashes.has(actual), `${directory}/${file}: stale PNG evidence`);
      checked += 1;
    }
  }
  assert.equal(checked, 51);
});

import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { loadFixtureCases, run } from "./reproduce.mjs";

const pair = "pair-test-hm-gate1";
const design = Buffer.from("known design bytes");
const screenshot = Buffer.from("known screenshot bytes");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const historical = [
  {
    pair,
    variant: "correct",
    declaredExpectedVerdict: "pass",
    inputHashes: { design: hash(design), screenshot: hash(screenshot) },
  },
];
const fixture = async (context) => {
  const root = await mkdtemp(join(tmpdir(), "figdiff-376-inventory-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, pair);
  await mkdir(directory);
  const manifest = {
    figmaFrame: "design.png",
    variants: [{ name: "correct", image: "screenshot.png", expectedVerdict: "pass" }],
  };
  await writeFile(join(directory, "expected.json"), JSON.stringify(manifest));
  await writeFile(join(directory, "design.png"), design);
  await writeFile(join(directory, "screenshot.png"), screenshot);
  return { root, directory, manifest };
};

test("empty fixture directory fails before product import or evidence output", async (context) => {
  const { root, directory } = await fixture(context);
  await rm(directory, { recursive: true });
  const output = join(root, "must-not-exist.json");
  await assert.rejects(run([join(root, "no-built-product"), root, output]), /missing manifests/);
  await assert.rejects(readFile(output), { code: "ENOENT" });
});

test("complete inventory returns exact known bytes and input hashes", async (context) => {
  const { root } = await fixture(context);
  const [entry] = await loadFixtureCases(root, historical);
  assert.deepEqual(entry.design, design);
  assert.deepEqual(entry.screenshot, screenshot);
  assert.deepEqual(entry.inputHashes, historical[0].inputHashes);
});

test("missing image fails with its exact path", async (context) => {
  const { root, directory } = await fixture(context);
  const missing = join(directory, "screenshot.png");
  await rm(missing);
  await assert.rejects(loadFixtureCases(root, historical), (error) => {
    assert.equal(error.code, "ENOENT");
    assert.equal(error.path, missing);
    return true;
  });
});

test("missing variants fail instead of reducing the case count", async (context) => {
  const { root, directory, manifest } = await fixture(context);
  manifest.variants = [];
  await writeFile(join(directory, "expected.json"), JSON.stringify(manifest));
  await assert.rejects(loadFixtureCases(root, historical), /empty variants/);
});

test("extra or duplicated variants fail against the historical inventory", async (context) => {
  const { root, directory, manifest } = await fixture(context);
  manifest.variants.push(manifest.variants[0]);
  await writeFile(join(directory, "expected.json"), JSON.stringify(manifest));
  await assert.rejects(loadFixtureCases(root, historical), /variant inventory differs/);
});

test("changed image bytes fail instead of claiming a historical fixture rerun", async (context) => {
  const { root, directory } = await fixture(context);
  await writeFile(join(directory, "screenshot.png"), "changed pixels");
  await assert.rejects(loadFixtureCases(root, historical), /input hashes differ/);
});

test("changed ground truth fails instead of relabeling the existing cases", async (context) => {
  const { root, directory, manifest } = await fixture(context);
  manifest.variants[0].expectedVerdict = "fail";
  await writeFile(join(directory, "expected.json"), JSON.stringify(manifest));
  await assert.rejects(loadFixtureCases(root, historical), /declared verdict changed/);
});

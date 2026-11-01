import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repository, "script/oracle-verdict-agreement.mjs");
// oracle-compare.mjs と同じ sharp を使って検体の画像を作る。
const sharp = createRequire(join(repository, "app/mcp-server/package.json"))("sharp");

const solid = (file, background) =>
  sharp({ create: { width: 16, height: 16, channels: 3, background } })
    .png()
    .toFile(file);

const createPair = async (variants) => {
  const root = await mkdtemp(join(tmpdir(), "figdiff-oracle-agreement-"));
  const pair = join(root, "pair-test");
  await mkdir(pair);
  await solid(join(pair, "figma.png"), "white");
  await solid(join(pair, "same.png"), "white");
  await solid(join(pair, "other.png"), "black");
  await writeFile(
    join(pair, "expected.json"),
    JSON.stringify({ pairId: "pair-test", figmaFrame: "figma.png", variants }),
  );
  return root;
};

const run = (root) => {
  const result = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: { ...process.env, FIGDIFF_ORACLE_FIXTURE_ROOT: root },
  });
  const summary = JSON.parse(result.stdout);
  return { status: result.status, stderr: result.stderr, summary };
};

test("ラスタライズ差を許す pass 検体は一致と数えず、判定できなかった検体として失敗にする", async (context) => {
  const root = await createPair([
    { name: "same", image: "same.png", expectedVerdict: "pass" },
    { name: "other", image: "other.png", expectedVerdict: "fail" },
    { name: "rt-pass", image: "other.png", expectedVerdict: "pass", rasterizationTolerance: true },
    { name: "rt-fail", image: "other.png", expectedVerdict: "fail", rasterizationTolerance: true },
  ]);
  context.after(() => rm(root, { recursive: true, force: true }));

  const { status, stderr, summary } = run(root);

  // 食い違いは無くても、独立に裏付けられない pass が残る限り通さない。
  assert.equal(status, 1);
  assert.equal(summary.unjudged, 1);
  assert.equal(summary.disagreements, 0);
  const agrees = Object.fromEntries(summary.rows.map((row) => [row.variant, row.agrees]));
  // fail を期待する対照は、ラスタライズ差を許す検体でもこの物差しで照合する。
  assert.deepEqual(agrees, { same: true, other: true, "rt-pass": null, "rt-fail": true });
  assert.match(stderr, /pair-test\/rt-pass/);
});

test("判定対象の検体が期待合否と食い違えば失敗する", async (context) => {
  const root = await createPair([
    { name: "wrong-pass", image: "other.png", expectedVerdict: "pass" },
    {
      name: "rt-wrong-fail",
      image: "same.png",
      expectedVerdict: "fail",
      rasterizationTolerance: true,
    },
  ]);
  context.after(() => rm(root, { recursive: true, force: true }));

  const { status, summary } = run(root);

  assert.equal(status, 1);
  assert.equal(summary.disagreements, 2);
  assert.equal(summary.unjudged, 0);
});

test("判定対象の食い違いが 1 件でも失敗する", async (context) => {
  const root = await createPair([
    { name: "same", image: "same.png", expectedVerdict: "pass" },
    { name: "wrong-pass", image: "other.png", expectedVerdict: "pass" },
  ]);
  context.after(() => rm(root, { recursive: true, force: true }));

  const { status, summary } = run(root);

  assert.equal(status, 1);
  assert.equal(summary.disagreements, 1);
});

test("全件をこの物差しで判定でき、期待合否と一致すれば通る", async (context) => {
  const root = await createPair([
    { name: "same", image: "same.png", expectedVerdict: "pass" },
    { name: "other", image: "other.png", expectedVerdict: "fail" },
    { name: "rt-fail", image: "other.png", expectedVerdict: "fail", rasterizationTolerance: true },
  ]);
  context.after(() => rm(root, { recursive: true, force: true }));

  const { status, stderr, summary } = run(root);

  assert.equal(status, 0, stderr);
  assert.equal(summary.unjudged, 0);
  assert.equal(summary.disagreements, 0);
});

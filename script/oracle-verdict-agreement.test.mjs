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

test("ラスタライズ差を許す pass 検体は、オラクルが pass でも一致と数えない", async (context) => {
  const root = await createPair([
    {
      name: "rt-pass-same",
      image: "same.png",
      expectedVerdict: "pass",
      rasterizationTolerance: true,
    },
  ]);
  context.after(() => rm(root, { recursive: true, force: true }));

  const { status, summary } = run(root);

  assert.equal(status, 1);
  assert.equal(summary.unjudged, 1);
  assert.equal(summary.rows[0].oracle, "pass");
  assert.equal(summary.rows[0].agrees, null);
});

test("検体が 1 件も無いときは、場所の取り違えとして失敗する", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "figdiff-oracle-agreement-empty-"));
  context.after(() => rm(root, { recursive: true, force: true }));

  const result = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: { ...process.env, FIGDIFF_ORACLE_FIXTURE_ROOT: root },
  });

  assert.equal(result.status, 2);
});

test("検体を 1 件も持たない組があれば、ほかが一致していても失敗する", async (context) => {
  const root = await createPair([{ name: "same", image: "same.png", expectedVerdict: "pass" }]);
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "pair-empty"));
  await writeFile(
    join(root, "pair-empty", "expected.json"),
    JSON.stringify({ pairId: "pair-empty", figmaFrame: "figma.png", variants: [] }),
  );

  const { status, stderr } = run(root);

  assert.equal(status, 1);
  assert.match(stderr, /pair-empty/);
});

test("ignoreRegions が全面を覆う検体は、比べた画素が無いので判定できなかったものとして失敗する", async (context) => {
  const root = await createPair([
    {
      name: "full-mask",
      image: "other.png",
      expectedVerdict: "pass",
      ignoreRegions: [{ x: 0, y: 0, width: 16, height: 16 }],
    },
  ]);
  context.after(() => rm(root, { recursive: true, force: true }));

  const { status, summary } = run(root);

  assert.equal(status, 1);
  assert.equal(summary.unjudged, 1);
  assert.equal(summary.rows[0].agrees, null);
});

test("ignoreRegions で差分だけを外した検体は、残りの画素で照合する", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "figdiff-oracle-agreement-mask-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const pair = join(root, "pair-mask");
  await mkdir(pair);
  await solid(join(pair, "figma.png"), "white");
  // 左上 4x4 だけ黒い。そこを外せば残りは一致、外さなければ食い違う。
  await sharp({ create: { width: 16, height: 16, channels: 3, background: "white" } })
    .composite([
      {
        input: { create: { width: 4, height: 4, channels: 3, background: "black" } },
        left: 0,
        top: 0,
      },
    ])
    .png()
    .toFile(join(pair, "spot.png"));
  await writeFile(
    join(pair, "expected.json"),
    JSON.stringify({
      pairId: "pair-mask",
      figmaFrame: "figma.png",
      variants: [
        {
          name: "masked",
          image: "spot.png",
          expectedVerdict: "pass",
          ignoreRegions: [{ x: 0, y: 0, width: 4, height: 4 }],
        },
        { name: "unmasked", image: "spot.png", expectedVerdict: "fail" },
      ],
    }),
  );

  const { status, stderr, summary } = run(root);

  assert.equal(status, 0, stderr);
  assert.equal(summary.disagreements, 0);
});

test("寸法が違う検体は fail として照合する", async (context) => {
  const root = await createPair([{ name: "same", image: "same.png", expectedVerdict: "pass" }]);
  context.after(() => rm(root, { recursive: true, force: true }));
  await sharp({ create: { width: 16, height: 20, channels: 3, background: "white" } })
    .png()
    .toFile(join(root, "pair-test", "taller.png"));
  const expectedPath = join(root, "pair-test", "expected.json");
  await writeFile(
    expectedPath,
    JSON.stringify({
      pairId: "pair-test",
      figmaFrame: "figma.png",
      variants: [{ name: "taller", image: "taller.png", expectedVerdict: "pass" }],
    }),
  );

  const { status, summary } = run(root);

  assert.equal(status, 1);
  assert.equal(summary.rows[0].oracle, "fail");
  assert.equal(summary.disagreements, 1);
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { requiredCampaignRuns, validateCampaignEvidence } from "./verify-campaign-evidence.mjs";

const fixture = async (run) => {
  const directory = await mkdtemp(join(tmpdir(), "figdiff-ledger-test-"));
  const bytes = Buffer.from(
    "Synthetic artifact: validates ledger integrity, not product behavior.",
  );
  const productSha = "a".repeat(40);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await writeFile(join(directory, "proof.txt"), bytes);
  const ledger = {
    version: 1,
    productSha,
    rounds: [1, 2].map((round) => ({
      round,
      productSha,
      executionId: `synthetic-round-${round}`,
      startedAt: `2026-09-13T0${round}:00:00Z`,
      finishedAt: `2026-09-13T0${round}:30:00Z`,
    })),
    runs: requiredCampaignRuns.map((item) => ({
      ...item,
      roundExecutionId: `synthetic-round-${item.round}`,
      executedAt: `2026-09-13T0${item.round}:15:00Z`,
      productSha,
      dirty: false,
      status: "PASS",
      newBugs: 0,
      buildDigest: "b".repeat(64),
      environment: "validator fixture",
      input: "synthetic",
      steps: "fixture construction",
      expected: "integrity accepted",
      actual: "fixture bytes present",
      oracle: { kind: "source-pixels", description: "Synthetic validator test metadata" },
      evidence: [{ path: "proof.txt", sha256 }],
    })),
  };
  try {
    await run(ledger, directory, sha256);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

test("49ケース・2巡・必須経路を網羅した台帳の整合を受理する", () =>
  fixture(async (ledger, directory) => {
    assert.equal(requiredCampaignRuns.length, 390);
    assert.equal(new Set(requiredCampaignRuns.map((run) => run.case)).size, 49);
    assert.deepEqual(new Set(requiredCampaignRuns.map((run) => run.round)), new Set([1, 2]));
    assert.deepEqual(await validateCampaignEvidence(ledger, directory), []);
  }));

test("欠落・重複・別SHA・dirty・BLOCKED・新規不具合を全て検出する", () =>
  fixture(async (ledger, directory) => {
    ledger.runs.pop();
    ledger.runs.push(ledger.runs[0]);
    ledger.runs[1].productSha = "c".repeat(40);
    ledger.runs[2].dirty = true;
    ledger.runs[3].status = "BLOCKED";
    ledger.runs[4].newBugs = 1;
    const errors = (await validateCampaignEvidence(ledger, directory)).join("\n");
    for (const expected of [
      "NOT RUN",
      "duplicate",
      "SHA differs",
      "not clean",
      "BLOCKED",
      "bug count",
    ])
      assert.match(errors, new RegExp(expected));
  }));

test("改変した証跡と製品自己判定のoracleを拒否する", () =>
  fixture(async (ledger, directory) => {
    ledger.runs[0].oracle.kind = "product-match-rate";
    await writeFile(join(directory, "proof.txt"), "modified");
    const errors = (await validateCampaignEvidence(ledger, directory)).join("\n");
    assert.match(errors, /independent oracle/);
    assert.match(errors, /changed evidence/);
  }));

test("ディレクトリ外へ向くsymlinkを証跡にできない", () =>
  fixture(async (ledger, directory, sha256) => {
    const outside = await mkdtemp(join(tmpdir(), "figdiff-outside-proof-"));
    try {
      await writeFile(join(outside, "proof.txt"), "outside");
      await symlink(join(outside, "proof.txt"), join(directory, "escape"));
      ledger.runs[0].evidence = [{ path: "escape", sha256 }];
      assert.match(
        (await validateCampaignEvidence(ledger, directory)).join("\n"),
        /escapes durable directory/,
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  }));

test("未固定SHAと不正な台帳構造を拒否する", async () => {
  assert.deepEqual(await validateCampaignEvidence(null, "."), ["Ledger must be an object"]);
  assert.match(
    (await validateCampaignEvidence({ version: 1, productSha: null }, ".")).join("\n"),
    /not frozen/,
  );
});

test("必須OSと経路の契約を実装から独立した組合せで固定する", () => {
  const expected = {
    C: [
      "linux-wsl/mcp",
      "linux-wsl/desktop",
      "windows/mcp",
      "windows/desktop",
      "macos/mcp",
      "macos/desktop",
    ],
    M: ["linux-wsl/mcp", "windows/mcp", "macos/mcp"],
    D: ["linux-wsl/desktop", "windows/desktop", "macos/desktop"],
    X01: ["linux-wsl/chrome-extension", "windows/chrome-extension", "macos/chrome-extension"],
    X02: ["linux-wsl/chrome-extension", "windows/chrome-extension", "macos/chrome-extension"],
    X03: ["linux-wsl/figma-plugin", "windows/figma-plugin", "macos/figma-plugin"],
    X04: ["linux-wsl/figma-plugin", "windows/figma-plugin", "macos/figma-plugin"],
    X05: ["linux-wsl/android", "windows/android", "macos/android"],
    X06: ["macos/ios-simulator", "macos/ios-device"],
    X07: ["linux-wsl/android", "windows/android", "macos/android"],
    X08: [
      "linux-wsl/mcp",
      "linux-wsl/desktop",
      "linux-wsl/chrome-extension",
      "linux-wsl/figma-plugin",
      "windows/mcp",
      "windows/desktop",
      "windows/chrome-extension",
      "windows/figma-plugin",
      "macos/mcp",
      "macos/desktop",
      "macos/chrome-extension",
      "macos/figma-plugin",
    ],
    X09: [
      "linux-wsl/mcp",
      "linux-wsl/desktop",
      "windows/mcp",
      "windows/desktop",
      "macos/mcp",
      "macos/desktop",
    ],
    X10: ["repository/dependency-graph"],
  };
  for (const id of new Set(requiredCampaignRuns.map((run) => run.case))) {
    const contract = expected[id.startsWith("X") ? id : id[0]];
    for (const round of [1, 2]) {
      assert.deepEqual(
        new Set(
          requiredCampaignRuns
            .filter((run) => run.case === id && run.round === round)
            .map((run) => `${run.platform}/${run.route}`),
        ),
        new Set(contract),
      );
    }
  }
});

test("同一実行の巡回番号変更や実行時刻のコピーを拒否する", () =>
  fixture(async (ledger, directory) => {
    ledger.rounds[1].executionId = ledger.rounds[0].executionId;
    ledger.runs[1].roundExecutionId = ledger.runs[0].roundExecutionId;
    ledger.runs[0].executedAt = "2026-09-12T01:00:00Z";
    const errors = (await validateCampaignEvidence(ledger, directory)).join("\n");
    assert.match(errors, /distinct execution IDs/);
    assert.match(errors, /outside its round/);
  }));

// platform sweep は非同期に走るため、2巡の成立は大域的な時系列ではなく
// 同一 case/platform/route の round2 実施時刻が round1 より後であることで担保する。
test("同一caseのround2がround1より前に実行された記録を拒否する", () =>
  fixture(async (ledger, directory) => {
    const target = ledger.runs.find((run) => run.round === 2);
    target.executedAt = "2026-09-13T00:15:00Z";
    ledger.rounds[1].startedAt = "2026-09-13T00:10:00Z";
    ledger.rounds[1].finishedAt = "2026-09-13T02:30:00Z";
    const errors = (await validateCampaignEvidence(ledger, directory)).join("\n");
    assert.match(errors, /round 2 does not follow round 1/);
  }));

test("platform窓が重なってもcase毎のround順序が正しければ受理する", () =>
  fixture(async (ledger, directory) => {
    ledger.rounds[0].finishedAt = "2026-09-13T02:30:00Z";
    ledger.rounds[1].startedAt = "2026-09-13T01:00:00Z";
    ledger.rounds[1].finishedAt = "2026-09-13T03:00:00Z";
    for (const run of ledger.runs) {
      run.executedAt = `2026-09-13T0${run.round}:45:00Z`;
    }
    assert.deepEqual(await validateCampaignEvidence(ledger, directory), []);
  }));

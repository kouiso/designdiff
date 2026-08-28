import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { CompareDesignResultSchema } from "@figdiff/shared";

import { createMcpServer } from "../server.js";
import { clearComparisonHistory } from "../service/comparison-history.js";

import { normalizeComparisonResultInput } from "./generate-report.js";

const baseResult = {
  comparisonId: "cmp-loop-guard-compat",
  status: "FAIL",
  matchRate: 73.48,
  diffPixelCount: 598829,
  totalPixelCount: 2258100,
  remainingIssues: 60,
  diffRegions: [],
  suggestion: "差分があります",
} as const;

describe("normalizeComparisonResultInput loopGuard compatibility", () => {
  it("保存済み旧partial loopGuardを現行形式へ正規化する", () => {
    const normalized = normalizeComparisonResultInput({
      ...baseResult,
      loopGuard: {
        iteration: 1,
        decision: "continue",
        reason: "反復 1/5 回。改善の余地があるため修正を続行できます。",
      },
    });

    const parsed = CompareDesignResultSchema.parse(normalized);
    expect(parsed.loopGuard).toEqual({
      stop: false,
      step: 1,
      maxSteps: 5,
      remainingSteps: 4,
      reason: "continue",
      message: "反復 1/5 回。改善の余地があるため修正を続行できます。",
      iteration: 1,
      decision: "continue",
    });
  });

  it("現行loopGuardを変更せず厳格schemaで受理する", () => {
    const loopGuard = {
      stop: true,
      step: 5,
      maxSteps: 5,
      remainingSteps: 0,
      reason: "max-steps",
      message: "反復回数が上限に達しました。",
      iteration: 5,
      decision: "stop",
    } as const;
    const normalized = normalizeComparisonResultInput({ ...baseResult, loopGuard });
    const parsed = CompareDesignResultSchema.parse(normalized);

    expect(parsed.loopGuard).toEqual(loopGuard);
  });

  it("旧形式ではない不完全な現行loopGuardを救済しない", () => {
    const normalized = normalizeComparisonResultInput({
      ...baseResult,
      loopGuard: {
        step: 1,
        maxSteps: 5,
        remainingSteps: 4,
        reason: "continue",
        message: "続行します。",
      },
    });

    expect(CompareDesignResultSchema.safeParse(normalized).success).toBe(false);
  });
});

describe("generate_diff_report comparison_id compatibility", () => {
  it("ディスク保存済み旧loopGuardをcomparison_id経路でレポート化する", async () => {
    const originalFigdiffHome = process.env.FIGDIFF_HOME;
    const testRoot = await fs.mkdtemp(path.join(tmpdir(), "figdiff-generate-report-legacy-"));
    const testFigdiffHome = path.join(testRoot, ".figdiff");
    const comparisonId = "cmp-loop-guard-history-compat";
    const resultsDir = path.join(testFigdiffHome, "results");
    let client: Client | undefined;

    try {
      process.env.FIGDIFF_HOME = testFigdiffHome;
      await fs.mkdir(resultsDir, { recursive: true });
      await fs.writeFile(
        path.join(resultsDir, `${comparisonId}.json`),
        JSON.stringify({
          comparisonId,
          sourceKey: "local:legacy-loop-guard",
          result: {
            ...baseResult,
            comparisonId,
            loopGuard: {
              iteration: 1,
              decision: "continue",
              reason: "反復 1/5 回。改善の余地があるため修正を続行できます。",
            },
          },
        }),
      );

      const server = createMcpServer();
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      client = new Client({ name: "generate-report-compat-test", version: "1.0.0" });
      await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

      const response = await client.callTool({
        name: "generate_diff_report",
        arguments: { comparison_id: comparisonId, format: "json" },
      });

      expect(response.isError).toBeFalsy();
      const content = response.content as Array<{ type: string; text?: string }>;
      const report = JSON.parse(content.find((item) => item.type === "text")?.text ?? "");
      expect(report.comparisonId).toBe(comparisonId);
      expect(report.loopGuard).toMatchObject({
        stop: false,
        step: 1,
        maxSteps: 5,
        remainingSteps: 4,
        reason: "continue",
      });
    } finally {
      await client?.close();
      clearComparisonHistory();
      if (originalFigdiffHome === undefined) delete process.env.FIGDIFF_HOME;
      else process.env.FIGDIFF_HOME = originalFigdiffHome;
      await fs.rm(testRoot, { recursive: true, force: true });
    }
  });
});

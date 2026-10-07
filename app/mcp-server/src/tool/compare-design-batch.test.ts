import * as path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { createMcpServer } from "../server.js";
import { CompareDesignBatchResultSchema } from "../service/batch-compare-service.js";
import { clearComparisonHistory } from "../service/comparison-history.js";

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const fixtureRoot = path.resolve(import.meta.dirname, "../../../../verification/fixture");
const pair01 = path.join(fixtureRoot, "pair-01-simple-static-lp");
const pair05 = path.join(fixtureRoot, "pair-05-localized-diff");

const previousAllowedDirs = process.env.FIGDIFF_ALLOWED_DIRS;
const server = createMcpServer();
const client = new Client({ name: "batch-test", version: "1.0.0" });

beforeAll(async () => {
  process.env.FIGDIFF_ALLOWED_DIRS = fixtureRoot;
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
});

afterAll(async () => {
  await client.close();
  await server.close();
  clearComparisonHistory();
  if (previousAllowedDirs === undefined) delete process.env.FIGDIFF_ALLOWED_DIRS;
  else process.env.FIGDIFF_ALLOWED_DIRS = previousAllowedDirs;
});

const text = (result: CallToolResult): string =>
  result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");

// 人間可読サマリーは末尾の text ブロック。先頭は JSON (compare_design と同じ並び)。
const summaryText = (result: CallToolResult): string => {
  const blocks = result.content.filter((item) => item.type === "text");
  const last = blocks.at(-1);
  expect(last).toBeDefined();
  return last?.text ?? "";
};

const batchData = (result: CallToolResult) => {
  expect(result.isError).toBeFalsy();
  return CompareDesignBatchResultSchema.parse(result.structuredContent);
};

const callBatch = async (args: Record<string, unknown>): Promise<CallToolResult> =>
  await client.callTool({ name: "compare_design_batch", arguments: args }, undefined, {
    timeout: 90_000,
  });

describe("compare_design_batch — registration", () => {
  it("tools/list に compare_design_batch が含まれる", async () => {
    const listed = await client.listTools();
    const tool = listed.tools.find((entry) => entry.name === "compare_design_batch");
    expect(tool).toBeDefined();
    expect(tool?.inputSchema).toMatchObject({ type: "object" });
    expect(tool?.outputSchema).toMatchObject({ type: "object" });
  });
});

describe("compare_design_batch — success / failure / partial failure", () => {
  it("複数フレームを1回で比較し、フレームごとの判定と集約を返す", async () => {
    const response = await callBatch({
      campaign_id: "batch-success",
      frames: [
        {
          label: "home",
          design_source: path.join(pair01, "figma-export.png"),
          screenshot: path.join(pair01, "impl-correct.png"),
        },
        {
          label: "settings",
          design_source: path.join(pair01, "figma-export.png"),
          screenshot: path.join(pair01, "impl-color-off.png"),
        },
      ],
    });
    const result = batchData(response);

    expect(result.totalFrames).toBe(2);
    expect(result.frames.map((frame) => frame.label)).toEqual(["home", "settings"]);
    expect(result.frames[0]?.status).toBe("PASS");
    expect(result.frames[1]?.status).toBe("FAIL");
    expect(result).toMatchObject({ passCount: 1, failCount: 1, errorCount: 0, verdict: "FAIL" });
    // comparisonId はフレームごとに別で、全件のレポート取得に使える。
    expect(result.comparisonIds).toHaveLength(2);
    expect(result.frames[0]?.comparisonId).not.toBe(result.frames[1]?.comparisonId);

    const report = await client.callTool({
      name: "generate_diff_report",
      arguments: { comparison_id: result.frames[1]?.comparisonId, format: "json" },
    });
    expect(report.isError).toBeFalsy();
    // comparisonId から全レポートが取れること (差分領域も含む) を、製品の match% ではなく
    // 保存済みレポートの中身で確かめる。
    const reportJson = z
      .object({ comparisonId: z.string(), diffReport: z.unknown() })
      .parse(JSON.parse(text(report)));
    expect(reportJson.comparisonId).toBe(result.frames[1]?.comparisonId);
    expect(reportJson.diffReport).toBeDefined();

    // サマリーの先頭は全体判定、次に収束判定を置く (buildSummaryText と同じトーン)。
    const summary = summaryText(response).split("\n");
    expect(summary[0]).toContain("一括判定: FAIL");
    expect(summary[1]).toContain("収束判定:");
  });

  it("共通差分として複数フレームに出た issue 種別を返す", async () => {
    const response = await callBatch({
      campaign_id: "batch-recurring",
      frames: [
        {
          label: "checkout-a",
          design_source: path.join(pair05, "figma-export.png"),
          screenshot: path.join(pair05, "impl-localized-diff.png"),
        },
        {
          label: "checkout-b",
          design_source: path.join(pair05, "figma-export.png"),
          screenshot: path.join(pair05, "impl-localized-diff.png"),
        },
      ],
    });
    const result = batchData(response);

    expect(result.recurringIssues).toContainEqual(
      expect.objectContaining({ kind: "color", frameCount: 2 }),
    );
    expect(result.frames.every((frame) => frame.issueKinds?.includes("color"))).toBe(true);
  });

  it("1件の実行エラーで残りを打ち切らず ERROR として返す", async () => {
    const response = await callBatch({
      campaign_id: "batch-partial-failure",
      frames: [
        {
          label: "ok",
          design_source: path.join(pair01, "figma-export.png"),
          screenshot: path.join(pair01, "impl-correct.png"),
        },
        {
          label: "missing",
          design_source: path.join(pair01, "figma-export.png"),
          screenshot: path.join(pair01, "does-not-exist.png"),
        },
        {
          label: "also-ok",
          design_source: path.join(pair01, "figma-export.png"),
          screenshot: path.join(pair01, "impl-color-off.png"),
        },
      ],
    });
    const result = batchData(response);

    expect(result.frames.map((frame) => frame.status)).toEqual(["PASS", "ERROR", "FAIL"]);
    expect(result.errorCount).toBe(1);
    expect(result.verdict).toBe("ERROR");
    expect(result.frames[1]?.error).toContain("does-not-exist.png");
    // エラーでも比較できたフレームは結果と comparisonId を持つ。
    expect(result.comparisonIds).toHaveLength(2);
    expect(result.convergence.unevaluatedLabels).toEqual(["missing"]);
  });

  it("複数フレームを入力順に逐次比較する", async () => {
    const response = await callBatch({
      campaign_id: "batch-order",
      frames: [
        {
          label: "first",
          design_source: path.join(pair01, "figma-export.png"),
          screenshot: path.join(pair01, "impl-correct.png"),
        },
        {
          label: "second",
          design_source: path.join(pair01, "figma-export.png"),
          screenshot: path.join(pair01, "impl-color-off.png"),
        },
        {
          label: "third",
          design_source: path.join(pair05, "figma-export.png"),
          screenshot: path.join(pair05, "impl-correct.png"),
        },
      ],
    });
    const result = batchData(response);

    expect(result.frames.map((frame) => frame.index)).toEqual([0, 1, 2]);
    expect(result.frames.map((frame) => frame.label)).toEqual(["first", "second", "third"]);
  });
});

describe("compare_design_batch — invalid input diagnostics", () => {
  it("撮影ソースが無いフレームは、どのフレームが誤りかを示して失敗する", async () => {
    const response = await callBatch({
      frames: [{ label: "no-source", design_source: path.join(pair01, "figma-export.png") }],
    });

    expect(response.isError).toBe(true);
    const message = text(response);
    expect(message).toContain("frames[0]");
    expect(message).toContain("どれか1つだけ");
  });

  it("撮影ソースを2つ指定したフレームは失敗する", async () => {
    const response = await callBatch({
      frames: [
        {
          label: "two-sources",
          design_source: path.join(pair01, "figma-export.png"),
          screenshot: path.join(pair01, "impl-correct.png"),
          screenshot_url: "http://127.0.0.1:9/",
        },
      ],
    });

    expect(response.isError).toBe(true);
    expect(text(response)).toContain("frames[0]");
  });

  it("label が重複したら集計の区別が付かないため失敗する", async () => {
    const response = await callBatch({
      frames: [
        {
          label: "dup",
          design_source: path.join(pair01, "figma-export.png"),
          screenshot: path.join(pair01, "impl-correct.png"),
        },
        {
          label: "dup",
          design_source: path.join(pair01, "figma-export.png"),
          screenshot: path.join(pair01, "impl-color-off.png"),
        },
      ],
    });

    expect(response.isError).toBe(true);
    expect(text(response)).toContain("重複");
  });

  it("上限を超えるフレーム数は受け付けない", async () => {
    const frames = Array.from({ length: 11 }, (_value, index) => ({
      label: `frame-${index}`,
      design_source: path.join(pair01, "figma-export.png"),
      screenshot: path.join(pair01, "impl-correct.png"),
    }));

    const response = await callBatch({ frames });

    expect(response.isError).toBe(true);
  });

  it("上限いっぱいの10フレームでもレスポンスは肥大化しない (32KB 未満)", async () => {
    const variants = [
      { design: pair01, screenshot: "impl-correct.png" },
      { design: pair01, screenshot: "impl-color-off.png" },
      { design: pair01, screenshot: "impl-layout-off.png" },
      { design: pair05, screenshot: "impl-localized-diff.png" },
    ];
    const frames = Array.from({ length: 10 }, (_value, index) => {
      const variant = variants[index % variants.length];
      return {
        label: `frame-${index}`,
        design_source: path.join(variant.design, "figma-export.png"),
        screenshot: path.join(variant.design, variant.screenshot),
      };
    });

    const response = await callBatch({ campaign_id: "batch-budget", frames });
    const result = batchData(response);

    expect(result.totalFrames).toBe(10);
    // フレームごとの差分領域は上位3件のみ。全件は comparisonId から取る。
    expect(text(response).length).toBeLessThan(32_768);
    for (const frame of result.frames) {
      expect(frame.diffRegions.length).toBeLessThanOrEqual(3);
    }
  });
});

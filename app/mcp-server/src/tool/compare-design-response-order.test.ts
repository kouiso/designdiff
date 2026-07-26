import { beforeEach, describe, expect, it, vi } from "vitest";

import { registerCompareDesign } from "./compare-design.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const mocks = vi.hoisted(() => ({
  runCompareDesign: vi.fn(),
  writeActiveSession: vi.fn(),
  persistDetailJson: vi.fn(),
}));

vi.mock("../service/compare-design-runner.js", () => ({
  runCompareDesign: mocks.runCompareDesign,
}));
vi.mock("../service/active-session.js", () => ({
  writeActiveSession: mocks.writeActiveSession,
}));
vi.mock("../service/persist-detail.js", () => ({
  persistDetailJson: mocks.persistDetailJson,
}));

interface ToolResponse {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
}
type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResponse>;

function makeResult() {
  return {
    comparisonId: "cmp-order",
    status: "FAIL",
    matchRate: 68,
    diffPixelCount: 940,
    totalPixelCount: 3000,
    diffRegions: [],
    remainingIssues: 5,
    nextAction: "報告",
    suggestion: "-",
    preflight: { warnings: [] },
    completionCriteria: {
      structuralReview: { required: 1, current: 0, status: "FAIL", blocking: true },
      matchRate: { required: 100, current: 68, status: "FAIL" },
      diffPixelCount: { required: 0, current: 940, status: "FAIL" },
      remainingIssues: { required: 0, current: 5, status: "FAIL" },
    },
    loopGuard: {
      iteration: 6,
      decision: "stop",
      reason: "反復回数が上限 (5 回) に達しました。",
    },
  };
}

// server.ts の instructions は「1つ目が JSON、2つ目のサマリー先頭がループ判定」と
// 案内している。並び順が変わると案内が嘘になり、呼び出し側が停止判定を見つけられない。
describe("compare_design レスポンスの並び順", () => {
  let handler: ToolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runCompareDesign.mockResolvedValue({
      parsedDesignSource: { type: "local_path" },
      result: makeResult(),
    });

    const registerTool = vi.fn();
    registerCompareDesign({ registerTool } as unknown as McpServer);
    handler = registerTool.mock.calls[0][2] as ToolHandler;
  });

  it("1つ目のブロックが JSON、2つ目の先頭行がループ判定であること", async () => {
    const res = await handler({ design_source: "./a.png", screenshot: "./b.png" });

    expect(res.content).toHaveLength(2);
    expect(() => JSON.parse(res.content[0].text)).not.toThrow();

    const firstSummaryLine = res.content[1].text.split("\n")[0];
    expect(firstSummaryLine).toContain("ループ判定");
    expect(firstSummaryLine).toContain("停止");
  });

  it("停止判定は互換用の JSON ブロックからも読めること", async () => {
    const res = await handler({ design_source: "./a.png", screenshot: "./b.png" });

    const parsed = JSON.parse(res.content[0].text) as {
      loopGuard?: { decision?: string };
    };
    expect(parsed.loopGuard?.decision).toBe("stop");
  });
});

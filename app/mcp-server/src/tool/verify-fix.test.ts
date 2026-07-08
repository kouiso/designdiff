import * as path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { createMcpServer } from "../server.js";
import { readActiveSession } from "../service/active-session.js";
import { clearComparisonHistory } from "../service/comparison-history.js";

import { axisContribution, buildVerdict } from "./verify-fix.js";

const FIXTURES_ROOT = path.resolve(import.meta.dirname, "../../../../verification/fixtures");

const PAIR02_DIR = path.join(FIXTURES_ROOT, "pair-02-multi-section-lp");

const TextContentSchema = z.object({
  content: z.array(
    z.object({
      type: z.string(),
      text: z.string().optional(),
    }),
  ),
});

function extractText(result: unknown): string {
  const parsed = TextContentSchema.safeParse(result);
  if (!parsed.success) {
    throw new Error("text content not found");
  }

  const textItem = parsed.data.content.find((item) => item.type === "text" && item.text);
  if (!textItem?.text) {
    throw new Error("text content not found");
  }

  return textItem.text;
}

describe("buildVerdict", () => {
  it("色または形状の悪化を regression として扱う", () => {
    expect(buildVerdict(0, 3.1, 0, 0, 3.1)).toBe("regressed");
    expect(buildVerdict(0.02, 3.1, 0, 0, 3.1)).toBe("regressed");
    expect(buildVerdict(0, 0, 0.02, 1, 1)).toBe("regressed");
  });

  it("構造・色・形状の改善を improved として扱う", () => {
    expect(buildVerdict(0.02, 0, 0, 1, 1)).toBe("improved");
    expect(buildVerdict(0, -3.1, 0, 3.1, 0)).toBe("improved");
    expect(buildVerdict(0, 0, -0.02, 1, 1)).toBe("improved");
  });

  it("small color movement on 0..100 scale does not override large structural improvement", () => {
    expect(buildVerdict(0.5, 0.05, 0, 1, 1.05)).toBe("improved");
  });

  it("小さいcolorDeltaでも buildIssues の fail 閾値(2)を跨いだら regressed とする", () => {
    // colorDelta = 0.6 (< COLOR_DELTA_THRESHOLD=2) だが、絶対値が
    // 1.5(pass) -> 2.1(fail) に悪化しているため regressed 扱いにする。
    expect(buildVerdict(0, 0.6, 0, 1.5, 2.1)).toBe("regressed");
  });

  it("閾値を跨がない小さい colorDelta は unchanged のままにする", () => {
    expect(buildVerdict(0, 0.6, 0, 0.5, 1.1)).toBe("unchanged");
  });

  it("structure/color の大幅改善は小さな shape 悪化に打ち消されず improved になる (issue #238 実測ケース)", () => {
    // sample-corporate TOP の hero 修正 (100vh→768px) 実測値。
    // structure 0.398→0.496, color 30.5→19.9, shape 0.146→0.211。
    // 独立オラクル (Playwright実測・目視) では明確な改善やが、
    // 旧ロジックは shapeDelta>0.01 だけで regressed に短絡していた。
    expect(buildVerdict(0.098, -10.6, 0.065, 30.5, 19.9)).toBe("improved");
  });

  it("悪化が優勢なら軸合成でも regressed になる", () => {
    // 上の実測ケースの符号反転: structure/color が悪化し shape だけ改善。
    expect(buildVerdict(-0.098, 10.6, -0.065, 19.9, 30.5)).toBe("regressed");
  });

  it("color のゲート跨ぎは他軸が大幅改善でも regressed を維持する", () => {
    // structure が大きく改善していても、color が pass 域 (<2) から
    // fail 域 (>=2) へ跨いだら compare_design と矛盾しないよう regressed。
    expect(buildVerdict(0.5, 0.6, 0, 1.5, 2.1)).toBe("regressed");
  });
});

describe("axisContribution", () => {
  it("threshold<=0 はゼロ除算を避けて寄与0を返す", () => {
    expect(axisContribution(1, 0, true)).toBe(0);
    expect(axisContribution(1, -1, true)).toBe(0);
  });

  it("閾値超えの delta を正規化した寄与に変換する (higherIsBetter=true)", () => {
    expect(axisContribution(0.02, 0.01, true)).toBe(2);
  });

  it("higherIsBetter=false のときは符号を反転する", () => {
    expect(axisContribution(4, 2, false)).toBe(-2);
  });
});

describe("verify_fix", () => {
  let client: Client;
  let originalAllowedDirs: string | undefined;

  beforeEach(async () => {
    // フィクスチャファイルがパストラバーサルガードを通過できるよう許可ディレクトリを設定する
    originalAllowedDirs = process.env.FIGDIFF_ALLOWED_DIRS;
    process.env.FIGDIFF_ALLOWED_DIRS = FIXTURES_ROOT;

    clearComparisonHistory();
    const server = createMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    client = new Client({ name: "verify-fix-test-client", version: "1.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });

  afterEach(async () => {
    try {
      await client.close();
      clearComparisonHistory();
    } finally {
      // client.close() が失敗しても環境変数を必ず元に戻す
      if (originalAllowedDirs === undefined) {
        delete process.env.FIGDIFF_ALLOWED_DIRS;
      } else {
        process.env.FIGDIFF_ALLOWED_DIRS = originalAllowedDirs;
      }
    }
  });

  it("対象ノードが改善したら improved を返す", async () => {
    const designPath = path.join(PAIR02_DIR, "figma-export.png");
    const priorScreenshot = path.join(PAIR02_DIR, "impl-single-section-regression.png");
    const currentScreenshot = path.join(PAIR02_DIR, "impl-correct.png");

    const prior = await client.callTool({
      name: "compare_design",
      arguments: {
        design_source: designPath,
        screenshot: priorScreenshot,
        threshold: 0.1,
      },
    });

    const priorData = JSON.parse(extractText(prior));
    const result = await client.callTool({
      name: "verify_fix",
      arguments: {
        design_source: designPath,
        screenshot: currentScreenshot,
        prior_comparison_id: priorData.comparisonId,
        expected_target_node_id: "section-footer",
        threshold: 0.1,
      },
    });

    expect(result.isError).toBeFalsy();

    const data = JSON.parse(extractText(result));
    expect(data.fixedNode).toBe("section-footer");
    expect(data.verdict).toBe("improved");
    expect(data.structureDelta).toBeGreaterThan(0.05);
    expect(data.sideEffects).toEqual([]);

    const activeSession = await readActiveSession();
    expect(activeSession?.comparisonId).not.toBe(priorData.comparisonId);
    expect(activeSession?.sourceKey).toBe(activeSession?.comparisonId);
    expect(activeSession?.matchRate).toBe(100);
  });

  it("対象ノードがさらに悪化したら regressed を返す", async () => {
    const designPath = path.join(PAIR02_DIR, "figma-export.png");
    const priorScreenshot = path.join(PAIR02_DIR, "impl-correct.png");
    const currentScreenshot = path.join(PAIR02_DIR, "impl-single-section-regression.png");

    const prior = await client.callTool({
      name: "compare_design",
      arguments: {
        design_source: designPath,
        screenshot: priorScreenshot,
        threshold: 0.1,
      },
    });

    const priorData = JSON.parse(extractText(prior));
    const result = await client.callTool({
      name: "verify_fix",
      arguments: {
        design_source: designPath,
        screenshot: currentScreenshot,
        prior_comparison_id: priorData.comparisonId,
        expected_target_node_id: "section-footer",
        threshold: 0.1,
      },
    });

    const data = JSON.parse(extractText(result));
    expect(data.verdict).toBe("regressed");
    expect(data.structureDelta).toBeLessThan(-0.05);
  });
});

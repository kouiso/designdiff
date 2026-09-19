import { copyFile, mkdtemp, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { createMcpServer } from "../server.js";
import { readActiveSession } from "../service/active-session.js";
import { clearComparisonHistory, getComparisonEntry } from "../service/comparison-history.js";

import { axisContribution, buildVerdict, resolveSessionStatus } from "./verify-fix.js";

const FIXTURES_ROOT = path.resolve(import.meta.dirname, "../../../../verification/fixture");

const PAIR02_DIR = path.join(FIXTURES_ROOT, "pair-02-multi-section-lp");
// 検体の expected.json が持つ比較元ノードのID。期待値とテストデータを1か所に寄せる。
const FIXTURE_ROOT_NODE_ID = "frame-root";

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

describe("resolveSessionStatus", () => {
  // 比較全体が人間レビュー行きなら、対象ノードの改善で上書きしない。
  it("keeps UNCERTAIN whatever the local verdict says", () => {
    expect(resolveSessionStatus("UNCERTAIN", "improved")).toBe("UNCERTAIN");
    expect(resolveSessionStatus("UNCERTAIN", "unchanged")).toBe("UNCERTAIN");
    expect(resolveSessionStatus("UNCERTAIN", "regressed")).toBe("UNCERTAIN");
  });

  it("falls back to the local verdict otherwise", () => {
    expect(resolveSessionStatus("PASS", "improved")).toBe("PASS");
    expect(resolveSessionStatus("PASS", "unchanged")).toBe("FAIL");
    expect(resolveSessionStatus("FAIL", "improved")).toBe("PASS");
    expect(resolveSessionStatus("FAIL", "regressed")).toBe("FAIL");
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
    const priorEntry = await getComparisonEntry(priorData.comparisonId);
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

    expect(result.isError, extractText(result)).toBeFalsy();

    const data = JSON.parse(extractText(result));
    expect(data.fixedNode).toBe("section-footer");
    expect(data.verdict).toBe("improved");
    expect(data.structureDelta).toBeGreaterThan(0.05);
    expect(data.sideEffects).toEqual([]);

    const activeSession = await readActiveSession();
    expect(activeSession?.comparisonId).not.toBe(priorData.comparisonId);
    // sourceKey は比較対象を指す。comparisonId と同じ値になったら、同じ画面への
    // 連続した修正をまとめられず、収束の推移が辿れんようになる。
    expect(activeSession?.sourceKey).not.toBe(activeSession?.comparisonId);
    expect(activeSession?.sourceKey).toBe(`local:${designPath}`);
    expect(activeSession?.matchRate).toBe(100);
    const currentEntry = activeSession
      ? await getComparisonEntry(activeSession.comparisonId)
      : undefined;
    expect(priorEntry?.result.normalization?.screenshotHeight).toBe(1548);
    expect(currentEntry?.result.normalization?.screenshotHeight).toBe(600);
    expect(priorEntry?.result.normalization?.containResized).toBe(true);
    expect(currentEntry?.result.normalization?.containResized).toBe(false);
  });

  it("ディスクから復元したbaselineでもverification contextを照合する", async () => {
    const fixtureDirectory = path.join(FIXTURES_ROOT, "pair-01-simple-static-lp");
    const designPath = path.join(fixtureDirectory, "figma-export.png");
    const screenshotPath = path.join(fixtureDirectory, "impl-layout-off.png");
    const prior = await client.callTool({
      name: "compare_design",
      arguments: { design_source: designPath, screenshot: screenshotPath },
    });
    const priorData = z.object({ comparisonId: z.string() }).parse(JSON.parse(extractText(prior)));

    clearComparisonHistory();
    const restored = await getComparisonEntry(priorData.comparisonId);
    expect(restored?.result.verificationContext?.fingerprint).toMatch(/^[0-9a-f]{64}$/);

    const result = await client.callTool({
      name: "verify_fix",
      arguments: {
        design_source: designPath,
        screenshot: screenshotPath,
        prior_comparison_id: priorData.comparisonId,
        expected_target_node_id: "whole-frame",
      },
    });

    expect(result.isError, extractText(result)).toBeFalsy();
  });

  it("前回比較のキャンペーンを引き継ぎ、既定履歴へ混ぜない", async () => {
    const fixtureDirectory = path.join(FIXTURES_ROOT, "pair-01-simple-static-lp");
    const designPath = path.join(fixtureDirectory, "figma-export.png");
    const screenshotPath = path.join(fixtureDirectory, "impl-layout-off.png");
    const prior = await client.callTool({
      name: "compare_design",
      arguments: {
        design_source: designPath,
        screenshot: screenshotPath,
        campaign_id: "verify-fix-campaign",
      },
    });
    const priorData = z.object({ comparisonId: z.string() }).parse(JSON.parse(extractText(prior)));
    const priorEntry = await getComparisonEntry(priorData.comparisonId);

    const result = await client.callTool({
      name: "verify_fix",
      arguments: {
        design_source: designPath,
        screenshot: screenshotPath,
        prior_comparison_id: priorData.comparisonId,
        expected_target_node_id: "whole-frame",
      },
    });
    expect(result.isError).toBeFalsy();
    const activeSession = await readActiveSession();
    const currentId = z.string().parse(activeSession?.comparisonId);
    const currentEntry = await getComparisonEntry(currentId);
    expect(currentEntry?.sourceKey).toBe(priorEntry?.sourceKey);
    expect(currentEntry?.sourceKey).not.toBe(`local:${designPath}`);
    expect(currentEntry?.result.loopGuard?.step).toBe(2);
  });

  it("whole-frame行を持たない旧baselineには再記録手順を返す", async () => {
    const fixtureDirectory = path.join(FIXTURES_ROOT, "pair-01-simple-static-lp");
    const designPath = path.join(fixtureDirectory, "figma-export.png");
    const screenshotPath = path.join(fixtureDirectory, "impl-layout-off.png");
    const prior = await client.callTool({
      name: "compare_design",
      arguments: { design_source: designPath, screenshot: screenshotPath },
    });
    const priorData = z.object({ comparisonId: z.string() }).parse(JSON.parse(extractText(prior)));
    const priorEntry = await getComparisonEntry(priorData.comparisonId);
    if (!priorEntry?.result.diffReport) {
      throw new Error("prior diff report not found");
    }

    // whole-frame 行を導入する前の保存形式を再現する。通常の missing と同じ文言だと、
    // 呼ぶ側は存在しない node ID を探し続けて baseline の取り直しへ進めない。
    priorEntry.result.diffReport.regionScores = priorEntry.result.diffReport.regionScores.filter(
      (score) => score.scope !== "root",
    );

    const result = await client.callTool({
      name: "verify_fix",
      arguments: {
        design_source: designPath,
        screenshot: screenshotPath,
        prior_comparison_id: priorData.comparisonId,
        expected_target_node_id: "whole-frame",
      },
    });

    expect(result.isError).toBeTruthy();
    expect(extractText(result)).toContain(
      `baseline predates the whole-frame row: ${priorData.comparisonId}`,
    );
    expect(extractText(result)).toContain("run compare_design once more");
  });

  // 局所比較では子の行しか無く、対象ノード自身の行が無いと引き当てに失敗していた。
  // 自分の修正を自分で確かめられないと、任せっきりの前提が崩れる。
  // 検体は子3件を持つので、子の行がある経路をそのまま通る。
  it("比較対象そのもののノードIDでも引き当てられること", async () => {
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
        expected_target_node_id: FIXTURE_ROOT_NODE_ID,
        threshold: 0.1,
      },
    });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(extractText(result));
    expect(data.fixedNode).toBe(FIXTURE_ROOT_NODE_ID);
  });

  it("引き当てに失敗したときは、引ける名前を添えて返すこと", async () => {
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
        expected_target_node_id: "no-such-node",
        threshold: 0.1,
      },
    });

    expect(result.isError).toBeTruthy();
    const message = extractText(result);
    // 「候補あり」とだけ言われても、正解の名前が分からないまま探し直しになる。
    expect(message).toContain("available:");
    expect(message).toContain(FIXTURE_ROOT_NODE_ID);
    expect(message).not.toContain("(なし)");
  });

  // verdict は対象ノードが良くなったかだけを答える。比較そのものが人間レビューへ
  // 回っているなら、局所的な改善でそれを握り潰さない。
  it("比較全体の status を verdict と別に持ち上げる", async () => {
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

    const data = JSON.parse(extractText(result));
    expect(data.verdict).toBe("improved");

    const activeSession = await readActiveSession();
    expect(activeSession?.status).toBe(resolveSessionStatus(data.comparisonStatus, data.verdict));
  });

  // FigDiff 自身の判定を「正解」として使うと、検証したい分類器そのものに依存する。
  // ここで見るのは伝播だけ。runner が返した status がそのまま出てくるか、
  // セッションにも同じ判断が反映されるかを、値の中身を決めつけずに確かめる。
  it("runner の status をそのまま持ち上げ、セッションにも反映する", async () => {
    const designPath = path.join(PAIR02_DIR, "figma-export.png");
    const priorScreenshot = path.join(PAIR02_DIR, "impl-multi-section-drift.png");
    const currentScreenshot = path.join(PAIR02_DIR, "impl-single-section-regression.png");

    const prior = await client.callTool({
      name: "compare_design",
      arguments: { design_source: designPath, screenshot: priorScreenshot, threshold: 0.1 },
    });
    const priorData = JSON.parse(extractText(prior));

    const current = await client.callTool({
      name: "compare_design",
      arguments: { design_source: designPath, screenshot: currentScreenshot, threshold: 0.1 },
    });
    const runnerStatus = JSON.parse(extractText(current)).status;

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
    expect(data.comparisonStatus).toBe(runnerStatus);

    const activeSession = await readActiveSession();
    expect(activeSession?.status).toBe(resolveSessionStatus(runnerStatus, data.verdict));
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

  it("threshold がbaselineから変わった場合は領域比較を拒否する", async () => {
    const fixtureDirectory = path.join(FIXTURES_ROOT, "pair-01-simple-static-lp");
    const designPath = path.join(fixtureDirectory, "figma-export.png");
    const screenshotPath = path.join(fixtureDirectory, "impl-layout-off.png");
    const prior = await client.callTool({
      name: "compare_design",
      arguments: { design_source: designPath, screenshot: screenshotPath, threshold: 0.1 },
    });
    const priorData = z.object({ comparisonId: z.string() }).parse(JSON.parse(extractText(prior)));
    const result = await client.callTool({
      name: "verify_fix",
      arguments: {
        design_source: designPath,
        screenshot: screenshotPath,
        prior_comparison_id: priorData.comparisonId,
        expected_target_node_id: "whole-frame",
        threshold: 0.2,
      },
    });

    expect(result.isError).toBeTruthy();
    expect(extractText(result)).toContain("comparison.effectiveThreshold");
  });

  it("effective thresholdが同じでもprofile指定が変われば拒否する", async () => {
    const fixtureDirectory = path.join(FIXTURES_ROOT, "pair-01-simple-static-lp");
    const designPath = path.join(fixtureDirectory, "figma-export.png");
    const screenshotPath = path.join(fixtureDirectory, "impl-layout-off.png");
    const prior = await client.callTool({
      name: "compare_design",
      arguments: { design_source: designPath, screenshot: screenshotPath },
    });
    const priorData = z.object({ comparisonId: z.string() }).parse(JSON.parse(extractText(prior)));
    const result = await client.callTool({
      name: "verify_fix",
      arguments: {
        design_source: designPath,
        screenshot: screenshotPath,
        prior_comparison_id: priorData.comparisonId,
        expected_target_node_id: "whole-frame",
        profile: "balanced",
      },
    });

    expect(result.isError).toBeTruthy();
    expect(extractText(result)).toContain("comparison.profile");
  });

  it("baselineのdeclared comparison conditionsを省略時に復元する", async () => {
    const fixtureDirectory = path.join(FIXTURES_ROOT, "pair-01-simple-static-lp");
    const designPath = path.join(fixtureDirectory, "figma-export.png");
    const screenshotPath = path.join(fixtureDirectory, "impl-layout-off.png");
    const comparisonConditions = {
      design: { viewport: { width: 400, height: 300 }, pixelRatio: 1, origin: { x: 0, y: 0 } },
      screenshot: {
        viewport: { width: 400, height: 300 },
        pixelRatio: 1,
        origin: { x: 0, y: 0 },
      },
    };
    const prior = await client.callTool({
      name: "compare_design",
      arguments: {
        design_source: designPath,
        screenshot: screenshotPath,
        comparison_conditions: comparisonConditions,
      },
    });
    const priorData = z.object({ comparisonId: z.string() }).parse(JSON.parse(extractText(prior)));
    const result = await client.callTool({
      name: "verify_fix",
      arguments: {
        design_source: designPath,
        screenshot: screenshotPath,
        prior_comparison_id: priorData.comparisonId,
        expected_target_node_id: "whole-frame",
      },
    });

    expect(result.isError, extractText(result)).toBeFalsy();
  });

  it("明示したcomparison conditionsがbaselineから変われば拒否する", async () => {
    const fixtureDirectory = path.join(FIXTURES_ROOT, "pair-01-simple-static-lp");
    const designPath = path.join(fixtureDirectory, "figma-export.png");
    const screenshotPath = path.join(fixtureDirectory, "impl-layout-off.png");
    const prior = await client.callTool({
      name: "compare_design",
      arguments: {
        design_source: designPath,
        screenshot: screenshotPath,
        comparison_conditions: {
          design: { pixelRatio: 1 },
          screenshot: { pixelRatio: 1 },
        },
      },
    });
    const priorData = z.object({ comparisonId: z.string() }).parse(JSON.parse(extractText(prior)));
    const result = await client.callTool({
      name: "verify_fix",
      arguments: {
        design_source: designPath,
        screenshot: screenshotPath,
        prior_comparison_id: priorData.comparisonId,
        expected_target_node_id: "whole-frame",
        comparison_conditions: {
          design: { pixelRatio: 2 },
          screenshot: { pixelRatio: 2 },
        },
      },
    });

    expect(result.isError).toBeTruthy();
    expect(extractText(result)).toContain("comparison.declaredConditions");
  });

  it("同じmask IDの座標が変わった場合は領域比較を拒否する", async () => {
    const fixtureDirectory = path.join(FIXTURES_ROOT, "pair-01-simple-static-lp");
    const designPath = path.join(fixtureDirectory, "figma-export.png");
    const screenshotPath = path.join(fixtureDirectory, "impl-layout-off.png");
    const projectId = `verify-mask-${crypto.randomUUID()}`;
    const created = await client.callTool({
      name: "create_project",
      arguments: { id: projectId, name: projectId, implementation_url: "https://example.test" },
    });
    expect(created.isError, extractText(created)).toBeFalsy();
    await client.callTool({
      name: "set_ignore_regions",
      arguments: {
        project_id: projectId,
        regions: [{ id: "same-id", x: 0, y: 0, width: 10, height: 10 }],
      },
    });
    const prior = await client.callTool({
      name: "compare_design",
      arguments: { design_source: designPath, screenshot: screenshotPath, project_id: projectId },
    });
    const priorData = z.object({ comparisonId: z.string() }).parse(JSON.parse(extractText(prior)));
    await client.callTool({
      name: "set_ignore_regions",
      arguments: {
        project_id: projectId,
        regions: [{ id: "same-id", x: 20, y: 0, width: 10, height: 10 }],
      },
    });
    const result = await client.callTool({
      name: "verify_fix",
      arguments: {
        design_source: designPath,
        screenshot: screenshotPath,
        project_id: projectId,
        prior_comparison_id: priorData.comparisonId,
        expected_target_node_id: "whole-frame",
      },
    });

    expect(result.isError).toBeTruthy();
    expect(extractText(result)).toMatch(/mask\.(effectiveRegions|maskSha256)/);
  });

  it("適用cropが変わった場合は領域比較を拒否する", async () => {
    const fixtureDirectory = path.join(FIXTURES_ROOT, "pair-01-simple-static-lp");
    const designPath = path.join(fixtureDirectory, "figma-export.png");
    const screenshotPath = path.join(fixtureDirectory, "impl-layout-off.png");
    const projectId = `verify-crop-${crypto.randomUUID()}`;
    const created = await client.callTool({
      name: "create_project",
      arguments: { id: projectId, name: projectId, implementation_url: "https://example.test" },
    });
    expect(created.isError, extractText(created)).toBeFalsy();
    await client.callTool({
      name: "set_crop_region",
      arguments: {
        project_id: projectId,
        frame_name: "",
        region: { x: 0, y: 0, width: 400, height: 300 },
      },
    });
    const prior = await client.callTool({
      name: "compare_design",
      arguments: { design_source: designPath, screenshot: screenshotPath, project_id: projectId },
    });
    const priorData = z.object({ comparisonId: z.string() }).parse(JSON.parse(extractText(prior)));
    await client.callTool({
      name: "set_crop_region",
      arguments: {
        project_id: projectId,
        frame_name: "",
        region: { x: 1, y: 0, width: 399, height: 300 },
      },
    });
    const result = await client.callTool({
      name: "verify_fix",
      arguments: {
        design_source: designPath,
        screenshot: screenshotPath,
        project_id: projectId,
        prior_comparison_id: priorData.comparisonId,
        expected_target_node_id: "whole-frame",
      },
    });

    expect(result.isError).toBeTruthy();
    expect(extractText(result)).toContain("comparison.geometry");
  });

  it("design sourceが変わった場合は領域比較を拒否する", async () => {
    const baselineDirectory = path.join(FIXTURES_ROOT, "pair-01-simple-static-lp");
    const currentDirectory = path.join(FIXTURES_ROOT, "pair-02-multi-section-lp");
    const baselineDesign = path.join(baselineDirectory, "figma-export.png");
    const baselineScreenshot = path.join(baselineDirectory, "impl-layout-off.png");
    const currentDesign = path.join(currentDirectory, "figma-export.png");
    const currentScreenshot = path.join(currentDirectory, "impl-correct.png");
    const prior = await client.callTool({
      name: "compare_design",
      arguments: { design_source: baselineDesign, screenshot: baselineScreenshot },
    });
    const priorData = z.object({ comparisonId: z.string() }).parse(JSON.parse(extractText(prior)));
    const priorEntry = await getComparisonEntry(priorData.comparisonId);
    expect(JSON.stringify(priorEntry?.result.verificationContext)).not.toContain(baselineDesign);
    const result = await client.callTool({
      name: "verify_fix",
      arguments: {
        design_source: currentDesign,
        screenshot: currentScreenshot,
        prior_comparison_id: priorData.comparisonId,
        expected_target_node_id: "whole-frame",
      },
    });

    expect(result.isError).toBeTruthy();
    expect(extractText(result)).toMatch(/design\.(sourceIdentitySha256|imageSha256)/);
  });

  it("同じdesign pathのPNG bytesが変わった場合は領域比較を拒否する", async () => {
    const fixtureDirectory = path.join(FIXTURES_ROOT, "pair-01-simple-static-lp");
    const sourceDesign = path.join(fixtureDirectory, "figma-export.png");
    const screenshotPath = path.join(fixtureDirectory, "impl-layout-off.png");
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "figdiff-verify-design-"));
    const designPath = path.join(temporaryDirectory, "design.png");
    const changedPath = path.join(temporaryDirectory, "changed.png");
    await copyFile(sourceDesign, designPath);
    process.env.FIGDIFF_ALLOWED_DIRS = temporaryDirectory;
    const prior = await client.callTool({
      name: "compare_design",
      arguments: { design_source: designPath, screenshot: screenshotPath },
    });
    const priorData = z.object({ comparisonId: z.string() }).parse(JSON.parse(extractText(prior)));
    await sharp(designPath)
      .composite([
        {
          input: {
            create: {
              width: 1,
              height: 1,
              channels: 4,
              background: { r: 255, g: 0, b: 255, alpha: 1 },
            },
          },
          left: 0,
          top: 0,
        },
      ])
      .png()
      .toFile(changedPath);
    await rename(changedPath, designPath);
    const result = await client.callTool({
      name: "verify_fix",
      arguments: {
        design_source: designPath,
        screenshot: screenshotPath,
        prior_comparison_id: priorData.comparisonId,
        expected_target_node_id: "whole-frame",
      },
    });

    expect(result.isError).toBeTruthy();
    expect(extractText(result)).toContain("design.imageSha256");
  });

  it("design backgroundが変わった場合は領域比較を拒否する", async () => {
    const fixtureDirectory = path.join(FIXTURES_ROOT, "pair-01-simple-static-lp");
    const designPath = path.join(fixtureDirectory, "figma-export.png");
    const screenshotPath = path.join(fixtureDirectory, "impl-layout-off.png");
    const prior = await client.callTool({
      name: "compare_design",
      arguments: {
        design_source: designPath,
        screenshot: screenshotPath,
        design_background: "#fff",
      },
    });
    const priorData = z.object({ comparisonId: z.string() }).parse(JSON.parse(extractText(prior)));
    const result = await client.callTool({
      name: "verify_fix",
      arguments: {
        design_source: designPath,
        screenshot: screenshotPath,
        design_background: "#000",
        prior_comparison_id: priorData.comparisonId,
        expected_target_node_id: "whole-frame",
      },
    });

    expect(result.isError).toBeTruthy();
    expect(extractText(result)).toContain("design.background");
  });

  it("verification contextのない旧baselineには再取得手順を返す", async () => {
    const fixtureDirectory = path.join(FIXTURES_ROOT, "pair-01-simple-static-lp");
    const designPath = path.join(fixtureDirectory, "figma-export.png");
    const screenshotPath = path.join(fixtureDirectory, "impl-layout-off.png");
    const prior = await client.callTool({
      name: "compare_design",
      arguments: { design_source: designPath, screenshot: screenshotPath },
    });
    const priorData = z.object({ comparisonId: z.string() }).parse(JSON.parse(extractText(prior)));
    const priorEntry = await getComparisonEntry(priorData.comparisonId);
    if (!priorEntry) throw new Error("prior comparison missing");
    priorEntry.result.verificationContext = undefined;
    const result = await client.callTool({
      name: "verify_fix",
      arguments: {
        design_source: designPath,
        screenshot: screenshotPath,
        prior_comparison_id: priorData.comparisonId,
        expected_target_node_id: "whole-frame",
      },
    });

    expect(result.isError).toBeTruthy();
    expect(extractText(result)).toContain("baseline predates verification context");
    expect(extractText(result)).toContain("run compare_design once more");
  });

  it("fingerprintがpayloadと一致しないbaselineを拒否する", async () => {
    const fixtureDirectory = path.join(FIXTURES_ROOT, "pair-01-simple-static-lp");
    const designPath = path.join(fixtureDirectory, "figma-export.png");
    const screenshotPath = path.join(fixtureDirectory, "impl-layout-off.png");
    const prior = await client.callTool({
      name: "compare_design",
      arguments: { design_source: designPath, screenshot: screenshotPath },
    });
    const priorData = z.object({ comparisonId: z.string() }).parse(JSON.parse(extractText(prior)));
    const priorEntry = await getComparisonEntry(priorData.comparisonId);
    if (!priorEntry?.result.verificationContext) {
      throw new Error("prior verification context missing");
    }
    priorEntry.result.verificationContext.fingerprint = "0".repeat(64);

    const result = await client.callTool({
      name: "verify_fix",
      arguments: {
        design_source: designPath,
        screenshot: screenshotPath,
        prior_comparison_id: priorData.comparisonId,
        expected_target_node_id: "whole-frame",
      },
    });

    expect(result.isError).toBeTruthy();
    expect(extractText(result)).toContain("baseline verification context is invalid");
    expect(extractText(result)).toContain("run compare_design once more");
  });
});

// designdiff#218 — threshold 未満の低振幅差分 (影のぼかし・グラデーション) が
// diffPixelCount=0 / PASS に見える誤判定を防ぐため、subThresholdDiffPixelCount と
// 警告を返すことの regression test。pixelmatch / sharp は本物を使う。
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { CompareDesignResultSchema } from "@figdiff/shared";
import type { CompareDesignResult } from "@figdiff/shared";

import { createMcpServer } from "../server.js";
import { clearComparisonHistory } from "../service/comparison-history.js";

import { buildSummaryText } from "./compare-design.js";

const width = 64;
const height = 64;

const solidGray = async (value: number): Promise<Buffer> =>
  sharp(Buffer.alloc(width * height * 3, value), {
    raw: { width, height, channels: 3 },
  })
    .png()
    .toBuffer();

describe("compare_design — threshold 未満の低振幅差分の報告", () => {
  let directory: string;
  let client: Client;
  let server: ReturnType<typeof createMcpServer>;
  let designPath: string;
  let subtlePath: string;
  let obviousPath: string;

  const callCompare = async (screenshotPath: string, threshold = 0.1) => {
    const response = await client.callTool({
      name: "compare_design",
      arguments: {
        design_source: designPath,
        screenshot: screenshotPath,
        threshold,
      },
    });
    expect(response.isError).toBeFalsy();
    const content = z
      .array(z.object({ type: z.string(), text: z.string() }))
      .parse(response.content);
    return {
      result: CompareDesignResultSchema.parse(response.structuredContent),
      // 警告が「JSON にだけ出る」状態へ退行しないかを見るため、人間向けサマリー
      // (応答の 2 ブロック目という順序はツールの公開契約) を別に取る。
      summary: content[1]?.text ?? "",
    };
  };
  const compare = async (screenshotPath: string) => (await callCompare(screenshotPath)).result;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "figdiff-sub-threshold-"));
    vi.stubEnv("FIGDIFF_HOME", join(directory, "store"));
    vi.stubEnv("FIGDIFF_ALLOWED_DIRS", directory);
    clearComparisonHistory();
    designPath = join(directory, "design.png");
    subtlePath = join(directory, "subtle.png");
    obviousPath = join(directory, "obvious.png");
    // 全画素が 1 チャンネルあたり 6 だけ暗い。pixelmatch threshold=0.1 では
    // 1 画素も差分にならないが、生の画素値は全面で異なる (影のぼかし差の見立て)。
    const [design, subtle, obvious] = await Promise.all([
      solidGray(200),
      solidGray(194),
      solidGray(0),
    ]);
    await Promise.all([
      writeFile(designPath, design),
      writeFile(subtlePath, subtle),
      writeFile(obviousPath, obvious),
    ]);
    server = createMcpServer();
    client = new Client({ name: "sub-threshold-regression", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(a), server.connect(b)]);
  });

  afterEach(async () => {
    await client?.close();
    await server?.close();
    clearComparisonHistory();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("同一画像では差分も閾値未満差分も0で、警告も出ない", async () => {
    const result = await compare(designPath);
    expect(result.diffPixelCount).toBe(0);
    expect(result.subThresholdDiffPixelCount).toBe(0);
    expect(result.suggestion).not.toContain("threshold 未満");
  });

  it("全差分が閾値未満のとき、件数と警告を返す", async () => {
    const result = await compare(subtlePath);
    expect(result.diffPixelCount).toBe(0);
    // status は構造・色の別系統の検出器が決めるため、ここでは件数と警告だけを見る。
    expect(result.subThresholdDiffPixelCount).toBe(width * height);
    expect(result.suggestion).toContain(
      "全差分が threshold 未満の低振幅差分です（影のぼかし・グラデーション・微細な色ズレの可能性）。",
    );
  });

  it("全差分が閾値未満のとき、JSON だけでなく人間向けサマリーにも件数と警告を出す", async () => {
    const { result, summary } = await callCompare(subtlePath);
    expect(result.diffPixelCount).toBe(0);
    expect(summary).toContain(
      `threshold 未満の差分画素: ${width * height} px (採点対象 ${width * height} px の 100.00%)`,
    );
    expect(summary).toContain(
      "全差分が threshold 未満の低振幅差分です（影のぼかし・グラデーション・微細な色ズレの可能性）。",
    );
    // この fixture は色解析が全体の色ズレを検出して FAIL / ループ判定 続行 を
    // 返すため、案内は再比較を促す側になる。停止時の人間報告への振り分けは
    // buildSummaryText のユニットテストで担保する。
    expect(summary).toContain("threshold を下げて (例: 0) 再比較するか差分を目視で確認");
    expect(summary).not.toContain("人間に報告");
  });

  it("threshold を 0 に下げると同じ差分が diffPixelCount に数えられ、警告は消える", async () => {
    const { result, summary } = await callCompare(subtlePath, 0);
    expect(result.diffPixelCount).toBe(width * height);
    // フィールドは diffPixelCount=0 の比較にだけ返す契約。
    expect(result.subThresholdDiffPixelCount).toBeUndefined();
    expect(summary).not.toContain("threshold 未満");
  });

  it("同一画像のサマリーには閾値未満差分の行を出さない", async () => {
    const { summary } = await callCompare(designPath);
    expect(summary).not.toContain("threshold 未満");
  });

  it("透明な design と白い screenshot の見た目一致を閾値未満差分に数えない", async () => {
    // Figma 書き出しの全面透明 (0,0,0,0) と、白く描画された実装。
    // pixelmatch は白へブレンドして一致と見るので、件数も警告も出ないはず。
    const transparentPath = join(directory, "transparent.png");
    await writeFile(
      transparentPath,
      await sharp(Buffer.alloc(width * height * 4, 0), {
        raw: { width, height, channels: 4 },
      })
        .png()
        .toBuffer(),
    );
    const whitePath = join(directory, "white.png");
    await writeFile(whitePath, await solidGray(255));
    const response = await client.callTool({
      name: "compare_design",
      arguments: { design_source: transparentPath, screenshot: whitePath, threshold: 0.1 },
    });
    expect(response.isError).toBeFalsy();
    const result = CompareDesignResultSchema.parse(response.structuredContent);
    expect(result.diffPixelCount).toBe(0);
    expect(result.subThresholdDiffPixelCount).toBe(0);
    expect(result.suggestion).not.toContain("threshold 未満");
  });

  it("閾値を越える明確な差分では、閾値未満の件数は返さず警告も出ない", async () => {
    const result = await compare(obviousPath);
    expect(result.diffPixelCount).toBe(width * height);
    expect(result.subThresholdDiffPixelCount).toBeUndefined();
    expect(result.suggestion).not.toContain("threshold 未満");
  });
});

describe("buildSummaryText — threshold 未満の低振幅差分", () => {
  const base = {
    comparisonId: "sub-threshold-summary",
    status: "PASS",
    matchRate: 100,
    diffPixelCount: 0,
    totalPixelCount: 1000,
    diffRegions: [],
    suggestion: "差分なし",
  } satisfies Partial<CompareDesignResult>;
  const build = (overrides: Partial<CompareDesignResult>): string =>
    buildSummaryText(CompareDesignResultSchema.parse({ ...base, ...overrides }));

  it("diffPixelCount=0 かつ閾値未満差分ありなら件数と割合を出す", () => {
    const text = build({ subThresholdDiffPixelCount: 76 });
    expect(text).toContain("threshold 未満の差分画素: 76 px (採点対象 1000 px の 7.60%)");
    expect(text).toContain("全差分が threshold 未満の低振幅差分です");
  });

  it("diffPixelCount が 1 以上なら閾値を越えた差分が既に見えているので出さない", () => {
    expect(build({ diffPixelCount: 5, subThresholdDiffPixelCount: 76 })).not.toContain(
      "threshold 未満",
    );
  });

  it("フィールドが無い旧形式の結果では出さない", () => {
    expect(build({})).not.toContain("threshold 未満");
  });

  it("採点対象が 0 px でも割合で 0 除算せず件数だけ出す", () => {
    const text = build({ totalPixelCount: 0, subThresholdDiffPixelCount: 3 });
    expect(text).toContain("threshold 未満の差分画素: 3 px");
    expect(text).not.toContain("採点対象");
    expect(text).not.toContain("NaN");
  });

  // ループ判定はサマリー内のすべてに優先する契約。停止なのに「再比較」と出すと
  // エージェントが契約違反の再呼出しを試みるため、案内は判定状態で切り替える。
  it("ループ判定が続行なら threshold を下げた再比較を案内する", () => {
    const text = build({
      subThresholdDiffPixelCount: 76,
      loopGuard: {
        stop: false,
        step: 2,
        maxSteps: 10,
        remainingSteps: 8,
        reason: "continue",
        message: "差分が残っています。続行してください。",
      },
    });
    expect(text).toContain("threshold を下げて (例: 0) 再比較するか差分を目視で確認");
    expect(text).not.toContain("人間に報告");
  });

  it("ループ判定が停止なら再比較ではなく人間への報告を案内する", () => {
    const text = build({
      subThresholdDiffPixelCount: 76,
      loopGuard: {
        stop: true,
        step: 1,
        maxSteps: 10,
        remainingSteps: 0,
        reason: "no-regression",
        message: "PASS に到達しました (反復 1 回)。ループを終了してください。",
      },
    });
    expect(text).toContain("ループ判定が 停止");
    expect(text).toContain("人間に報告");
    expect(text).not.toContain("再比較するか差分を目視で確認");
  });

  it("ループ判定を取得できない結果も停止として扱い人間への報告を案内する", () => {
    const text = build({ subThresholdDiffPixelCount: 76 });
    expect(text).toContain("ループ判定が 停止");
    expect(text).toContain("人間に報告");
  });
});

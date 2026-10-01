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

import { CompareDesignResultSchema } from "@figdiff/shared";

import { createMcpServer } from "../server.js";
import { clearComparisonHistory } from "../service/comparison-history.js";

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

  const compare = async (screenshotPath: string) => {
    const response = await client.callTool({
      name: "compare_design",
      arguments: {
        design_source: designPath,
        screenshot: screenshotPath,
        threshold: 0.1,
      },
    });
    expect(response.isError).toBeFalsy();
    return CompareDesignResultSchema.parse(response.structuredContent);
  };

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
      "全差分が threshold 未満の低振幅差分です（影・グラデーション・AA縁の可能性）。",
    );
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

  it("閾値を越える明確な差分では、閾値未満の件数は0で警告も出ない", async () => {
    const result = await compare(obviousPath);
    expect(result.diffPixelCount).toBe(width * height);
    expect(result.subThresholdDiffPixelCount).toBe(0);
    expect(result.suggestion).not.toContain("threshold 未満");
  });
});

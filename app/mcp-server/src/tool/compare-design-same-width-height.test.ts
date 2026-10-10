// 同幅・軽い高さ差のフルページ比較で、縦横比不一致の preflight 警告が critical の
// まま残り likely_misconfig に倒れていた不具合の regression test。
// 高さ比が full_page_vs_viewport を超える入力は従来の扱いを保つことも固定する。
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

const WIDTH = 120;
const SCREENSHOT_HEIGHT = 200;

const pagePng = async (height: number): Promise<Buffer> => {
  const data = Buffer.alloc(WIDTH * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const offset = (y * WIDTH + x) * 4;
      const stripe = Math.floor(x / 3) % 2 === 0 ? 30 : 220;
      const band = Math.floor(y / 10) % 3;
      data[offset] = stripe;
      data[offset + 1] = band === 0 ? 60 : 160;
      data[offset + 2] = band === 2 ? 40 : 200;
      data[offset + 3] = 255;
    }
  }
  return sharp(data, { raw: { width: WIDTH, height, channels: 4 } })
    .png()
    .toBuffer();
};

describe("compare_design — 同幅・異高の縦横比警告", () => {
  let directory: string;
  let client: Client;
  let server: ReturnType<typeof createMcpServer>;
  let screenshotPath: string;

  const compareWithDesignHeight = async (designHeight: number) => {
    const designPath = join(directory, `design-${designHeight}.png`);
    await writeFile(designPath, await pagePng(designHeight));
    const response = await client.callTool({
      name: "compare_design",
      arguments: { design_source: designPath, screenshot: screenshotPath, threshold: 0.1 },
    });
    expect(response.isError).toBeFalsy();
    return CompareDesignResultSchema.parse(response.structuredContent);
  };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "figdiff-same-width-height-"));
    vi.stubEnv("FIGDIFF_HOME", join(directory, "store"));
    vi.stubEnv("FIGDIFF_ALLOWED_DIRS", directory);
    clearComparisonHistory();
    screenshotPath = join(directory, "screenshot.png");
    await writeFile(screenshotPath, await pagePng(SCREENSHOT_HEIGHT));
    server = createMcpServer();
    client = new Client({ name: "same-width-height-regression", version: "1" });
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

  it("軽い高さ差は縮小せず比較し、縦横比警告を critical から降格して設定ミス扱いしない", async () => {
    const designHeight = 220;
    const result = await compareWithDesignHeight(designHeight);

    expect(result.normalization?.containResized).toBe(false);
    expect(result.normalization?.screenshotBottomPaddingRows).toBe(
      designHeight - SCREENSHOT_HEIGHT,
    );
    expect(result.diffPixelCount).toBe(WIDTH * (designHeight - SCREENSHOT_HEIGHT));

    const aspectWarning = result.preflight?.warnings.find(
      (warning) => warning.code === "aspect_ratio_mismatch",
    );
    expect(aspectWarning?.severity).toBe("warning");
    expect(aspectWarning?.message).toContain("縮小せず上端揃えで比較しました");
    expect(aspectWarning?.message).toContain(`${designHeight - SCREENSHOT_HEIGHT}px`);
    expect(
      result.preflight?.warnings.some(
        (warning) => warning.code === "aspect_ratio_mismatch" && warning.severity === "critical",
      ),
    ).toBe(false);
    expect(result.diagnosis?.likelyMisconfig).toBe(false);
    expect(result.diagnosis?.verdict).not.toBe("likely_misconfig");
  });

  it("フルページ design と単一ビューポート撮影 (高さ比 > 1.4) は従来どおり critical のまま contain 正規化する", async () => {
    const result = await compareWithDesignHeight(SCREENSHOT_HEIGHT * 2);

    expect(result.normalization?.containResized).toBe(true);
    expect(result.normalization?.screenshotBottomPaddingRows).toBeUndefined();
    const aspectWarning = result.preflight?.warnings.find(
      (warning) => warning.code === "aspect_ratio_mismatch",
    );
    expect(aspectWarning?.severity).toBe("critical");
    expect(aspectWarning?.message).not.toContain("上端揃え");
  });
});

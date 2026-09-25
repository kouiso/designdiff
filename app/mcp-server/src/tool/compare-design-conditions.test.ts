import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CompareDesignResultSchema, type ComparisonConditionsInput } from "@figdiff/shared";

import { createMcpServer } from "../server.js";
import { clearComparisonHistory, getComparisonEntry } from "../service/comparison-history.js";
import { listConvergenceHistories } from "../service/convergence-history.js";

const width = 390;
const height = 1839;
const coordinate = (viewportHeight: number, y = 0) => ({
  viewport: { width, height: viewportHeight },
  pixelRatio: 1,
  origin: { x: 0, y },
});

describe("実画像と公開MCPの座標条件", () => {
  let directory: string;
  let client: Client;
  let server: ReturnType<typeof createMcpServer>;
  let designPath: string;
  let shiftedPath: string;
  let rawDifference: number;

  const connect = async () => {
    server = createMcpServer();
    client = new Client({ name: "coordinate-regression", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(a), server.connect(b)]);
  };
  const compare = async (conditions?: ComparisonConditionsInput, screenshot?: string) => {
    const response = await client.callTool({
      name: "compare_design",
      arguments: {
        design_source: designPath,
        screenshot: screenshot ?? designPath,
        ...(conditions ? { comparison_conditions: conditions } : {}),
      },
    });
    expect(response.isError).toBeFalsy();
    return CompareDesignResultSchema.parse(response.structuredContent);
  };
  const report = async (comparisonId: string, format: "json" | "markdown") => {
    const response = await client.callTool({
      name: "generate_diff_report",
      arguments: {
        comparison_id: comparisonId,
        format,
      },
    });
    expect(response.isError).toBeFalsy();
    const block = response.content;
    if (!Array.isArray(block)) throw new Error("Missing report content");
    const text = block.find((entry) => entry.type === "text")?.text;
    if (typeof text !== "string") throw new Error("Missing report text");
    return text;
  };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "figdiff-coordinate-regression-"));
    vi.stubEnv("FIGDIFF_HOME", join(directory, "store"));
    vi.stubEnv("FIGDIFF_ALLOWED_DIRS", directory);
    clearComparisonHistory();
    designPath = join(directory, "design.png");
    shiftedPath = join(directory, "shifted.png");
    const original = Buffer.alloc(width * height * 3);
    const shifted = Buffer.alloc(original.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const value = (Math.floor(x / 17) + Math.floor(y / 23)) % 2 ? 220 : 30;
        const offset = (y * width + x) * 3;
        original.fill(value, offset, offset + 3);
        if (x + 2 < width) shifted.fill(value, offset + 6, offset + 9);
      }
    }
    rawDifference = 0;
    for (let i = 0; i < original.length; i += 3) {
      if (original[i] !== shifted[i]) rawDifference++;
    }
    await Promise.all([
      sharp(original, { raw: { width, height, channels: 3 } })
        .png()
        .toBuffer()
        .then((png) => writeFile(designPath, png)),
      sharp(shifted, { raw: { width, height, channels: 3 } })
        .png()
        .toBuffer()
        .then((png) => writeFile(shiftedPath, png)),
    ]);
    await connect();
  });

  afterEach(async () => {
    await client?.close();
    await server?.close();
    clearComparisonHistory();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("同じ画素でもviewport矛盾は完了ゲートを止め、保存・再読込みで条件を保つ", async () => {
    const before = await readFile(designPath);
    const baseline = await compare();
    const result = await compare({ design: coordinate(693), screenshot: coordinate(1839) });
    expect(result.diffPixelCount).toBe(0);
    expect(result.diffPixelCount).toBe(baseline.diffPixelCount);
    expect(result.comparisonConditions?.design.canvas).toEqual({ width, height });
    expect(result.status).toBe("UNCERTAIN");
    expect(result.completionCriteria?.conditionsReview).toMatchObject({
      status: "UNCERTAIN",
      blocking: true,
    });
    expect(result.loopGuard).toMatchObject({ stop: true, reason: "uncertain" });
    expect(result.preflight?.warnings).toContainEqual(
      expect.objectContaining({ code: "comparison_conditions_mismatch", severity: "critical" }),
    );
    expect(result.diagnosis?.rankedCauses[0].code).toBe("comparison_conditions");
    expect(result.nextAction).toContain("CSSで修正する前");
    await client.close();
    await server.close();
    clearComparisonHistory();
    await connect();
    const saved = CompareDesignResultSchema.parse(
      JSON.parse(await report(result.comparisonId, "json")),
    );
    expect(saved.comparisonConditions).toEqual(result.comparisonConditions);
    const markdown = await report(result.comparisonId, "markdown");
    expect(markdown).toContain("390×693");
    expect(markdown).toContain(
      "| Coordinate Conditions | compatible declarations | 0 | UNCERTAIN |",
    );
    const histories = await listConvergenceHistories();
    expect(
      histories.flatMap((entry) => entry.campaigns.flatMap((campaign) => campaign.iterations)),
    ).toContainEqual(
      expect.objectContaining({
        comparisonId: result.comparisonId,
        comparisonConditions: result.comparisonConditions,
      }),
    );
    expect(await readFile(designPath)).toEqual(before);
  }, 60000);

  it("適合する申告を加えても既知の2px移動を画像の合格として隠さない", async () => {
    expect(rawDifference).toBeGreaterThan((width * height) / 10);
    const baseline = await compare(undefined, shiftedPath);
    const result = await compare(
      { design: coordinate(693), screenshot: coordinate(693) },
      shiftedPath,
    );
    expect(result.comparisonConditions?.status).toBe("compatible");
    expect(result.diffPixelCount).toBe(baseline.diffPixelCount);
    const detail = CompareDesignResultSchema.parse(
      JSON.parse(await report(result.comparisonId, "json")),
    );
    expect(detail.diffReport?.alignment.translation).toEqual({ x: 2, y: 0 });
    expect(detail.diffReport?.issues).toContainEqual(
      expect.objectContaining({
        severity: "critical",
        evidence: expect.objectContaining({ signal: "translation_offset" }),
      }),
    );
    expect(result.status).toBe("FAIL");
  }, 60000);

  it("空の申告は既存履歴を維持し、有効な座標条件の変更は別履歴になる", async () => {
    const omitted = await compare(undefined, shiftedPath);
    const empty = await compare({}, shiftedPath);
    const emptySide = await compare({ design: {} }, shiftedPath);
    const sourceKey = (id: string) => getComparisonEntry(id).then((entry) => entry?.sourceKey);
    const legacyKey = await sourceKey(omitted.comparisonId);
    expect(legacyKey).toBeDefined();
    expect(await sourceKey(empty.comparisonId)).toBe(legacyKey);
    expect(await sourceKey(emptySide.comparisonId)).toBe(legacyKey);
    const declared = await compare(
      { design: coordinate(693), screenshot: coordinate(693) },
      shiftedPath,
    );
    const changed = await compare(
      { design: coordinate(693, 5), screenshot: coordinate(693, 5) },
      shiftedPath,
    );
    expect(await sourceKey(declared.comparisonId)).not.toBe(legacyKey);
    expect(await sourceKey(changed.comparisonId)).not.toBe(await sourceKey(declared.comparisonId));
    expect(changed.loopGuard?.step).toBe(1);
  }, 60000);
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { createMcpServer } from "../server.js";
import { clearComparisonHistory } from "../service/comparison-history.js";

const comparisonSchema = z.object({ comparisonId: z.string() });
const verificationSchema = z.object({
  verdict: z.enum(["improved", "unchanged", "regressed"]),
  structureDelta: z.number(),
});

describe("verify_fix — full-page height changes", () => {
  let client: Client;
  let directory: string;
  let originalAllowedDirs: string | undefined;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "figdiff-verify-height-"));
    originalAllowedDirs = process.env.FIGDIFF_ALLOWED_DIRS;
    process.env.FIGDIFF_ALLOWED_DIRS = directory;
    clearComparisonHistory();
    const server = createMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "verify-height-test-client", version: "1.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });

  afterEach(async () => {
    try {
      await client.close();
    } finally {
      clearComparisonHistory();
      if (originalAllowedDirs === undefined) delete process.env.FIGDIFF_ALLOWED_DIRS;
      else process.env.FIGDIFF_ALLOWED_DIRS = originalAllowedDirs;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    { before: 200, after: 160, verdict: "regressed" },
    { before: 160, after: 200, verdict: "improved" },
    { before: 200, after: 199, verdict: "regressed" },
    { before: 199, after: 200, verdict: "improved" },
    { before: 100, after: 160, verdict: "context-change" },
    { before: 160, after: 100, verdict: "context-change" },
  ])("下端の欠落 $before → $after 行を $verdict と判定する", async ({ before, after, verdict }) => {
    const design = path.join(directory, "design.png");
    const baseline = path.join(directory, "before.png");
    const current = path.join(directory, "after.png");
    await sharp({ create: { width: 80, height: 200, channels: 3, background: "white" } })
      .composite([
        {
          input: { create: { width: 20, height: 20, channels: 3, background: "black" } },
          left: 10,
          top: 10,
        },
      ])
      .png()
      .toFile(design);
    for (const [file, height] of [
      [baseline, before],
      [current, after],
    ] as const) {
      await sharp(design).extract({ left: 0, top: 0, width: 80, height }).png().toFile(file);
    }
    const prior = await client.callTool({
      name: "compare_design",
      arguments: { design_source: design, screenshot: baseline },
    });
    expect(prior.isError).toBeFalsy();
    const { comparisonId } = comparisonSchema.parse(prior.structuredContent);
    const result = await client.callTool({
      name: "verify_fix",
      arguments: {
        design_source: design,
        screenshot: current,
        prior_comparison_id: comparisonId,
        expected_target_node_id: "whole-frame",
      },
    });
    if (verdict === "context-change") {
      // 高さ比が大きく contain 縮小になった入力は、1:1 と同じ物差しではない。
      expect(result.isError).toBeTruthy();
      expect(JSON.stringify(result.content)).toContain("comparison.geometry.alignment");
      return;
    }
    expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
    const verified = verificationSchema.parse(result.structuredContent);
    expect(verified.verdict).toBe(verdict);
    // 既存画素は同一。差分の根拠は白地の欠落行数だけであり、SSIMの自己申告ではない。
    expect(verified.structureDelta).toBeCloseTo((after - before) / 200, 8);
  });

  it("高さだけ修復して残差があるループは次の再比較でも反復履歴を保つ", async () => {
    const design = path.join(directory, "design.png");
    const short = path.join(directory, "short.png");
    const full = path.join(directory, "full.png");
    await sharp({ create: { width: 80, height: 200, channels: 3, background: "white" } })
      .png()
      .toFile(design);
    await sharp(design)
      .composite([
        {
          input: { create: { width: 10, height: 10, channels: 3, background: "black" } },
          left: 10,
          top: 10,
        },
      ])
      .png()
      .toFile(full);
    await sharp(full).extract({ left: 0, top: 0, width: 80, height: 160 }).png().toFile(short);
    const iterations = [];
    for (const screenshot of [short, full, full]) {
      const result = await client.callTool({
        name: "compare_design",
        arguments: {
          design_source: design,
          screenshot,
          campaign_id: "height-repair-with-residual",
        },
      });
      expect(result.isError).toBeFalsy();
      const data = z
        .object({ status: z.literal("FAIL"), loopGuard: z.object({ step: z.number() }) })
        .parse(result.structuredContent);
      iterations.push(data.loopGuard.step);
    }
    expect(iterations).toEqual([1, 2, 3]);
  });
});

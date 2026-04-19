import * as path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { createMcpServer } from "../server.js";
import { clearComparisonHistory } from "../service/comparison-history.js";

const PAIR02_DIR = path.resolve(
  import.meta.dirname,
  "../../../../verification/fixtures/pair-02-multi-section-lp",
);

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

describe("verify_fix", () => {
  let client: Client;

  beforeEach(async () => {
    clearComparisonHistory();
    const server = createMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    client = new Client({ name: "verify-fix-test-client", version: "1.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });

  afterEach(async () => {
    await client.close();
    clearComparisonHistory();
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

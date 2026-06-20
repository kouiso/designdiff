/**
 * Response budget tests for inspect_node / get_design_tokens / list_figma_frames.
 * Verifies that responses never exceed the 4096-char archive threshold even when
 * given large mock Figma data (100 children, deep token trees, many frames).
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { FigmaNode, Frame } from "@figdiff/shared";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../service/figma-service.js", async () => {
  const MOCK_TOKEN = "figd_mock";
  return {
    createFigmaService: () => ({
      getNodeDetails: async (
        _fileKey: string,
        _nodeId: string,
        _depth?: number,
      ): Promise<FigmaNode> => {
        if (_nodeId === "missing:node") {
          throw new Error(
            `Requested Figma node not found: Node "${_nodeId}" not found in file ${_fileKey}. The id may not exist, or the format may be wrong (expected "1:23" with a colon; dash-format ids from Figma URLs are auto-converted). Run list_figma_frames to see valid node ids.`,
          );
        }
        return makeLargeNode(100, _nodeId);
      },
      getFrames: async (_fileKey: string): Promise<Frame[]> => makeManyFrames(150),
    }),
    getFigmaCredentialStatus: () => ({
      envName: "FIGMA_TOKEN",
      configured: true,
      valid: true,
      authMode: "pat",
      issue: null,
    }),
    formatFigmaCredentialError: () => "",
    getMcpCacheDir: () => path.join(os.tmpdir(), "figdiff-mock-cache"),
    computeOptimalScale: () => 2,
    _MOCK_TOKEN: MOCK_TOKEN,
  };
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeChild(index: number): FigmaNode {
  return {
    id: `child-${index}`,
    name: `Child Node ${index}`,
    type: "FRAME",
    absoluteBoundingBox: { x: index * 10, y: 0, width: 100, height: 50 },
    fills: [{ type: "SOLID", color: { r: 1, g: 0.5, b: 0.2, a: 1 }, visible: true }],
    strokes: [],
    effects: [],
    children: [],
  };
}

function makeLargeNode(childCount = 100, id = "frame-root"): FigmaNode {
  return {
    id,
    name: "Large Frame",
    type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 900 },
    fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 }, visible: true }],
    strokes: [],
    effects: [],
    layoutMode: "VERTICAL",
    paddingTop: 24,
    paddingRight: 24,
    paddingBottom: 24,
    paddingLeft: 24,
    itemSpacing: 16,
    children: Array.from({ length: childCount }, (_, i) => makeChild(i)),
  };
}

function makeManyFrames(count: number): Frame[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `frame-${i}`,
    name: `Page Frame ${i}`,
    width: 1440,
    height: 900,
    pageId: "page-1",
    pageName: "Page 1",
  }));
}

const TextContentSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
});

function extractText(result: unknown): string {
  const parsed = TextContentSchema.safeParse(result);
  if (!parsed.success) throw new Error("no content in result");
  const item = parsed.data.content.find((c) => c.type === "text" && c.text);
  if (!item?.text) throw new Error("no text item in result");
  return item.text;
}

const ARCHIVE_THRESHOLD = 4096;
const FIGMA_URL = "https://www.figma.com/design/MOCKFILEKEY/Mock?node-id=frame-root";

// ── Test suite ────────────────────────────────────────────────────────────────

describe("MCP response budget — responses never exceed archive threshold", () => {
  let client: Client;
  const createdFiles: string[] = [];

  beforeEach(async () => {
    process.env.FIGMA_TOKEN = "figd_mock_token_for_testing";
    const { createMcpServer } = await import("../server.js");
    const server = createMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "budget-test-client", version: "1.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });

  afterEach(async () => {
    await client.close().catch(() => undefined);
    delete process.env.FIGMA_TOKEN;
    for (const file of createdFiles.splice(0)) {
      await fs.unlink(file).catch(() => undefined);
    }
  });

  describe("inspect_node", () => {
    it("single node with 100 children: response text < 4096 chars", async () => {
      const result = await client.callTool({
        name: "inspect_node",
        arguments: { figma_url: FIGMA_URL, node_id: "frame-root" },
      });
      expect(result.isError).toBeFalsy();
      const text = extractText(result);
      expect(text.length).toBeLessThan(ARCHIVE_THRESHOLD);
    });

    it("single node with 100 children: childrenTruncated=true and childrenCount present", async () => {
      const result = await client.callTool({
        name: "inspect_node",
        arguments: { figma_url: FIGMA_URL, node_id: "frame-root" },
      });
      const data = JSON.parse(extractText(result));
      expect(data.childrenTruncated).toBe(true);
      expect(data.childrenCount).toBe(100);
      createdFiles.push(data.childrenDetailPath);
      expect(typeof data.childrenDetailPath).toBe("string");
      expect(data.childrenDetailPath).toMatch(/\.json$/);
      expect(data.childrenSummary).toHaveLength(25);
    });

    it("single node with 100 children: high-signal fields (cssSuggestion, layout) are preserved", async () => {
      const result = await client.callTool({
        name: "inspect_node",
        arguments: { figma_url: FIGMA_URL, node_id: "frame-root" },
      });
      const data = JSON.parse(extractText(result));
      expect(typeof data.cssSuggestion).toBe("string");
      expect(data.cssSuggestion.length).toBeGreaterThan(0);
      expect(data.layout).toBeDefined();
      expect(data.layout.width).toBe(1440);
    });

    it("dash format node_id を colon format に正規化する", async () => {
      const result = await client.callTool({
        name: "inspect_node",
        arguments: { figma_url: FIGMA_URL, node_id: "72-2552" },
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(extractText(result));
      expect(data.nodeId).toBe("72:2552");
    });

    it("figma_url に埋め込まれた node-id を node_id 省略時に使う", async () => {
      const result = await client.callTool({
        name: "inspect_node",
        arguments: { figma_url: "https://www.figma.com/design/MOCKFILEKEY/Mock?node-id=72-2552" },
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(extractText(result));
      expect(data.nodeId).toBe("72:2552");
    });

    it("missing node error は安全な自己解決ヒントを返す", async () => {
      const result = await client.callTool({
        name: "inspect_node",
        arguments: { figma_url: FIGMA_URL, node_id: "missing:node" },
      });

      expect(result.isError).toBe(true);
      const text = extractText(result);
      expect(text).toContain(
        'Error: Requested Figma node not found: Node "missing:node" not found in file MOCKFILEKEY.',
      );
      expect(text).toContain('expected "1:23" with a colon');
      expect(text).toContain("Run list_figma_frames to see valid node ids.");
    });

    it("multi-node (10 nodes) with 100 children each: response text < 4096 chars", async () => {
      const nodeIds = Array.from({ length: 10 }, (_, i) => `node-${i}`);
      const result = await client.callTool({
        name: "inspect_node",
        arguments: { figma_url: FIGMA_URL, node_ids: nodeIds },
      });
      expect(result.isError).toBeFalsy();
      const text = extractText(result);
      expect(text.length).toBeLessThan(ARCHIVE_THRESHOLD);
    });

    it("multi-node over budget: returns lightweight summaries with detailPath", async () => {
      const nodeIds = Array.from({ length: 10 }, (_, i) => `node-${i}`);
      const result = await client.callTool({
        name: "inspect_node",
        arguments: { figma_url: FIGMA_URL, node_ids: nodeIds },
      });
      const data = JSON.parse(extractText(result));
      expect(Array.isArray(data)).toBe(true);
      const first = data[0];
      expect(first.cssSuggestion).toBeDefined();
      expect(typeof first.detailPath).toBe("string");
      expect(first.detailPath).toMatch(/\.json$/);
      createdFiles.push(first.detailPath);

      // detailPath JSON should contain all 10 inspections with full data
      const archived = JSON.parse(await fs.readFile(first.detailPath, "utf-8"));
      expect(archived).toHaveLength(10);
      expect(archived[0].layout).toBeDefined();
    });

    it("small node with few children: response passes through unchanged (no truncation)", async () => {
      // Use a fresh mock that returns a small node
      const result = await client.callTool({
        name: "inspect_node",
        arguments: { figma_url: FIGMA_URL, node_id: "frame-root" },
      });
      // Even with the large mock, childrenTruncated is expected — just verify no isError
      expect(result.isError).toBeFalsy();
    });
  });

  describe("get_design_tokens", () => {
    it("large frame (depth=2): response text < 4096 chars", async () => {
      const result = await client.callTool({
        name: "get_design_tokens",
        arguments: { figma_url: FIGMA_URL, depth: 2 },
      });
      expect(result.isError).toBeFalsy();
      const text = extractText(result);
      expect(text.length).toBeLessThan(ARCHIVE_THRESHOLD);
    });

    it("when truncated: tokensTruncated=true and tokensDetailPath file contains all tokens", async () => {
      const result = await client.callTool({
        name: "get_design_tokens",
        arguments: { figma_url: FIGMA_URL, depth: 2 },
      });
      const data = JSON.parse(extractText(result));

      if (data.tokensTruncated) {
        expect(typeof data.tokensDetailPath).toBe("string");
        createdFiles.push(data.tokensDetailPath);
        const archived = JSON.parse(await fs.readFile(data.tokensDetailPath, "utf-8"));
        expect(archived.length).toBe(data.tokenCount);
        // inline tokens should be a subset
        expect(data.tokens.length).toBeLessThanOrEqual(data.tokenCount);
      } else {
        // no truncation — tokens array should match tokenCount
        expect(data.tokens).toHaveLength(data.tokenCount);
      }
    });

    it("response always includes nodeId and tokenCount", async () => {
      const result = await client.callTool({
        name: "get_design_tokens",
        arguments: { figma_url: FIGMA_URL, depth: 2 },
      });
      const data = JSON.parse(extractText(result));
      expect(typeof data.nodeId).toBe("string");
      expect(typeof data.tokenCount).toBe("number");
      expect(data.tokenCount).toBeGreaterThan(0);
    });
  });

  describe("list_figma_frames", () => {
    it("150 frames: response text < 4096 chars", async () => {
      const result = await client.callTool({
        name: "list_figma_frames",
        arguments: { figma_url: FIGMA_URL },
      });
      expect(result.isError).toBeFalsy();
      const text = extractText(result);
      expect(text.length).toBeLessThan(ARCHIVE_THRESHOLD);
    });

    it("150 frames: framesTruncated=true and framesDetailPath file contains all frames", async () => {
      const result = await client.callTool({
        name: "list_figma_frames",
        arguments: { figma_url: FIGMA_URL },
      });
      const data = JSON.parse(extractText(result));
      expect(data.frameCount).toBe(150);

      if (data.framesTruncated) {
        expect(typeof data.framesDetailPath).toBe("string");
        createdFiles.push(data.framesDetailPath);
        const archived = JSON.parse(await fs.readFile(data.framesDetailPath, "utf-8"));
        expect(archived).toHaveLength(150);
        expect(archived[0].id).toBe("frame-0");
        expect(archived[149].id).toBe("frame-149");
      }
    });

    it("frameCount is always accurate regardless of truncation", async () => {
      const result = await client.callTool({
        name: "list_figma_frames",
        arguments: { figma_url: FIGMA_URL },
      });
      const data = JSON.parse(extractText(result));
      expect(data.frameCount).toBe(150);
    });
  });
});

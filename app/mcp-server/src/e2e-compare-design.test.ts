/**
 * MCP Server E2E Integration Test
 * Tests the full compare_design pipeline with real images (no mocks)
 * Proves: MCP Server → compare_design → pixelmatch → diff result
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMcpServer } from "./server.js";

const FIXTURE_DIR = path.join(import.meta.dirname, "__fixtures__");
const EVIDENCE_DIR = path.resolve(import.meta.dirname, "../../../docs/evidence");

function formatEvidenceJson(evidence: unknown): string {
  return `${JSON.stringify(evidence, null, 2)}\n`;
}

interface TextContent {
  type: "text";
  text: string;
}

interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

type ContentItem = TextContent | ImageContent | { type: string; [key: string]: unknown };

function getContentItems(result: Record<string, unknown>): ContentItem[] {
  const content = result.content;
  if (!Array.isArray(content)) return [];
  return content as ContentItem[];
}

function findTextContent(result: Record<string, unknown>): TextContent | undefined {
  return getContentItems(result).find((c): c is TextContent => c.type === "text");
}

function findImageContent(result: Record<string, unknown>): ImageContent | undefined {
  return getContentItems(result).find((c): c is ImageContent => c.type === "image");
}

async function createTestImage(
  width: number,
  height: number,
  color: { r: number; g: number; b: number },
): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: color,
    },
  })
    .png()
    .toBuffer();
}

describe("MCP Server E2E: compare_design", () => {
  let client: Client;
  let designPath: string;
  let screenshotSamePath: string;
  let screenshotDiffPath: string;
  let originalHome: string | undefined;

  beforeAll(async () => {
    await fs.mkdir(FIXTURE_DIR, { recursive: true });
    await fs.mkdir(EVIDENCE_DIR, { recursive: true });
    originalHome = process.env.HOME;
    process.env.HOME = path.join(FIXTURE_DIR, "home");

    const designImage = await createTestImage(200, 200, { r: 66, g: 133, b: 244 });
    const screenshotSame = await createTestImage(200, 200, { r: 66, g: 133, b: 244 });
    const screenshotDiff = await createTestImage(200, 200, { r: 0, g: 0, b: 0 });

    designPath = path.join(FIXTURE_DIR, "design.png");
    screenshotSamePath = path.join(FIXTURE_DIR, "screenshot-same.png");
    screenshotDiffPath = path.join(FIXTURE_DIR, "screenshot-diff.png");

    await Promise.all([
      fs.writeFile(designPath, designImage),
      fs.writeFile(screenshotSamePath, screenshotSame),
      fs.writeFile(screenshotDiffPath, screenshotDiff),
    ]);

    const server = createMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });

  afterAll(async () => {
    await client.close();
    process.env.HOME = originalHome;
    await fs.rm(FIXTURE_DIR, { recursive: true, force: true });
  });

  it("ツール一覧に compare_design が含まれること", async () => {
    const result = await client.listTools();
    const toolNames = result.tools.map((t) => t.name);
    const compareDesignTool = result.tools.find((tool) => tool.name === "compare_design");
    expect(toolNames).toContain("compare_design");
    expect(toolNames).toContain("list_figma_frames");
    expect(toolNames).toContain("inspect_node");
    expect(toolNames).toContain("generate_diff_report");
    expect(toolNames).toContain("get_crop_region");
    expect(toolNames).toContain("set_crop_region");
    expect(toolNames).toContain("get_design_tokens");
    expect(toolNames).toContain("verify_fix");
    expect(compareDesignTool?.outputSchema).toBeDefined();
    expect(JSON.stringify(compareDesignTool?.outputSchema)).toContain("diffReport");

    const evidence = {
      test: "MCP tool listing",
      timestamp: new Date().toISOString(),
      toolCount: result.tools.length,
      tools: toolNames,
    };
    await fs.writeFile(
      path.join(EVIDENCE_DIR, "mcp-list-tools.json"),
      formatEvidenceJson(evidence),
    );
  });

  it("同一画像比較で matchRate 100% が返ること", async () => {
    const result = await client.callTool({
      name: "compare_design",
      arguments: {
        design_source: designPath,
        screenshot: screenshotSamePath,
        threshold: 0.1,
      },
    });

    expect(result.isError).toBeFalsy();

    const textContent = findTextContent(result);
    expect(textContent).toBeDefined();

    const data = JSON.parse(textContent!.text);
    expect(data.status).toBe("PASS");
    expect(data.matchRate).toBe(100);
    expect(data.diffPixelCount).toBe(0);
    expect(data.completionCriteria.matchRate.status).toBe("PASS");
    expect(data.diffReport).toBeDefined();
    expect(data.diffReport.aggregateVerdict).toBe("pass");

    const evidence = {
      test: "MCP compare_design — identical images",
      timestamp: new Date().toISOString(),
      input: { design: "200x200 blue", screenshot: "200x200 blue" },
      result: data,
    };
    await fs.writeFile(
      path.join(EVIDENCE_DIR, "mcp-compare-design-identical.json"),
      formatEvidenceJson(evidence),
    );
  });

  it("異なる画像比較で差分が検出されること", async () => {
    const result = await client.callTool({
      name: "compare_design",
      arguments: {
        design_source: designPath,
        screenshot: screenshotDiffPath,
        threshold: 0.1,
      },
    });

    expect(result.isError).toBeFalsy();

    const textContent = findTextContent(result);
    expect(textContent).toBeDefined();

    const data = JSON.parse(textContent!.text);
    expect(data.status).toBe("FAIL");
    expect(data.matchRate).toBeLessThan(100);
    expect(data.diffPixelCount).toBeGreaterThan(0);
    expect(data.diffRegions.length).toBeGreaterThan(0);
    expect(data.completionCriteria.matchRate.status).toBe("FAIL");
    expect(data.diffReport).toBeDefined();
    expect(data.diffReport.aggregateVerdict).toBe("fail");
    expect(data.diffImagePath).toBeTruthy();

    const imageContent = findImageContent(result);
    expect(imageContent).toBeDefined();
    expect(imageContent!.mimeType).toBe("image/png");

    const evidence = {
      test: "MCP compare_design — different images (diff detected)",
      timestamp: new Date().toISOString(),
      input: { design: "200x200 blue", screenshot: "200x200 red" },
      result: data,
      hasDiffImage: Boolean(imageContent),
    };
    await fs.writeFile(
      path.join(EVIDENCE_DIR, "mcp-compare-design-diff.json"),
      formatEvidenceJson(evidence),
    );
  });

  it("差分率が単調減少するループを証明できること", async () => {
    const partialDiffImage = await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 66, g: 133, b: 244 } },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 50, height: 50, channels: 3, background: { r: 0, g: 0, b: 0 } },
          })
            .png()
            .toBuffer(),
          top: 0,
          left: 0,
        },
      ])
      .png()
      .toBuffer();

    const partialDiffPath = path.join(FIXTURE_DIR, "screenshot-partial-diff.png");
    await fs.writeFile(partialDiffPath, partialDiffImage);

    const resultFull = await client.callTool({
      name: "compare_design",
      arguments: { design_source: designPath, screenshot: screenshotDiffPath, threshold: 0.1 },
    });
    const dataFull = JSON.parse(findTextContent(resultFull)!.text);

    const resultPartial = await client.callTool({
      name: "compare_design",
      arguments: { design_source: designPath, screenshot: partialDiffPath, threshold: 0.1 },
    });
    const dataPartial = JSON.parse(findTextContent(resultPartial)!.text);

    const resultPerfect = await client.callTool({
      name: "compare_design",
      arguments: { design_source: designPath, screenshot: screenshotSamePath, threshold: 0.1 },
    });
    const dataPerfect = JSON.parse(findTextContent(resultPerfect)!.text);

    expect(dataFull.matchRate).toBeLessThan(dataPartial.matchRate);
    expect(dataPartial.matchRate).toBeLessThan(dataPerfect.matchRate);
    expect(dataPerfect.matchRate).toBe(100);

    const evidence = {
      test: "MCP compare_design — monotonic matchRate decrease proof",
      timestamp: new Date().toISOString(),
      loop: [
        {
          step: 1,
          description: "Full diff (red vs blue)",
          matchRate: dataFull.matchRate,
          diffPixelCount: dataFull.diffPixelCount,
        },
        {
          step: 2,
          description: "Partial fix (small red corner)",
          matchRate: dataPartial.matchRate,
          diffPixelCount: dataPartial.diffPixelCount,
        },
        {
          step: 3,
          description: "Perfect match",
          matchRate: dataPerfect.matchRate,
          diffPixelCount: dataPerfect.diffPixelCount,
        },
      ],
      monotonicallyDecreasing: true,
    };
    await fs.writeFile(
      path.join(EVIDENCE_DIR, "mcp-diff-loop-evidence.json"),
      formatEvidenceJson(evidence),
    );
  });

  it("crop_region の保存と取得ができること", async () => {
    const setResult = await client.callTool({
      name: "set_crop_region",
      arguments: {
        project_id: "test-project",
        frame_name: "test-frame",
        region: { x: 10, y: 20, width: 100, height: 80 },
      },
    });
    expect(setResult.isError).toBeFalsy();

    const getResult = await client.callTool({
      name: "get_crop_region",
      arguments: {
        project_id: "test-project",
      },
    });
    expect(getResult.isError).toBeFalsy();

    const cropTextContent = findTextContent(getResult);
    const data = JSON.parse(cropTextContent!.text);
    expect(data.regions.length).toBeGreaterThan(0);
  });
});

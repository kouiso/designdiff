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
import { z } from "zod";

import { createMcpServer } from "./server.js";

const FIXTURE_DIR = path.join(import.meta.dirname, "__fixtures__");
const EVIDENCE_DIR = path.resolve(import.meta.dirname, "../../../docs/evidence");
const EVIDENCE_TIMESTAMP = "2026-04-30T00:00:00.000Z";
const EVIDENCE_COMPARISON_ID = "cmp-evidence";
const EVIDENCE_DIFF_IMAGE_PATH = "/tmp/figdiff-mcp/cmp-evidence.png";
const evidenceResultSchema = z.record(z.string(), z.unknown());

function formatEvidenceJson(evidence: unknown): string {
  return `${JSON.stringify(evidence, null, 2)}\n`;
}

function normalizeResultForEvidence(data: unknown): unknown {
  const parsed = evidenceResultSchema.safeParse(data);
  if (!parsed.success) {
    return data;
  }

  const result = parsed.data;
  const clusterTelemetry =
    typeof result.clusterTelemetry === "object" && result.clusterTelemetry !== null
      ? {
          ...result.clusterTelemetry,
          wallMs: 0,
        }
      : result.clusterTelemetry;

  return {
    ...result,
    comparisonId:
      typeof result.comparisonId === "string" ? EVIDENCE_COMPARISON_ID : result.comparisonId,
    diffImagePath:
      typeof result.diffImagePath === "string" ? EVIDENCE_DIFF_IMAGE_PATH : result.diffImagePath,
    clusterTelemetry,
  };
}

interface TextContent {
  type: "text";
  text: string;
}

type ContentItem = TextContent | { type: string; [key: string]: unknown };

function getContentItems(result: Record<string, unknown>): ContentItem[] {
  const content = result.content;
  if (!Array.isArray(content)) return [];
  return content as ContentItem[];
}

function findTextContent(result: Record<string, unknown>): TextContent | undefined {
  return getContentItems(result).find((c): c is TextContent => c.type === "text");
}

async function fetchDiffReportJson(
  client: Client,
  comparisonId: string,
): Promise<Record<string, unknown>> {
  const result = await client.callTool({
    name: "generate_diff_report",
    arguments: {
      comparison_id: comparisonId,
      format: "json",
    },
  });

  expect(result.isError).toBeFalsy();
  const textContent = findTextContent(result);
  expect(textContent).toBeDefined();
  return JSON.parse(textContent!.text) as Record<string, unknown>;
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

    const designImage = await createTestImage(200, 200, {
      r: 66,
      g: 133,
      b: 244,
    });
    const screenshotSame = await createTestImage(200, 200, {
      r: 66,
      g: 133,
      b: 244,
    });
    const screenshotDiff = await createTestImage(200, 200, {
      r: 0,
      g: 0,
      b: 0,
    });

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
    expect(toolNames).toContain("get_ignore_regions");
    expect(toolNames).toContain("set_ignore_regions");
    expect(toolNames).toContain("delete_ignore_region");
    expect(toolNames).toContain("get_design_tokens");
    expect(toolNames).toContain("verify_fix");
    expect(compareDesignTool?.outputSchema).toBeDefined();
    expect(JSON.stringify(compareDesignTool?.outputSchema)).toContain("diffReport");

    const evidence = {
      test: "MCP tool listing",
      timestamp: EVIDENCE_TIMESTAMP,
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
    expect(data.diffImagePath).toBeUndefined();
    expect(data.completionCriteria.matchRate.status).toBe("PASS");
    expect(data.diffReport).toBeUndefined();
    expect(data.gridSummary).toBeUndefined();
    expect(getContentItems(result)[1]?.type).toBe("text");
    expect((getContentItems(result)[1] as TextContent).text).toContain("generate_diff_report");

    const report = await fetchDiffReportJson(client, data.comparisonId);
    const diffReport = report.diffReport as {
      aggregateVerdict: string;
      regionScores: { regionId: string; structure: number }[];
      issues: unknown[];
    };
    expect(diffReport.aggregateVerdict).toBe("pass");
    expect(diffReport.regionScores).toHaveLength(1);
    expect(diffReport.regionScores[0].regionId).toBe("whole-frame");
    expect(diffReport.regionScores[0].structure).toBe(1);
    expect(diffReport.issues).toEqual([]);

    const evidence = {
      test: "MCP compare_design — identical images",
      timestamp: EVIDENCE_TIMESTAMP,
      input: { design: "200x200 blue", screenshot: "200x200 blue" },
      result: normalizeResultForEvidence(data),
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
    expect(data.completionCriteria.structuralReview.status).toBe("FAIL");
    expect(data.completionCriteria.matchRate.status).toBe("PASS");
    expect(data.completionCriteria.matchRate.blocking).toBe(false);
    expect(data.diffReport).toBeUndefined();
    expect(data.gridSummary).toBeUndefined();

    const report = await fetchDiffReportJson(client, data.comparisonId);
    const diffReport = report.diffReport as {
      aggregateVerdict: string;
      regionScores: unknown[];
      issues: { severity: string }[];
    };
    expect(diffReport.aggregateVerdict).toBe("fail");
    expect(diffReport.regionScores.length).toBeGreaterThan(0);
    expect(diffReport.issues.length).toBeGreaterThan(0);
    expect(diffReport.issues.map((issue) => issue.severity)).toContain("critical");
    expect(data.diffImagePath).toBeTruthy();
    const diffImageStat = await fs.stat(data.diffImagePath);
    expect(diffImageStat.isFile()).toBe(true);
    expect(getContentItems(result).some((content) => content.type === "image")).toBe(false);

    const evidence = {
      test: "MCP compare_design — different images (diff detected)",
      timestamp: EVIDENCE_TIMESTAMP,
      input: { design: "200x200 blue", screenshot: "200x200 red" },
      result: normalizeResultForEvidence(data),
      hasDiffImage: Boolean(data.diffImagePath),
    };
    await fs.writeFile(
      path.join(EVIDENCE_DIR, "mcp-compare-design-diff.json"),
      formatEvidenceJson(evidence),
    );
  });

  it("差分率が単調減少するループを証明できること", async () => {
    const partialDiffImage = await sharp({
      create: {
        width: 200,
        height: 200,
        channels: 3,
        background: { r: 66, g: 133, b: 244 },
      },
    })
      .composite([
        {
          input: await sharp({
            create: {
              width: 50,
              height: 50,
              channels: 3,
              background: { r: 0, g: 0, b: 0 },
            },
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
      arguments: {
        design_source: designPath,
        screenshot: screenshotDiffPath,
        threshold: 0.1,
      },
    });
    const dataFull = JSON.parse(findTextContent(resultFull)!.text);

    const resultPartial = await client.callTool({
      name: "compare_design",
      arguments: {
        design_source: designPath,
        screenshot: partialDiffPath,
        threshold: 0.1,
      },
    });
    const dataPartial = JSON.parse(findTextContent(resultPartial)!.text);

    const resultPerfect = await client.callTool({
      name: "compare_design",
      arguments: {
        design_source: designPath,
        screenshot: screenshotSamePath,
        threshold: 0.1,
      },
    });
    const dataPerfect = JSON.parse(findTextContent(resultPerfect)!.text);

    expect(dataFull.matchRate).toBeLessThan(dataPartial.matchRate);
    expect(dataPartial.matchRate).toBeLessThan(dataPerfect.matchRate);
    expect(dataPerfect.matchRate).toBe(100);

    const evidence = {
      test: "MCP compare_design — monotonic matchRate decrease proof",
      timestamp: EVIDENCE_TIMESTAMP,
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
    await client.callTool({
      name: "delete_project",
      arguments: { project_id: "test-project" },
    });

    const createResult = await client.callTool({
      name: "create_project",
      arguments: {
        id: "test-project",
        name: "test-project",
        implementation_url: "https://example.com",
      },
    });
    expect(createResult.isError).toBeFalsy();

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

  it("ignore_regions YAML の保存と compare_design 自動適用ができること", async () => {
    await client.callTool({
      name: "delete_project",
      arguments: { project_id: "ignore-project" },
    });

    const createResult = await client.callTool({
      name: "create_project",
      arguments: {
        id: "ignore-project",
        name: "ignore-project",
        implementation_url: "https://example.com",
      },
    });
    expect(createResult.isError).toBeFalsy();

    const setResult = await client.callTool({
      name: "set_ignore_regions",
      arguments: {
        project_id: "ignore-project",
        regions: [
          {
            id: "full-frame",
            frame_name: "test-frame",
            x: 0,
            y: 0,
            width: 200,
            height: 200,
            label: "Intentional full-frame diff",
          },
        ],
      },
    });
    expect(setResult.isError).toBeFalsy();

    const getResult = await client.callTool({
      name: "get_ignore_regions",
      arguments: {
        project_id: "ignore-project",
        frame_name: "test-frame",
      },
    });
    expect(getResult.isError).toBeFalsy();
    const persistedRegions = JSON.parse(findTextContent(getResult)!.text);
    expect(persistedRegions.regionCount).toBe(1);

    const deleteResult = await client.callTool({
      name: "delete_ignore_region",
      arguments: {
        project_id: "ignore-project",
        frame_name: "test-frame",
        region_id: "full-frame",
      },
    });
    expect(deleteResult.isError).toBeFalsy();
    const deletePayload = JSON.parse(findTextContent(deleteResult)!.text);
    expect(deletePayload).toMatchObject({
      success: true,
      deletedRegionId: "full-frame",
      frameName: "test-frame",
      regionCount: 0,
    });

    const getAfterDeleteResult = await client.callTool({
      name: "get_ignore_regions",
      arguments: {
        project_id: "ignore-project",
        frame_name: "test-frame",
      },
    });
    expect(getAfterDeleteResult.isError).toBeFalsy();
    const afterDeleteRegions = JSON.parse(findTextContent(getAfterDeleteResult)!.text);
    expect(afterDeleteRegions.regionCount).toBe(0);

    await client.callTool({
      name: "set_ignore_regions",
      arguments: {
        project_id: "ignore-project",
        regions: [
          {
            id: "full-frame",
            frame_name: "test-frame",
            x: 0,
            y: 0,
            width: 200,
            height: 200,
            label: "Intentional full-frame diff",
          },
        ],
      },
    });

    const compareResult = await client.callTool({
      name: "compare_design",
      arguments: {
        design_source: designPath,
        screenshot: screenshotDiffPath,
        threshold: 0.1,
        project_id: "ignore-project",
        frame_name: "test-frame",
      },
    });
    expect(compareResult.isError).toBeFalsy();

    const data = JSON.parse(findTextContent(compareResult)!.text);
    expect(data.matchRate).toBe(100);
    expect(data.diffPixelCount).toBe(0);
    expect(data.totalPixelCount).toBe(0);

    const evidence = {
      test: "MCP compare_design — persisted ignore_regions YAML auto-applied",
      timestamp: EVIDENCE_TIMESTAMP,
      input: {
        design: "200x200 blue",
        screenshot: "200x200 black",
        projectId: "ignore-project",
        frameName: "test-frame",
      },
      persistedRegions,
      result: normalizeResultForEvidence(data),
    };
    await fs.writeFile(
      path.join(EVIDENCE_DIR, "mcp-ignore-regions-yaml.json"),
      formatEvidenceJson(evidence),
    );
  });

  it("ignore_regions の persisted + inline が結合されること", async () => {
    await client.callTool({
      name: "delete_project",
      arguments: { project_id: "ignore-project-merge" },
    });

    const createResult = await client.callTool({
      name: "create_project",
      arguments: {
        id: "ignore-project-merge",
        name: "ignore-project-merge",
        implementation_url: "https://example.com",
      },
    });
    expect(createResult.isError).toBeFalsy();

    const setResult = await client.callTool({
      name: "set_ignore_regions",
      arguments: {
        project_id: "ignore-project-merge",
        regions: [
          {
            id: "left-half",
            frame_name: "test-frame",
            x: 0,
            y: 0,
            width: 100,
            height: 200,
            label: "persisted-left-half",
          },
        ],
      },
    });
    expect(setResult.isError).toBeFalsy();

    const compareResult = await client.callTool({
      name: "compare_design",
      arguments: {
        design_source: designPath,
        screenshot: screenshotDiffPath,
        threshold: 0.1,
        project_id: "ignore-project-merge",
        frame_name: "test-frame",
        ignore_regions: [
          {
            x: 100,
            y: 0,
            width: 100,
            height: 200,
            label: "inline-right-half",
          },
        ],
      },
    });
    expect(compareResult.isError).toBeFalsy();

    const data = JSON.parse(findTextContent(compareResult)!.text);
    expect(data.matchRate).toBe(100);
    expect(data.diffPixelCount).toBe(0);
    expect(data.totalPixelCount).toBe(0);
  });
});

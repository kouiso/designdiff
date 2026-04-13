import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import sharp from "sharp";
import { z } from "zod";

import {
  CompareDesignResultSchema,
  parseDesignInput,
  selfCritique,
  type CompareDesignResult,
  type CropRegion,
  type FigmaNode,
} from "@figdiff/shared";

import {
  buildComparisonSourceKey,
  getRecentReports,
  recordComparison,
} from "./comparison-history.js";
import { getCropRegion } from "./crop-region-store.js";
import { createFigmaService, type FigmaService } from "./figma-service.js";
import { compareImages } from "./image-compare-service.js";
import { resolveSafePath } from "../util/path-guard.js";

const FixtureFigmaNodeSchema: z.ZodType<FigmaNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    children: z.array(FixtureFigmaNodeSchema).default([]),
    absoluteBoundingBox: z
      .object({
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number(),
      })
      .nullable()
      .optional(),
    absoluteRenderBounds: z
      .object({
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number(),
      })
      .nullable()
      .optional(),
    fills: z.array(z.object({ type: z.string() })).default([]),
    strokes: z.array(z.object({ type: z.string() })).default([]),
    strokeWeight: z.number().optional(),
    cornerRadius: z.number().optional(),
    rectangleCornerRadii: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
    effects: z.array(z.object({ type: z.string() })).default([]),
    opacity: z.number().optional(),
    layoutMode: z.string().optional(),
    primaryAxisAlignItems: z.string().optional(),
    counterAxisAlignItems: z.string().optional(),
    paddingLeft: z.number().optional(),
    paddingRight: z.number().optional(),
    paddingTop: z.number().optional(),
    paddingBottom: z.number().optional(),
    itemSpacing: z.number().optional(),
    style: z
      .object({
        fontFamily: z.string().optional(),
        fontSize: z.number().optional(),
        fontWeight: z.number().optional(),
        lineHeightPx: z.number().optional(),
        letterSpacing: z.number().optional(),
        textAlignHorizontal: z.string().optional(),
      })
      .optional(),
    characters: z.string().optional(),
  }),
);

const LocalFixtureSchema = z.object({
  figmaRootNode: FixtureFigmaNodeSchema.optional(),
});

async function loadLocalFixtureNode(designPath: string): Promise<FigmaNode | undefined> {
  const fixturePath = path.join(path.dirname(designPath), "expected.json");

  try {
    const raw = await fs.readFile(fixturePath, "utf8");
    const parsed = LocalFixtureSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.figmaRootNode : undefined;
  } catch {
    return undefined;
  }
}

export interface CompareDesignRunArgs {
  design_source: string;
  screenshot: string;
  frame_name?: string;
  threshold?: number;
  project_id?: string;
}

export interface CompareDesignRunOutput {
  parsedDesignSource: ReturnType<typeof parseDesignInput>;
  result: CompareDesignResult;
}

async function resolveNodeId(
  figmaService: FigmaService,
  fileKey: string,
  nodeId: string | undefined,
  frameName: string | undefined,
): Promise<string> {
  if (nodeId) {
    return nodeId;
  }

  const frames = await figmaService.getFrames(fileKey);
  if (frameName) {
    const frame = frames.find((entry) => entry.name.toLowerCase() === frameName.toLowerCase());
    if (!frame) {
      throw new Error(
        `Frame "${frameName}" not found. Available frames: ${frames.map((entry) => entry.name).join(", ")}`,
      );
    }
    return frame.id;
  }

  throw new Error(
    `No frame specified. Available frames:\n${frames.map((entry) => `- ${entry.name} (${entry.id}, ${entry.width}x${entry.height})`).join("\n")}\n\nPlease specify frame_name or use a URL with node-id.`,
  );
}

function buildCompletionCriteria(
  matchRate: number,
  diffPixelCount: number,
  regionCount: number,
): {
  matchRate: { required: number; current: number; status: "PASS" | "FAIL" };
  diffPixelCount: { required: number; current: number; status: "PASS" | "FAIL" };
  remainingIssues: { required: number; current: number; status: "PASS" | "FAIL" };
} {
  return {
    matchRate: {
      required: 100,
      current: matchRate,
      status: matchRate === 100 ? "PASS" : "FAIL",
    },
    diffPixelCount: {
      required: 0,
      current: diffPixelCount,
      status: diffPixelCount === 0 ? "PASS" : "FAIL",
    },
    remainingIssues: {
      required: 0,
      current: regionCount,
      status: regionCount === 0 ? "PASS" : "FAIL",
    },
  };
}

function buildStatus(matchRate: number): "PASS" | "FAIL" {
  return matchRate === 100 ? "PASS" : "FAIL";
}

function buildNextAction(matchRate: number, regionCount: number): string {
  if (matchRate === 100) {
    return "一致率100%です。差分はありません。タスク完了です。";
  }

  return `inspect_node を使って ${regionCount} 箇所の diffRegions の詳細を確認し、CSSを修正してください。修正後は再度 compare_design で検証してください。`;
}

function buildSuggestion(matchRate: number, regionCount: number): string {
  if (matchRate === 100) {
    return "一致率100%です。差分はありません。";
  }
  if (matchRate >= 95) {
    return `軽微な差分が${regionCount}箇所あります。inspect_nodeで差分領域のノードを確認してください。`;
  }
  return `大きな差分が${regionCount}箇所あります。inspect_nodeで各差分領域を確認し、修正してください。`;
}

export async function runCompareDesign(
  args: CompareDesignRunArgs,
): Promise<CompareDesignRunOutput> {
  const parsedDesignSource = parseDesignInput(args.design_source);
  const screenshotPath = await resolveSafePath(args.screenshot);
  const screenshotBuffer = await fs.readFile(screenshotPath);
  const screenshotBase64 = screenshotBuffer.toString("base64");
  const screenshotMeta = await sharp(screenshotBuffer).metadata();
  const targetWidth = screenshotMeta.width;

  let designBase64: string;
  let figmaRootNode: FigmaNode | undefined;
  let resolvedNodeId: string | undefined;

  if (parsedDesignSource.type === "figma_url") {
    const figmaService = createFigmaService();
    resolvedNodeId = await resolveNodeId(
      figmaService,
      parsedDesignSource.fileKey,
      parsedDesignSource.nodeId,
      args.frame_name,
    );
    designBase64 = await figmaService.getFrameImage(
      parsedDesignSource.fileKey,
      resolvedNodeId,
      targetWidth,
    );

    try {
      figmaRootNode = await figmaService.getNodeDetails(parsedDesignSource.fileKey, resolvedNodeId);
    } catch (nodeError) {
      console.error(
        "[compare_design] node details fetch failed, proceeding without:",
        nodeError instanceof Error ? nodeError.message : nodeError,
      );
    }
  } else {
    // Local file path — validated to live inside an allowed directory
    const safePath = await resolveSafePath(parsedDesignSource.filePath);
    const designBuffer = await fs.readFile(safePath);
    designBase64 = designBuffer.toString("base64");
    figmaRootNode = await loadLocalFixtureNode(safePath);
  }

  let cropRegion: CropRegion | undefined;
  if (args.project_id) {
    const regions = await getCropRegion(args.project_id, args.frame_name);
    if (regions.length > 0) {
      cropRegion = regions[0].region;
    }
  }

  const comparison = await compareImages(
    {
      designBase64,
      screenshotBase64,
      threshold: args.threshold ?? 0.1,
      cropRegion,
    },
    figmaRootNode,
    `cmp-${randomUUID()}`,
  );

  const regionCount = comparison.diffRegions.length;
  const sourceKey = buildComparisonSourceKey(parsedDesignSource, resolvedNodeId);
  const priorReports = getRecentReports(sourceKey);
  const critique =
    comparison.diffReport && priorReports.length > 0
      ? selfCritique(comparison.diffReport, priorReports)
      : undefined;

  const result = CompareDesignResultSchema.parse({
    status: buildStatus(comparison.matchRate),
    ...comparison,
    remainingIssues: regionCount,
    completionCriteria: buildCompletionCriteria(
      comparison.matchRate,
      comparison.diffPixelCount,
      regionCount,
    ),
    nextAction: buildNextAction(comparison.matchRate, regionCount),
    suggestion: buildSuggestion(comparison.matchRate, regionCount),
    critique,
  });

  recordComparison({
    comparisonId: result.comparisonId,
    sourceKey,
    result,
  });

  return {
    parsedDesignSource,
    result,
  };
}

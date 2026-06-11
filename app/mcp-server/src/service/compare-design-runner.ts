import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import sharp from "sharp";
import { z } from "zod";

import {
  buildComparisonHeadline,
  CompareDesignResultSchema,
  diagnoseComparison,
  formatFrameCandidates,
  parseDesignInput,
  rankFrameCandidates,
  runPreflight,
  selfCritique,
  type CompareDesignResult,
  type ComparisonDiagnosis,
  type CropRegion,
  type DiffReport,
  type FigmaNode,
  type IgnoreRegion,
} from "@figdiff/shared";

import { resolveSafePath } from "../util/path-guard.js";

import {
  buildComparisonSourceKey,
  getRecentReports,
  recordComparison,
} from "./comparison-history.js";
import { getCropRegion } from "./crop-region-store.js";
import { createFigmaService, type FigmaService } from "./figma-service.js";
import { getIgnoreRegionsForComparison } from "./ignore-region-store.js";
import { compareImages } from "./image-compare-service.js";

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
  // expected.json もパスガードで検証してから読み込む
  const fixturePath = path.join(path.dirname(designPath), "expected.json");

  try {
    const safeFixturePath = await resolveSafePath(fixturePath);
    const raw = await fs.readFile(safeFixturePath, "utf8");
    const parsed = LocalFixtureSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.figmaRootNode : undefined;
  } catch {
    return undefined;
  }
}

export interface CompareDesignRunArgs {
  design_source: string;
  screenshot: string;
  screenshot_url?: string;
  capture_width?: number;
  frame_name?: string;
  threshold?: number;
  project_id?: string;
  // 既知の意図的差分マスク。compare 結果から除外される。
  // 座標系は cropRegion 適用後 (= screenshot ピクセル座標)。
  ignore_regions?: IgnoreRegion[];
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
  targetWidth: number | undefined,
): Promise<string> {
  if (nodeId) {
    return nodeId;
  }

  const frames = await figmaService.getFrames(fileKey);
  // 実コンテンツらしいフレーム (撮影幅一致・ページらしい形) を上位に並べた候補一覧。
  // 正常解決時には不要なので、エラー時にのみ生成する。
  const buildGuidance = (): string =>
    formatFrameCandidates(rankFrameCandidates(frames, targetWidth), targetWidth);

  if (frameName) {
    const matches = frames.filter((entry) => entry.name.toLowerCase() === frameName.toLowerCase());
    if (matches.length === 0) {
      throw new Error(`Frame "${frameName}" not found.\n\n${buildGuidance()}`);
    }
    if (matches.length > 1) {
      throw new Error(
        `Ambiguous frame name "${frameName}": ${matches.length} frames match. Use node-id in the URL to disambiguate. Matches: ${matches.map((f) => `${f.id} (${f.width}x${f.height})`).join(", ")}`,
      );
    }
    return matches[0].id;
  }

  throw new Error(
    `No frame specified.\n\n${buildGuidance()}\n\nURL に node-id を付けるか frame_name を指定してください。`,
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

export function buildTargetNodeIds(
  diffReport: DiffReport | undefined,
  diffRegions: CompareDesignResult["diffRegions"],
  limit = 5,
): string[] {
  if (limit <= 0) {
    return [];
  }

  const candidates: string[] = [];

  const rankedRegionScores = [...(diffReport?.regionScores ?? [])]
    .filter((score) => typeof score.figmaNodeId === "string" && score.figmaNodeId.length > 0)
    .sort((a, b) => a.structure - b.structure);

  for (const score of rankedRegionScores) {
    if (score.figmaNodeId) candidates.push(score.figmaNodeId);
  }

  for (const region of diffRegions) {
    for (const nodeId of region.nearbyNodeIds) {
      if (nodeId.length > 0) {
        candidates.push(nodeId);
      }
    }
  }

  return [...new Set(candidates)].slice(0, limit);
}

function buildNextAction(matchRate: number, regionCount: number, targetNodeIds: string[]): string {
  if (matchRate === 100) {
    return "一致率100%です。差分はありません。タスク完了です。";
  }

  if (targetNodeIds.length === 0) {
    return `inspect_node を使って ${regionCount} 箇所の diffRegions の詳細を確認し、CSSを修正してください。修正後は再度 compare_design で検証してください。`;
  }

  return `inspect_node を使って ${regionCount} 箇所の diffRegions の詳細を確認してください。まず ${targetNodeIds.join(" -> ")} の順で確認し、CSSを修正したら再度 compare_design で検証してください。`;
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

// 設定ミスの可能性が高い場合、CSS修正ではなくセットアップ修正へ誘導する。
// tool description が nextAction に従うよう指示しているため、誤った CSS 修正に
// 進ませないよう診断結果で nextAction を上書きする。
function buildMisconfigNextAction(diagnosis: ComparisonDiagnosis): string {
  const top = diagnosis.rankedCauses[0];
  const fix = top
    ? top.suggestedFix
    : "設定（capture_width / crop region / node-id）を見直してください。";
  return `⚠️ セットアップ問題の可能性が高いです。CSS修正の前に、まず設定を見直してください: ${fix} 解消後に再度 compare_design で検証してください。`;
}

async function resolveScreenshotPath(args: CompareDesignRunArgs): Promise<string> {
  if (!args.screenshot_url) {
    return resolveSafePath(args.screenshot);
  }

  const { captureUrl } = await import("./capture-service.js");
  const parsedDesignSource = parseDesignInput(args.design_source);
  let captureWidth = args.capture_width;
  if (!captureWidth && parsedDesignSource.type === "figma_url") {
    try {
      const figmaService = createFigmaService();
      const frames = await figmaService.getFrames(parsedDesignSource.fileKey);
      const nodeId = parsedDesignSource.nodeId?.replace(/-/g, ":");
      const matched =
        (nodeId ? frames.find((f) => f.id === nodeId) : undefined) ??
        (args.frame_name
          ? frames.find((f) => f.name.toLowerCase() === args.frame_name!.toLowerCase())
          : undefined);
      captureWidth = matched?.width;
    } catch {
      // proceed with default width
    }
  }
  const captured = await captureUrl(args.screenshot_url, { width: captureWidth ?? 1440 });
  return captured.screenshotPath;
}

async function resolveDesignAssets(
  parsedDesignSource: ReturnType<typeof parseDesignInput>,
  frameName: string | undefined,
  targetWidth: number | undefined,
): Promise<{
  designBase64: string;
  figmaRootNode: FigmaNode | undefined;
  resolvedNodeId: string | undefined;
}> {
  if (parsedDesignSource.type === "figma_url") {
    const figmaService = createFigmaService();
    const resolvedNodeId = await resolveNodeId(
      figmaService,
      parsedDesignSource.fileKey,
      parsedDesignSource.nodeId,
      frameName,
      targetWidth,
    );
    const designBase64 = await figmaService.getFrameImage(
      parsedDesignSource.fileKey,
      resolvedNodeId,
      targetWidth,
    );

    let figmaRootNode: FigmaNode | undefined;
    try {
      figmaRootNode = await figmaService.getNodeDetails(parsedDesignSource.fileKey, resolvedNodeId);
    } catch (nodeError) {
      console.error(
        "[compare_design] node details fetch failed, proceeding without:",
        nodeError instanceof Error ? nodeError.message : nodeError,
      );
    }

    return { designBase64, figmaRootNode, resolvedNodeId };
  }

  // ローカルファイルのパス — 許可ディレクトリ内に存在するか検証する
  const safePath = await resolveSafePath(parsedDesignSource.filePath);
  const designBuffer = await fs.readFile(safePath);
  const designBase64 = designBuffer.toString("base64");
  const figmaRootNode = await loadLocalFixtureNode(safePath);
  return { designBase64, figmaRootNode, resolvedNodeId: undefined };
}

export async function runCompareDesign(
  args: CompareDesignRunArgs,
): Promise<CompareDesignRunOutput> {
  const parsedDesignSource = parseDesignInput(args.design_source);
  // スクリーンショットの読み込み — 許可されたディレクトリ内にあることを検証する
  const screenshotPath = await resolveScreenshotPath(args);
  const screenshotBuffer = await fs.readFile(screenshotPath);
  const screenshotBase64 = screenshotBuffer.toString("base64");
  const screenshotMeta = await sharp(screenshotBuffer).metadata();
  const targetWidth = screenshotMeta.width;

  const { designBase64, figmaRootNode, resolvedNodeId } = await resolveDesignAssets(
    parsedDesignSource,
    args.frame_name,
    targetWidth,
  );

  let cropRegion: CropRegion | undefined;
  let cropUpdatedAt: string | undefined;
  let persistedIgnoreRegions: IgnoreRegion[] = [];
  if (args.project_id) {
    const regions = await getCropRegion(args.project_id, args.frame_name);
    if (regions.length > 0) {
      cropRegion = regions[0].region;
      cropUpdatedAt = regions[0].updatedAt;
    }
    persistedIgnoreRegions = await getIgnoreRegionsForComparison(args.project_id, args.frame_name);
  }
  const ignoreRegions = [...persistedIgnoreRegions, ...(args.ignore_regions ?? [])];

  const comparison = await compareImages(
    {
      designBase64,
      screenshotBase64,
      threshold: args.threshold ?? 0.1,
      cropRegion,
      figmaNodeId: resolvedNodeId,
      ignoreRegions,
    },
    figmaRootNode,
    `cmp-${randomUUID()}`,
  );
  const figmaProvenance =
    parsedDesignSource.type === "figma_url"
      ? {
          figmaFileKey: parsedDesignSource.fileKey,
          figmaNodeId: resolvedNodeId,
          figmaPageName: figmaRootNode?.name,
        }
      : undefined;
  if (comparison.diffReport && figmaProvenance) {
    comparison.diffReport.issues = comparison.diffReport.issues.map((issue) => ({
      ...issue,
      evidence: {
        ...issue.evidence,
        figmaFileKey: issue.evidence.figmaFileKey ?? figmaProvenance.figmaFileKey,
        figmaNodeId: issue.evidence.figmaNodeId ?? figmaProvenance.figmaNodeId,
        figmaPageName: issue.evidence.figmaPageName ?? figmaProvenance.figmaPageName,
      },
    }));
  }

  // 確信度レイヤー: 設定ミスを検知・説明し、結果ヘッドラインを構造/色に分離する。
  const figmaFrameBox = figmaRootNode?.absoluteBoundingBox ?? undefined;
  const regionScores = comparison.diffReport?.regionScores ?? [];
  const preflight = runPreflight({
    screenshotWidth: comparison.normalization?.screenshotWidth ?? screenshotMeta.width ?? 0,
    screenshotHeight: comparison.normalization?.screenshotHeight ?? screenshotMeta.height ?? 0,
    figmaFrameWidth: figmaFrameBox?.width,
    figmaFrameHeight: figmaFrameBox?.height,
    cropRegion,
    cropUpdatedAt,
    figmaChildCount: figmaRootNode?.children?.length,
    figmaNodeType: figmaRootNode?.type,
  });
  const comparisonHeadline = buildComparisonHeadline(regionScores, comparison.matchRate);
  const diagnosis = diagnoseComparison({
    matchRate: comparison.matchRate,
    regionScores,
    preflightWarnings: preflight.warnings,
    normalization: comparison.normalization,
  });

  const regionCount = comparison.diffRegions.length;
  const targetNodeIds = buildTargetNodeIds(comparison.diffReport, comparison.diffRegions);
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
    nextAction: diagnosis.likelyMisconfig
      ? buildMisconfigNextAction(diagnosis)
      : buildNextAction(comparison.matchRate, regionCount, targetNodeIds),
    suggestion: diagnosis.likelyMisconfig
      ? diagnosis.headline
      : buildSuggestion(comparison.matchRate, regionCount),
    critique,
    preflight,
    comparisonHeadline,
    diagnosis,
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

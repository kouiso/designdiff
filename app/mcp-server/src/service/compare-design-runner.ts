import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import sharp from "sharp";
import { z } from "zod";

import { captureDeviceScreenshot, type CaptureDevice } from "@figdiff/mobile-capture";
import {
  buildComparisonHeadline,
  buildSystemBarIgnoreRegions,
  CompareDesignResultSchema,
  diagnoseComparison,
  formatFrameCandidates,
  normalizeNodeId,
  parseDesignInput,
  rankFrameCandidates,
  PERCEPTIBLE_DELTA_E,
  PERCEPTIBLE_DIFF_CONTRADICTION_RATIO,
  runPreflight,
  selfCritique,
  type CompareDesignResult,
  type ComparisonDiagnosis,
  type CropRegion,
  type DiffReport,
  type DiffVerdict,
  type FigmaNode,
  type IgnoreRegion,
  type LoopGuardReport,
  type PreflightWarning,
} from "@figdiff/shared";

import {
  EMPTY_SCREENSHOT_INPUT_MESSAGE,
  resolveSafePath,
  resolveScreenshotInputPath,
} from "../util/path-guard.js";

import {
  buildComparisonSourceKey,
  getRecentReports,
  recordComparison,
} from "./comparison-history.js";
import { getCropRegionForComparison } from "./crop-region-store.js";
import { createFigmaService, type FigmaService } from "./figma-service.js";
import { getIgnoreRegionsForComparison } from "./ignore-region-store.js";
import { compareImages, redactImageBase64ForPublicExport } from "./image-compare-service.js";
import { getLastUsedNode, setLastUsedNode } from "./last-used-node-store.js";
import { recordIterationAndEvaluate } from "./loop-guard-service.js";
import { persistDiffImage } from "./persist-detail.js";

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

// スクショのデコード/比較を許容する入力ピクセル上限。これを超える入力は
// raw バッファでプロセスを OOM させうるため、比較前に明確なエラーで弾く。
const MAX_DECODE_PIXELS = 40_000_000;

// threshold の既定値を決める比較プロファイル。
// threshold を直接指定した場合はそちらが優先される。
type ComparisonProfile = "strict" | "balanced" | "layout";

const PROFILE_THRESHOLDS: Record<ComparisonProfile, number> = {
  strict: 0.0,
  balanced: 0.1,
  layout: 0.4,
};

function resolveThreshold(
  threshold: number | undefined,
  profile: ComparisonProfile | undefined,
): number {
  if (threshold !== undefined) return threshold;
  if (profile !== undefined) return PROFILE_THRESHOLDS[profile];
  return 0.1;
}

export interface CompareDesignRunArgs {
  design_source: string;
  screenshot?: string;
  screenshot_url?: string;
  capture_device?: CaptureDevice;
  capture_width?: number;
  frame_name?: string;
  threshold?: number;
  profile?: ComparisonProfile;
  project_id?: string;
  mask_system_ui?: boolean;
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
  targetHeight: number | undefined,
): Promise<string> {
  if (nodeId) {
    return nodeId;
  }

  const frames = await figmaService.getFrames(fileKey);
  // 実コンテンツらしいフレーム (撮影幅一致・ページらしい形) を上位に並べた候補一覧。
  // 正常解決時には不要なので、エラー時にのみ生成する。
  const buildGuidance = (): string =>
    formatFrameCandidates(rankFrameCandidates(frames, targetWidth, targetHeight), targetWidth);

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

  const ranked = rankFrameCandidates(frames, targetWidth, targetHeight);
  if (ranked.length === 0) {
    throw new Error(`No frame specified and no frames found in the file.\n\n${buildGuidance()}`);
  }
  const autoSelected = ranked[0];
  const widthDiff =
    targetWidth !== undefined ? Math.abs(autoSelected.width - targetWidth) : undefined;
  const deviationNote = widthDiff !== undefined && widthDiff > 10 ? ` (幅差 ${widthDiff}px)` : "";
  console.error(
    `[compare_design] node-id未指定のため幅${targetWidth ?? "不明"}pxに最も近い "${autoSelected.name}" (${autoSelected.id}) を自動選択${deviationNote}`,
  );
  return autoSelected.id;
}

function buildCompletionCriteria(
  matchRate: number,
  diffPixelCount: number,
  regionCount: number,
  structuralVerdict: DiffVerdict,
  structuralRationale: string | undefined,
  perceptibleDiffRatio: number | undefined,
): Record<
  "structuralReview" | "consistencyReview" | "matchRate" | "diffPixelCount" | "remainingIssues",
  {
    required: number;
    current: number;
    status: "PASS" | "FAIL" | "UNCERTAIN";
    blocking: boolean;
    note: string;
  }
> {
  // inconclusive を FAIL と書くと「直せば PASS になる」と読まれる。実際は
  // 判定の確からしさが足りていない状態なので、status も UNCERTAIN で揃える。
  const structuralStatus =
    structuralVerdict === "pass"
      ? "PASS"
      : structuralVerdict === "inconclusive"
        ? "UNCERTAIN"
        : "FAIL";
  const pixelsAgreeWithPass = !isPassContradictedByPixels(structuralVerdict, perceptibleDiffRatio);

  return {
    structuralReview: {
      required: 1,
      current: structuralVerdict === "pass" ? 1 : 0,
      status: structuralStatus,
      blocking: true,
      note:
        structuralVerdict === "inconclusive"
          ? "Structural SSIM verdict is inconclusive; treat this as not complete and ask for review."
          : (structuralRationale ?? "Structural SSIM verdict from diffReport.aggregateVerdict."),
    },
    consistencyReview: {
      required: PERCEPTIBLE_DIFF_CONTRADICTION_RATIO,
      current: perceptibleDiffRatio ?? 0,
      status: pixelsAgreeWithPass ? "PASS" : "UNCERTAIN",
      blocking: !pixelsAgreeWithPass,
      note: pixelsAgreeWithPass
        ? perceptibleDiffRatio === undefined
          ? "Not evaluated: the contradiction check only applies to a passing structural review."
          : "Structural review and the perceptible-difference evidence agree."
        : `Structural review says pass, yet ${formatPerceptibleDiffPercent(perceptibleDiffRatio)} of pixels differ visibly (CIEDE2000 above ${PERCEPTIBLE_DELTA_E}); the limit is ${Math.round(PERCEPTIBLE_DIFF_CONTRADICTION_RATIO * 100)}%. One of the two is wrong, so this comparison is routed to human review instead of reporting PASS.`,
    },
    matchRate: {
      required: 100,
      current: matchRate,
      status: matchRate >= 100 ? "PASS" : "FAIL",
      blocking: false,
      note: "Reference metric only. Do not use matchRate% as the completion gate.",
    },
    diffPixelCount: {
      required: 0,
      current: diffPixelCount,
      status: structuralStatus === "PASS" || diffPixelCount === 0 ? "PASS" : "FAIL",
      blocking: false,
      note: "Reference metric. Structural SSIM review is the blocking gate.",
    },
    remainingIssues: {
      required: 0,
      current: regionCount,
      // blocking が true のとき行が PASS を報告すると status と矛盾する。
      // status は blocking ゲート (構造判定) に合わせ、regionCount===0 の
      // ショートカットは構造が PASS のときだけ効かせる。
      status: structuralStatus === "PASS" ? "PASS" : "FAIL",
      blocking: structuralStatus !== "PASS",
      note: "Blocking only while structural SSIM review has not passed.",
    },
  };
}

function resolveStructuralVerdict(
  diffReport: DiffReport | undefined,
  diffPixelCount: number,
): { verdict: DiffVerdict; rationale: string | undefined } {
  if (diffReport) {
    return { verdict: diffReport.aggregateVerdict, rationale: diffReport.rationale };
  }

  return {
    verdict: diffPixelCount === 0 ? "pass" : "fail",
    rationale: "diffReport unavailable; fell back to exact pixel diff.",
  };
}

// 設定ミス (空フレーム / 激しいアスペクト潰れ / 誤フレーム) が疑われる比較は、
// 構造判定が pass でも fail でも信用できない。信用できる計器の条件は
// 「自信が無いとき嘘の PASS/FAIL を出さず UNCERTAIN と正直に申告する」こと。
// likelyMisconfig と構造判定 inconclusive は判定の確からしさ自体が欠けた状態
// なので、PASS/FAIL ではなく UNCERTAIN に倒して人間レビューへ回す。
type CompareStatus = "PASS" | "FAIL" | "UNCERTAIN";

// 判定器が pass と言っているのに、画面の大半が目に見えて違う。どちらかが嘘なので
// PASS を出さず人間レビューへ回す。
//
// 証拠に matchRate は使わない。matchRate は pixelmatch の threshold と profile に
// 依存するため、strict profile では描画エンジン差の 1/255 のブレでも「違う画素」に
// 数えられ、正しい実装まで人間レビューへ送ってしまう。判定側の都合で動く数字を
// 判定の審判に据えると、結局は自己認証になる (Codex 指摘)。
//
// 代わりに perceptibleDiffRatio を使う。ΔE2000 が知覚の境目 (2) を超えた画素の
// 割合で、threshold にも profile にも依存しない。1段の量子化ノイズ (ΔE≈0.3) は
// はじめから数に入らない。
//
// 半分を境にするのは、平均 ΔE では拾えない形を拾うため。広い無変化領域が平均を
// 押し下げると、画面の過半が目に見えて違っていても mean は閾値 2 を下回る。

function isPassContradictedByPixels(
  structuralVerdict: DiffVerdict,
  perceptibleDiffRatio: number | undefined,
): boolean {
  if (structuralVerdict !== "pass") return false;
  if (typeof perceptibleDiffRatio !== "number") return false;
  return perceptibleDiffRatio > PERCEPTIBLE_DIFF_CONTRADICTION_RATIO;
}

function formatPerceptibleDiffPercent(perceptibleDiffRatio: number | undefined): string {
  return `${Math.round((perceptibleDiffRatio ?? 0) * 100)}%`;
}

function buildPixelContradictionNextAction(perceptibleDiffRatio: number | undefined): string {
  return `構造判定は pass ですが、画面の ${formatPerceptibleDiffPercent(perceptibleDiffRatio)} が目に見えて違います。判定と証拠が食い違っているため、自動修正を続けず現状を人間に報告してください。`;
}

function buildPixelContradictionSuggestion(perceptibleDiffRatio: number | undefined): string {
  return `構造判定と画素の証拠が矛盾しています (目に見える差 ${formatPerceptibleDiffPercent(perceptibleDiffRatio)})。比較対象のフレーム / crop / 撮影条件が正しいかを人間が確認してください。`;
}

function buildStatus(
  structuralVerdict: DiffVerdict,
  likelyMisconfig: boolean,
  perceptibleDiffRatio: number | undefined,
): CompareStatus {
  if (likelyMisconfig) {
    return "UNCERTAIN";
  }
  if (structuralVerdict === "inconclusive") {
    return "UNCERTAIN";
  }
  if (isPassContradictedByPixels(structuralVerdict, perceptibleDiffRatio)) {
    return "UNCERTAIN";
  }
  return structuralVerdict === "pass" ? "PASS" : "FAIL";
}

// diff 画像を永続化すべきかを status 起点で判定する。FAIL のときは matchRate が
// 100 に丸まり diffPixelCount が 0 でも証拠画像を残す。pixel メトリクスだけで
// ゲートすると、構造判定や misconfig 由来の FAIL で diff 画像が欠落する。
function shouldPersistDiffImage(
  status: CompareStatus,
  structuralVerdict: DiffVerdict,
  matchRate: number,
  diffPixelCount: number,
): boolean {
  return status !== "PASS" || structuralVerdict !== "pass" || matchRate < 100 || diffPixelCount > 0;
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

function buildNextAction(
  structuralVerdict: DiffVerdict,
  regionCount: number,
  targetNodeIds: string[],
): string {
  if (structuralVerdict === "pass") {
    return "構造SSIM判定はPASSです。matchRate%は参考値として扱い、差分画像に重大な崩れがないことを確認して完了してください。";
  }

  if (structuralVerdict === "inconclusive") {
    return "構造SSIM判定はinconclusiveです。完成扱いにせず、diff画像をレイアウト・色・文字・余白の観点で人手確認してください。";
  }

  if (targetNodeIds.length === 0) {
    return `inspect_node を使って ${regionCount} 箇所の diffRegions の詳細を確認し、CSSを修正してください。修正後は再度 compare_design で検証してください。`;
  }

  return `inspect_node を使って ${regionCount} 箇所の diffRegions の詳細を確認してください。まず ${targetNodeIds.join(" -> ")} の順で確認し、CSSを修正したら再度 compare_design で検証してください。`;
}

function buildSuggestion(
  structuralVerdict: DiffVerdict,
  matchRate: number,
  regionCount: number,
): string {
  if (structuralVerdict === "pass") {
    return `構造SSIM判定はPASSです。matchRate ${matchRate.toFixed(2)}% は参考値で、完成ゲートではありません。`;
  }
  if (structuralVerdict === "inconclusive") {
    return `matchRate ${matchRate.toFixed(2)}% だけでは判断できません。diff画像を構造レベルでレビューしてください。`;
  }
  if (matchRate >= 95) {
    return `matchRateは高いですが、構造SSIM判定はFAILです。局所的な粗を${regionCount}箇所確認してください。`;
  }
  return `大きな差分が${regionCount}箇所あります。inspect_nodeで各差分領域を確認し、修正してください。`;
}

// nodeId も frame_name も未指定のとき、前回使用ノードをフォールバックとして返す。
async function resolveLastUsedFallback(
  args: CompareDesignRunArgs,
  fileKey: string,
): Promise<{ fallbackNodeId: string | undefined; lastUsedNodeNote: string | undefined }> {
  if (!args.project_id || args.frame_name) {
    return { fallbackNodeId: undefined, lastUsedNodeNote: undefined };
  }
  let lastUsed: Awaited<ReturnType<typeof getLastUsedNode>>;
  try {
    lastUsed = await getLastUsedNode(args.project_id, fileKey);
  } catch (error) {
    console.warn(
      "[compare_design] last-used node fetch failed, skipping fallback:",
      error instanceof Error ? error.message : error,
    );
    return { fallbackNodeId: undefined, lastUsedNodeNote: undefined };
  }
  if (!lastUsed) {
    return { fallbackNodeId: undefined, lastUsedNodeNote: undefined };
  }
  const normalizedNodeId = normalizeNodeId(lastUsed.nodeId);
  const note = lastUsed.nodeName
    ? `前回使用したノード "${lastUsed.nodeName}" (${normalizedNodeId}) を自動使用しました。`
    : `前回使用したノード ${normalizedNodeId} を自動使用しました。`;
  return { fallbackNodeId: normalizedNodeId, lastUsedNodeNote: note };
}

// blank_frame 警告が出たとき、フレーム候補一覧を suggestedFix に付与する。
async function enhanceBlankFrameWarning(
  warnings: PreflightWarning[],
  fileKey: string,
  screenWidth: number | undefined,
  screenHeight: number | undefined,
): Promise<PreflightWarning[]> {
  if (!warnings.some((w) => w.code === "blank_frame")) {
    return warnings;
  }
  try {
    const figmaService = await createFigmaService();
    const frames = await figmaService.getFrames(fileKey);
    const candidateText = formatFrameCandidates(
      rankFrameCandidates(frames, screenWidth, screenHeight),
      screenWidth,
    );
    return warnings.map((w) =>
      w.code === "blank_frame"
        ? { ...w, suggestedFix: `コンテンツを持つフレームを選択してください:\n${candidateText}` }
        : w,
    );
  } catch {
    // フレーム一覧の取得失敗は非致命的。基本の警告メッセージのみで続行する。
    return warnings;
  }
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

function buildDiagnosisNextAction(diagnosis: ComparisonDiagnosis): string | undefined {
  const aspectCause = diagnosis.rankedCauses.find((cause) => cause.code === "aspect_mismatch");
  if (!aspectCause) {
    return undefined;
  }
  return `${aspectCause.suggestedFix} ${diagnosis.headline}`;
}

// fallbackNodeId は last-used node フォールバックから来る可能性がある。
// screenshot_url 撮影前に解決しておくことで、フレームの実幅を capture_width に使える。
async function resolveScreenshotPath(
  args: CompareDesignRunArgs,
  fallbackNodeId?: string,
): Promise<string> {
  const screenshotSources = [
    args.screenshot && args.screenshot.trim() !== "" ? "screenshot" : undefined,
    args.screenshot_url ? "screenshot_url" : undefined,
    args.capture_device ? "capture_device" : undefined,
  ].filter((source): source is string => Boolean(source));
  if (screenshotSources.length > 1) {
    throw new Error(
      `Specify exactly one of screenshot, screenshot_url, or capture_device (received: ${screenshotSources.join(
        ", ",
      )}).`,
    );
  }

  if (args.capture_device) {
    return captureDeviceScreenshot({ device: args.capture_device });
  }

  if (!args.screenshot_url) {
    if (!args.screenshot || args.screenshot.trim() === "") {
      throw new Error(EMPTY_SCREENSHOT_INPUT_MESSAGE);
    }
    return resolveScreenshotInputPath(args.screenshot);
  }

  const { captureUrl } = await import("./capture-service.js");
  const parsedDesignSource = parseDesignInput(args.design_source);
  let captureWidth = args.capture_width;
  if (!captureWidth && parsedDesignSource.type === "figma_url") {
    try {
      const figmaService = await createFigmaService();
      const frames = await figmaService.getFrames(parsedDesignSource.fileKey);
      const effectiveNodeId =
        parsedDesignSource.nodeId ?? (fallbackNodeId ? normalizeNodeId(fallbackNodeId) : undefined);
      const matched =
        (effectiveNodeId ? frames.find((f) => f.id === effectiveNodeId) : undefined) ??
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
  targetHeight: number | undefined,
  fallbackNodeId?: string,
): Promise<{
  designBase64: string;
  figmaRootNode: FigmaNode | undefined;
  resolvedNodeId: string | undefined;
}> {
  if (parsedDesignSource.type === "figma_url") {
    const figmaService = await createFigmaService();
    // nodeId が未指定のとき、前回使用ノードのフォールバックを試みる。
    const effectiveNodeId =
      parsedDesignSource.nodeId ?? (fallbackNodeId ? normalizeNodeId(fallbackNodeId) : undefined);
    const resolvedNodeId = await resolveNodeId(
      figmaService,
      parsedDesignSource.fileKey,
      effectiveNodeId,
      frameName,
      targetWidth,
      targetHeight,
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

    // ダウンサンプリングによる補間ボケとそれによる差分誤検知を防ぐため。
    const logicalWidth = figmaRootNode?.absoluteBoundingBox?.width;
    const frameImage = await figmaService.getFrameImage(
      parsedDesignSource.fileKey,
      resolvedNodeId,
      targetWidth,
      logicalWidth,
      parsedDesignSource.version,
      {
        logicalBox: figmaRootNode?.absoluteBoundingBox,
        renderBox: figmaRootNode?.absoluteRenderBounds,
      },
    );
    if (frameImage.effectMarginCrop) {
      console.error(
        `[compare_design] trimmed Figma effect margin to the logical bounding box (${frameImage.effectMarginCrop.width}x${frameImage.effectMarginCrop.height}px)`,
      );
    }

    return { designBase64: frameImage.base64, figmaRootNode, resolvedNodeId };
  }

  // ローカルファイルのパス — 許可ディレクトリ内に存在するか検証する
  const safePath = await resolveSafePath(parsedDesignSource.filePath);
  const designBuffer = await fs.readFile(safePath);
  try {
    await sharp(designBuffer).metadata();
  } catch {
    throw new Error(
      `Failed to decode design image (file may be corrupt or truncated): ${safePath}`,
    );
  }
  const designBase64 = designBuffer.toString("base64");
  const figmaRootNode = await loadLocalFixtureNode(safePath);
  return { designBase64, figmaRootNode, resolvedNodeId: undefined };
}

interface ProjectRegions {
  cropRegion: CropRegion | undefined;
  cropUpdatedAt: string | undefined;
  ignoreRegions: IgnoreRegion[];
}

async function resolveProjectRegions(
  projectId: string | undefined,
  frameName: string | undefined,
  extraIgnoreRegions: IgnoreRegion[] | undefined,
): Promise<ProjectRegions> {
  let cropRegion: CropRegion | undefined;
  let cropUpdatedAt: string | undefined;
  let persistedIgnoreRegions: IgnoreRegion[] = [];
  if (projectId) {
    const region = await getCropRegionForComparison(projectId, frameName);
    cropRegion = region?.region;
    cropUpdatedAt = region?.updatedAt;
    persistedIgnoreRegions = await getIgnoreRegionsForComparison(projectId, frameName);
  }
  return {
    cropRegion,
    cropUpdatedAt,
    ignoreRegions: [...persistedIgnoreRegions, ...(extraIgnoreRegions ?? [])],
  };
}

// スクショの高さが design フレーム高を超えた分を自動で crop する。
// 「AIにフル任せ」の定義上、人間が project の cropRegion を手設定する
// 工程を無くすための自動化 (真の完成プランP1)。幅が一致しない場合は
// 撮影条件そのものが疑わしいため自動crop対象外とし、既存の preflight
// (width_mismatch等) に判断を委ねる。
const AUTO_CROP_WIDTH_TOLERANCE_PX = 2;
// 超過領域が「空白/背景色」とみなせる標準偏差の上限 (0-255 スケール)。
// これを超えるコンテンツ (文字・写真・追加セクション等) がある超過領域は
// 実装差分の可能性が高いため crop せず、通常どおり比較対象に含める。
const AUTO_CROP_UNIFORM_STDDEV_THRESHOLD = 8;

// 超過領域が実質空白かどうかを判定する。意図しない追加セクション
// (=本物の差分。回帰テストで実証済み: 360x600 design に対し 360x1548 の
// 実装スクショを auto-crop すると余分なセクションごと差分が消える) を
// 「単なる余白」と誤認して握り潰さないための安全ガード。
async function isExcessRegionBlank(
  screenshotBuffer: Buffer,
  region: { left: number; top: number; width: number; height: number },
): Promise<boolean> {
  if (region.width <= 0 || region.height <= 0) {
    return true;
  }
  try {
    const stats = await sharp(screenshotBuffer).extract(region).stats();
    return stats.channels.every((channel) => channel.stdev <= AUTO_CROP_UNIFORM_STDDEV_THRESHOLD);
  } catch {
    // 抽出に失敗した場合は安全側 (crop しない) に倒す。
    return false;
  }
}

export async function resolveAutoCrop(
  existingCropRegion: CropRegion | undefined,
  figmaFrameBox: { width: number; height: number } | undefined,
  screenshotWidth: number | undefined,
  screenshotHeight: number | undefined,
  screenshotBuffer: Buffer,
): Promise<CropRegion | undefined> {
  if (existingCropRegion || !figmaFrameBox || !screenshotWidth || !screenshotHeight) {
    return undefined;
  }
  const widthDiff = Math.abs(screenshotWidth - figmaFrameBox.width);
  if (widthDiff > AUTO_CROP_WIDTH_TOLERANCE_PX) {
    return undefined;
  }
  if (screenshotHeight <= figmaFrameBox.height) {
    return undefined;
  }
  const excessRegion = {
    left: 0,
    top: Math.floor(figmaFrameBox.height),
    width: Math.floor(screenshotWidth),
    height: Math.floor(screenshotHeight - figmaFrameBox.height),
  };
  const isBlank = await isExcessRegionBlank(screenshotBuffer, excessRegion);
  if (!isBlank) {
    return undefined;
  }
  return { x: 0, y: 0, width: figmaFrameBox.width, height: figmaFrameBox.height };
}

// comparison.normalization の screenshotWidth/Height は常に crop 適用前の
// native 実測値を報告する (cropApplied=true でも native のまま)。
// preflight の aspect_ratio_mismatch 判定に生の値を渡すと、design/screenshot
// 両方に同じ cropRegion を適用した後は必ず一致するはずの寸法が
// 「crop前 vs design」で比較されて誤検知する。cropRegion 適用時は
// 比較後の実サイズ (= cropRegion の寸法) を preflight に渡す。
function resolvePreflightDimensions(
  cropRegion: CropRegion | undefined,
  normalization:
    | {
        screenshotWidth?: number;
        screenshotHeight?: number;
        designNativeWidth?: number;
        designNativeHeight?: number;
      }
    | undefined,
  screenshotMeta: { width?: number; height?: number },
  figmaFrameBox: { width: number; height: number } | undefined,
): {
  screenshotWidth: number;
  screenshotHeight: number;
  figmaFrameWidth: number | undefined;
  figmaFrameHeight: number | undefined;
} {
  return {
    screenshotWidth:
      cropRegion?.width ?? normalization?.screenshotWidth ?? screenshotMeta.width ?? 0,
    screenshotHeight:
      cropRegion?.height ?? normalization?.screenshotHeight ?? screenshotMeta.height ?? 0,
    figmaFrameWidth: cropRegion?.width ?? normalization?.designNativeWidth ?? figmaFrameBox?.width,
    figmaFrameHeight:
      cropRegion?.height ?? normalization?.designNativeHeight ?? figmaFrameBox?.height,
  };
}

function buildSystemIgnoreRegionsForComparison(
  args: CompareDesignRunArgs,
  screenshotMeta: sharp.Metadata,
  cropRegion: CropRegion | undefined,
): IgnoreRegion[] {
  const maskSystemUi = args.mask_system_ui ?? args.capture_device !== undefined;
  if (!maskSystemUi) {
    return [];
  }

  return buildSystemBarIgnoreRegions(
    screenshotMeta.width ?? 0,
    screenshotMeta.height ?? 0,
    args.capture_device ?? "android",
    cropRegion,
  );
}

interface FigmaProvenance {
  figmaFileKey: string;
  figmaNodeId: string | undefined;
  figmaPageName: string | undefined;
}

function applyFigmaProvenance(
  comparison: Awaited<ReturnType<typeof compareImages>>,
  provenance: FigmaProvenance | undefined,
): void {
  if (!comparison.diffReport || !provenance) return;
  comparison.diffReport.issues = comparison.diffReport.issues.map((issue) => ({
    ...issue,
    evidence: {
      ...issue.evidence,
      figmaFileKey: issue.evidence.figmaFileKey ?? provenance.figmaFileKey,
      figmaNodeId: issue.evidence.figmaNodeId ?? provenance.figmaNodeId,
      figmaPageName: issue.evidence.figmaPageName ?? provenance.figmaPageName,
    },
  }));
}

// 自走ループの停止判定。履歴記録に失敗しても比較結果自体は返す。
async function evaluateLoopGuardSafely(
  input: Parameters<typeof recordIterationAndEvaluate>[0],
): Promise<LoopGuardReport | undefined> {
  try {
    return await recordIterationAndEvaluate(input);
  } catch (e: unknown) {
    console.warn("[compare_design] loop-guard failed:", e instanceof Error ? e.message : e);
    return undefined;
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 既存コードの複雑度であり本PRの変更対象外。別途リファクタで対応予定。
export async function runCompareDesign(
  args: CompareDesignRunArgs,
): Promise<CompareDesignRunOutput> {
  const parsedDesignSource = parseDesignInput(args.design_source);
  const effectiveThreshold = resolveThreshold(args.threshold, args.profile);

  // screenshot_url 撮影前に last-used ノードを解決し、フレームの実幅を capture_width に使えるようにする。
  const { fallbackNodeId, lastUsedNodeNote } =
    parsedDesignSource.type === "figma_url" && !parsedDesignSource.nodeId
      ? await resolveLastUsedFallback(args, parsedDesignSource.fileKey)
      : { fallbackNodeId: undefined, lastUsedNodeNote: undefined };

  // スクリーンショットの読み込み — 許可されたディレクトリ内にあることを検証する
  const screenshotPath = await resolveScreenshotPath(args, fallbackNodeId);
  const screenshotBuffer = await fs.readFile(screenshotPath);
  const screenshotBase64 = screenshotBuffer.toString("base64");
  let screenshotMeta: sharp.Metadata;
  try {
    screenshotMeta = await sharp(screenshotBuffer, {
      limitInputPixels: MAX_DECODE_PIXELS,
    }).metadata();
  } catch {
    throw new Error(
      `Failed to decode screenshot image (file may be corrupt or truncated): ${screenshotPath}`,
    );
  }
  // 巨大な縦長スクショは raw デコードでプロセスを OOM させる。
  // 比較前に天井を超える入力を明確なエラーで弾く。
  const screenshotPixelCount = (screenshotMeta.width ?? 0) * (screenshotMeta.height ?? 0);
  if (screenshotPixelCount > MAX_DECODE_PIXELS) {
    throw new Error(
      `Screenshot too large to compare safely: ${screenshotMeta.width}x${screenshotMeta.height} ` +
        `(${screenshotPixelCount} px exceeds the ${MAX_DECODE_PIXELS} px ceiling). ` +
        `Crop or downscale the screenshot before comparing.`,
    );
  }
  const targetWidth = screenshotMeta.width;

  const { designBase64, figmaRootNode, resolvedNodeId } = await resolveDesignAssets(
    parsedDesignSource,
    args.frame_name,
    targetWidth,
    screenshotMeta.height,
    fallbackNodeId,
  );

  const {
    cropRegion: manualCropRegion,
    cropUpdatedAt,
    ignoreRegions: projectIgnoreRegions,
  } = await resolveProjectRegions(
    args.project_id,
    args.frame_name ?? figmaRootNode?.name,
    args.ignore_regions,
  );
  const autoCropRegion = await resolveAutoCrop(
    manualCropRegion,
    figmaRootNode?.absoluteBoundingBox ?? undefined,
    screenshotMeta.width,
    screenshotMeta.height,
    screenshotBuffer,
  );
  const cropRegion = manualCropRegion ?? autoCropRegion;
  const ignoreRegions = [
    ...projectIgnoreRegions,
    ...buildSystemIgnoreRegionsForComparison(args, screenshotMeta, cropRegion),
  ];

  const comparison = await compareImages(
    {
      designBase64,
      screenshotBase64,
      threshold: effectiveThreshold,
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
  applyFigmaProvenance(comparison, figmaProvenance);

  // 確信度レイヤー: 設定ミスを検知・説明し、結果ヘッドラインを構造/色に分離する。
  const figmaFrameBox = figmaRootNode?.absoluteBoundingBox ?? undefined;
  const regionScores = comparison.diffReport?.regionScores ?? [];
  const preflightDimensions = resolvePreflightDimensions(
    cropRegion,
    comparison.normalization,
    screenshotMeta,
    figmaFrameBox,
  );
  const preflight = runPreflight({
    screenshotWidth: preflightDimensions.screenshotWidth,
    screenshotHeight: preflightDimensions.screenshotHeight,
    figmaFrameWidth: preflightDimensions.figmaFrameWidth,
    figmaFrameHeight: preflightDimensions.figmaFrameHeight,
    figmaLogicalFrameWidth: figmaFrameBox?.width,
    screenshotSource: args.capture_device
      ? "capture_device"
      : args.screenshot_url
        ? "screenshot_url"
        : "screenshot",
    cropRegion,
    cropUpdatedAt,
    figmaChildCount: figmaRootNode?.children?.length,
    figmaNodeType: figmaRootNode?.type,
  });

  // 診断は元の preflight 警告で行い、その後に表示用の拡張を加える。
  const comparisonHeadline = buildComparisonHeadline(regionScores, comparison.matchRate);
  const diagnosis = diagnoseComparison({
    matchRate: comparison.matchRate,
    regionScores,
    preflightWarnings: preflight.warnings,
    normalization: comparison.normalization,
  });

  // blank_frame 警告をフレーム候補付きに強化し、前回使用ノード info を先頭に追加する。
  const screenWidth = comparison.normalization?.screenshotWidth ?? screenshotMeta.width;
  const screenHeight = comparison.normalization?.screenshotHeight ?? screenshotMeta.height;
  let finalPreflightWarnings =
    parsedDesignSource.type === "figma_url"
      ? await enhanceBlankFrameWarning(
          preflight.warnings,
          parsedDesignSource.fileKey,
          screenWidth,
          screenHeight,
        )
      : preflight.warnings;

  if (lastUsedNodeNote) {
    const infoWarning: PreflightWarning = {
      code: "last_used_node",
      severity: "info",
      message: lastUsedNodeNote,
    };
    finalPreflightWarnings = [infoWarning, ...finalPreflightWarnings];
  }

  const finalPreflight = { warnings: finalPreflightWarnings };

  const regionCount = comparison.diffRegions.length;
  const targetNodeIds = buildTargetNodeIds(comparison.diffReport, comparison.diffRegions);
  const structuralReviewResult = resolveStructuralVerdict(
    comparison.diffReport,
    comparison.diffPixelCount,
  );
  const sourceKey = buildComparisonSourceKey(parsedDesignSource, resolvedNodeId);
  const priorReports = getRecentReports(sourceKey);
  const critique =
    comparison.diffReport && priorReports.length > 0
      ? selfCritique(comparison.diffReport, priorReports)
      : undefined;
  const perceptibleDiffRatio = comparison.diffReport?.perceptibleDiffRatio;
  const pixelsContradictPass = isPassContradictedByPixels(
    structuralReviewResult.verdict,
    perceptibleDiffRatio,
  );

  const status = buildStatus(
    structuralReviewResult.verdict,
    diagnosis.likelyMisconfig,
    perceptibleDiffRatio,
  );

  // 呼び出し側は nextAction に従うよう案内しているので、status が人間レビューを
  // 指しているのに nextAction が「完了を確認せよ」と言う状態を作らない。
  const diagnosisNextAction = diagnosis.likelyMisconfig
    ? buildMisconfigNextAction(diagnosis)
    : pixelsContradictPass
      ? buildPixelContradictionNextAction(perceptibleDiffRatio)
      : (buildDiagnosisNextAction(diagnosis) ??
        buildNextAction(structuralReviewResult.verdict, regionCount, targetNodeIds));
  const loopGuard = await evaluateLoopGuardSafely({
    sourceKey,
    comparisonId: comparison.comparisonId,
    matchRate: comparison.matchRate,
    diffPixelCount: comparison.diffPixelCount,
    regionCount,
    structuralVerdict: structuralReviewResult.verdict,
    status,
  });
  const persistDiffImageNeeded = shouldPersistDiffImage(
    status,
    structuralReviewResult.verdict,
    comparison.matchRate,
    comparison.diffPixelCount,
  );
  const result = CompareDesignResultSchema.parse({
    status,
    ...comparison,
    normalization: comparison.normalization
      ? { ...comparison.normalization, autoCropped: autoCropRegion !== undefined }
      : comparison.normalization,
    diffImagePath:
      comparison.diffImageBase64 && persistDiffImageNeeded
        ? await persistDiffImage(
            await redactImageBase64ForPublicExport(comparison.diffImageBase64, ignoreRegions),
            comparison.comparisonId,
          )
        : undefined,
    remainingIssues: regionCount,
    completionCriteria: buildCompletionCriteria(
      comparison.matchRate,
      comparison.diffPixelCount,
      regionCount,
      structuralReviewResult.verdict,
      structuralReviewResult.rationale,
      perceptibleDiffRatio,
    ),
    nextAction: diagnosisNextAction,
    suggestion: diagnosis.likelyMisconfig
      ? diagnosis.headline
      : pixelsContradictPass
        ? buildPixelContradictionSuggestion(perceptibleDiffRatio)
        : buildSuggestion(structuralReviewResult.verdict, comparison.matchRate, regionCount),
    critique,
    preflight: finalPreflight,
    comparisonHeadline,
    diagnosis,
    loopGuard,
  });

  await recordComparison({
    comparisonId: result.comparisonId,
    sourceKey,
    result,
  });

  // 成功後に使用ノードを記憶し、次回の自動補完に活かす。
  if (args.project_id && parsedDesignSource.type === "figma_url" && resolvedNodeId) {
    try {
      await setLastUsedNode(
        args.project_id,
        parsedDesignSource.fileKey,
        resolvedNodeId,
        figmaRootNode?.name,
      );
    } catch (e: unknown) {
      console.warn(
        "[compare_design] last-used node save failed:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  return {
    parsedDesignSource,
    result,
  };
}

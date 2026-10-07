/**
 * 複数フレーム/画面の一括比較。
 *
 * compare_design を画面数ぶん呼ぶと、呼び出し側が往復と集約を自前で抱えることになる。
 * ここは既存の比較経路を順番に1回ずつ呼び、フレームごとの判定と全体の集計だけを組む。
 * 比較の実体を差し替えられる形にしてあるので、画像もFigmaも通さずに検査できる。
 */

import { z } from "zod";

import {
  DiffIssueKindSchema,
  DiffRegionSchema,
  DiffSeveritySchema,
  LoopGuardReportSchema,
  VerdictRouteSchema,
  type DiffIssueKind,
  type DiffRegion,
  type DiffSeverity,
  type LoopGuardReport,
  type VerdictRoute,
} from "@figdiff/shared";

/**
 * 実行できなかったフレームを PASS/FAIL と混ぜないための4値目。
 * 比較が走っとらんのに PASS/FAIL を名乗ると、見ていない画面を合否として数えることになる。
 */
export const BatchFrameStatusSchema = z.enum(["PASS", "FAIL", "UNCERTAIN", "ERROR"]);
export type BatchFrameStatus = z.infer<typeof BatchFrameStatusSchema>;

/**
 * バッチ全体の収束判定。loopGuard はフレーム単位でしか出んため、
 * 「この一括比較を続けてよいか」を1箇所で答えられるようにまとめる。
 */
export const BatchConvergenceSchema = z.object({
  status: z.enum(["converged", "continue", "blocked", "unknown"]),
  message: z.string(),
  continuingLabels: z.array(z.string()),
  convergedLabels: z.array(z.string()),
  blockedLabels: z.array(z.string()),
  unevaluatedLabels: z.array(z.string()),
});
export type BatchConvergence = z.infer<typeof BatchConvergenceSchema>;

/**
 * 複数フレームに出た差分種別。同じ kind が N フレームで出たという事実だけを持ち、
 * 同一ノード・同一原因とは断定しない (ローカル画像や別ノード間では対応を証明できん)。
 */
export const BatchRecurringIssueSchema = z.object({
  kind: DiffIssueKindSchema,
  frameCount: z.number().int().min(2),
  frameLabels: z.array(z.string()),
  severities: z.array(DiffSeveritySchema),
});
export type BatchRecurringIssue = z.infer<typeof BatchRecurringIssueSchema>;

export const BatchFrameResultSchema = z.object({
  index: z.number().int().nonnegative(),
  label: z.string(),
  status: BatchFrameStatusSchema,
  // ERROR のときは数値そのものが無い。0 で埋めると「比較した結果 0%」と読める。
  matchRate: z.number().min(0).max(100).optional(),
  diffPixelCount: z.number().int().nonnegative().optional(),
  comparisonId: z.string().optional(),
  diffImagePath: z.string().optional(),
  verdictRoute: VerdictRouteSchema.optional(),
  loopGuard: LoopGuardReportSchema.optional(),
  remainingIssues: z.number().int().nonnegative().optional(),
  issueKinds: z.array(DiffIssueKindSchema).optional(),
  nextAction: z.string().optional(),
  // レスポンス肥大化を防ぐため上位のみ。全件は comparisonId から generate_diff_report で取れる。
  diffRegions: z.array(DiffRegionSchema),
  totalRegionCount: z.number().int().nonnegative().optional(),
  returnedRegionCount: z.number().int().nonnegative().optional(),
  regionsTruncated: z.boolean().optional(),
  error: z.string().optional(),
});
export type BatchFrameResult = z.infer<typeof BatchFrameResultSchema>;

export const CompareDesignBatchResultSchema = z.object({
  totalFrames: z.number().int().positive(),
  passCount: z.number().int().nonnegative(),
  failCount: z.number().int().nonnegative(),
  uncertainCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  verdict: BatchFrameStatusSchema,
  frames: z.array(BatchFrameResultSchema),
  comparisonIds: z.array(z.string()),
  recurringIssues: z.array(BatchRecurringIssueSchema),
  convergence: BatchConvergenceSchema,
});
export type CompareDesignBatchResult = z.infer<typeof CompareDesignBatchResultSchema>;

/** 1フレームぶんの比較要求。index は入力順、label は集計での表示名。 */
export interface BatchFrameRequest {
  index: number;
  label: string;
}

/** 1フレームぶんの比較結果。ERROR 以外は compare_design の結果から詰める。 */
export interface BatchFrameComparison {
  status: BatchFrameStatus;
  matchRate?: number;
  diffPixelCount?: number;
  comparisonId?: string;
  diffImagePath?: string;
  verdictRoute?: VerdictRoute;
  loopGuard?: LoopGuardReport;
  remainingIssues?: number;
  issues: readonly { kind: DiffIssueKind; severity: DiffSeverity }[];
  nextAction?: string;
  diffRegions: readonly DiffRegion[];
  error?: string;
}

/** 1フレームぶんの比較。設計側/実装側の解決は呼び出し側の既存経路に任せる。 */
export type CompareBatchFrame = (frame: BatchFrameRequest) => Promise<BatchFrameComparison>;

export interface BatchCompareOptions {
  maxInlineRegions?: number;
}

/** 1フレームあたりにインラインで返す差分領域の上限。 */
export const DEFAULT_MAX_INLINE_BATCH_REGIONS = 3;

interface EvaluatedFrame {
  request: BatchFrameRequest;
  comparison: BatchFrameComparison;
}

interface FrameCounts {
  pass: number;
  fail: number;
  uncertain: number;
  error: number;
}

const toErrorComparison = (error: unknown): BatchFrameComparison => ({
  status: "ERROR",
  issues: [],
  diffRegions: [],
  error: error instanceof Error ? error.message : String(error),
});

const selectInlineRegions = (
  regions: readonly DiffRegion[],
  maxInlineRegions: number,
): DiffRegion[] => {
  const sorted = [...regions].sort((a, b) => b.diffPixelCount - a.diffPixelCount);
  return maxInlineRegions >= sorted.length ? sorted : sorted.slice(0, maxInlineRegions);
};

const buildFrameResult = (
  { request, comparison }: EvaluatedFrame,
  maxInlineRegions: number,
): BatchFrameResult => {
  const inlineRegions = selectInlineRegions(comparison.diffRegions, maxInlineRegions);
  // 同じ kind が複数領域に出ても、フレーム単位では1つとして数える。
  // 領域数で重み付けすると、細かい色差が1件だけの画面が大きく出て誤読させる。
  const issueKinds = [...new Set(comparison.issues.map((issue) => issue.kind))];
  return {
    index: request.index,
    label: request.label,
    status: comparison.status,
    matchRate: comparison.matchRate,
    diffPixelCount: comparison.diffPixelCount,
    comparisonId: comparison.comparisonId,
    diffImagePath: comparison.diffImagePath,
    verdictRoute: comparison.verdictRoute,
    loopGuard: comparison.loopGuard,
    remainingIssues: comparison.remainingIssues,
    issueKinds: issueKinds.length > 0 ? issueKinds : undefined,
    nextAction: comparison.nextAction,
    diffRegions: inlineRegions,
    totalRegionCount: comparison.diffRegions.length,
    returnedRegionCount: inlineRegions.length,
    regionsTruncated: inlineRegions.length < comparison.diffRegions.length,
    error: comparison.error,
  };
};

const countStatuses = (frames: readonly BatchFrameResult[]): FrameCounts => ({
  pass: frames.filter((frame) => frame.status === "PASS").length,
  fail: frames.filter((frame) => frame.status === "FAIL").length,
  uncertain: frames.filter((frame) => frame.status === "UNCERTAIN").length,
  error: frames.filter((frame) => frame.status === "ERROR").length,
});

/**
 * 全体 verdict。
 * ERROR を最優先にする: 実行できとらんフレームがあるのに PASS/FAIL を名乗ると、
 * 見ていない画面まで合否に数えたことになる。
 * 次に FAIL: 確定した不一致が1つでもあれば、判定保留より先に直す対象がある。
 */
const resolveAggregateVerdict = (counts: FrameCounts): BatchFrameStatus => {
  if (counts.error > 0) return "ERROR";
  if (counts.fail > 0) return "FAIL";
  if (counts.uncertain > 0) return "UNCERTAIN";
  return "PASS";
};

const SEVERITY_ORDER: readonly DiffSeverity[] = ["critical", "major", "minor"];

const buildRecurringIssues = (evaluated: readonly EvaluatedFrame[]): BatchRecurringIssue[] => {
  const byKind = new Map<DiffIssueKind, { labels: string[]; severities: Set<DiffSeverity> }>();
  for (const { request, comparison } of evaluated) {
    for (const kind of new Set(comparison.issues.map((issue) => issue.kind))) {
      const entry = byKind.get(kind) ?? { labels: [], severities: new Set<DiffSeverity>() };
      entry.labels.push(request.label);
      byKind.set(kind, entry);
    }
    for (const issue of comparison.issues) {
      byKind.get(issue.kind)?.severities.add(issue.severity);
    }
  }
  return (
    [...byKind.entries()]
      // 1フレームだけの種別は「共通差分」ではない。2フレーム以上に出たものだけ返す。
      .filter(([, entry]) => entry.labels.length >= 2)
      .map(([kind, entry]) => ({
        kind,
        frameCount: entry.labels.length,
        frameLabels: entry.labels,
        severities: SEVERITY_ORDER.filter((severity) => entry.severities.has(severity)),
      }))
      .sort((a, b) => b.frameCount - a.frameCount || a.kind.localeCompare(b.kind))
  );
};

const buildConvergence = (evaluated: readonly EvaluatedFrame[]): BatchConvergence => {
  const continuingLabels: string[] = [];
  const convergedLabels: string[] = [];
  const blockedLabels: string[] = [];
  const unevaluatedLabels: string[] = [];

  for (const { request, comparison } of evaluated) {
    // 実行できとらんフレームは判定できない。収束したことにすると、
    // 比較していない画面を「完了」と読ませる。
    if (comparison.status === "ERROR") {
      unevaluatedLabels.push(request.label);
      continue;
    }
    const guard = comparison.loopGuard;
    // 停止判定が無い = 評価自体に失敗した。compare_design と同じく停止として扱い、人間へ回す。
    if (!guard) {
      unevaluatedLabels.push(request.label);
      continue;
    }
    if (!guard.stop) {
      continuingLabels.push(request.label);
      continue;
    }
    if (guard.reason === "no-regression") {
      convergedLabels.push(request.label);
      continue;
    }
    blockedLabels.push(request.label);
  }

  // 続行できるフレームが1つでもあるなら、作業はまだ終わらん。
  // 止まったフレームの理由はフレームごとの loopGuard に残っとるので、ここでは畳んで数える。
  const status: BatchConvergence["status"] =
    continuingLabels.length > 0
      ? "continue"
      : blockedLabels.length > 0 || unevaluatedLabels.length > 0
        ? "blocked"
        : convergedLabels.length > 0
          ? "converged"
          : "unknown";

  const message =
    status === "continue"
      ? `続行できるフレームが ${continuingLabels.length} 件ある。停止判定はフレーム単位なので、停止したフレームはその理由に従うこと。`
      : status === "blocked"
        ? `続行できるフレームはない。成功以外で停止したフレームが ${blockedLabels.length} 件、評価できないフレームが ${unevaluatedLabels.length} 件ある。自動修正を続けず人間に報告すること。`
        : status === "converged"
          ? `全 ${convergedLabels.length} フレームが収束した (PASS)。`
          : "停止判定を評価できたフレームがない。";

  return {
    status,
    message,
    continuingLabels,
    convergedLabels,
    blockedLabels,
    unevaluatedLabels,
  };
};

/**
 * フレームを入力順に1件ずつ比較し、判定と集計を返す。
 *
 * 並列にせん理由: sharp/pixelmatch は1件でも画素ぶんのメモリを抱える。
 * 同時に走らせると単発比較では出んピークになり、件数が増えるほど落ちやすくなる。
 * ここで畳みたいのは往復の回数であって、1件ずつの比較を速くする話ではない。
 */
export const runBatchCompare = async (
  frames: readonly BatchFrameRequest[],
  compareOne: CompareBatchFrame,
  options: BatchCompareOptions = {},
): Promise<CompareDesignBatchResult> => {
  if (frames.length === 0) {
    throw new Error("比較するフレームが1件もありません。frames に1件以上指定してください。");
  }
  const maxInlineRegions = options.maxInlineRegions ?? DEFAULT_MAX_INLINE_BATCH_REGIONS;
  const evaluated: EvaluatedFrame[] = [];
  for (const request of frames) {
    let comparison: BatchFrameComparison;
    try {
      comparison = await compareOne(request);
    } catch (error: unknown) {
      // 1件の失敗で残りを捨てん。失敗は失敗として残し、比較できたフレームは返す。
      comparison = toErrorComparison(error);
    }
    evaluated.push({ request, comparison });
  }

  const frameResults = evaluated.map((frame) => buildFrameResult(frame, maxInlineRegions));
  const counts = countStatuses(frameResults);
  return {
    totalFrames: frameResults.length,
    passCount: counts.pass,
    failCount: counts.fail,
    uncertainCount: counts.uncertain,
    errorCount: counts.error,
    verdict: resolveAggregateVerdict(counts),
    frames: frameResults,
    comparisonIds: frameResults.flatMap((frame) =>
      frame.comparisonId === undefined ? [] : [frame.comparisonId],
    ),
    recurringIssues: buildRecurringIssues(evaluated),
    convergence: buildConvergence(evaluated),
  };
};

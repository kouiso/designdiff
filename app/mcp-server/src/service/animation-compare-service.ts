/**
 * 時間で並んだフレーム列の比較。
 *
 * 静止画1枚では「その一瞬が合っているか」しか言えん。動きを確かめるには、
 * 複数の時刻で撮った絵を、それぞれ設計と突き合わせる必要がある。
 *
 * ここは並べる順番と合否のまとめ方だけを持つ。1枚ぶんの比較は既存の経路へ渡す。
 * 比較の実体を差し替えられる形にしてあるので、撮影もFigmaも通さずに検査できる。
 */

import {
  DEFAULT_DRIFT_FAIL_MS,
  DEFAULT_DRIFT_WINDOW_MS,
  type FrameAlignment,
  type FrameMismatch,
  type TemporalVerdict,
  aggregateTemporalVerdict,
  alignFrame,
  selectCandidates,
} from "@figdiff/shared";

export interface TimedImage {
  path: string;
  atMs: number;
}

export interface FrameComparison {
  atMs: number;
  screenshotPath: string;
  status: "PASS" | "FAIL" | "UNCERTAIN";
  matchRate: number;
  comparisonId: string;
  diffImagePath?: string;
}

/** 1枚ぶんの比較。設計側と実装側のパスを受け取り、判定を返す。 */
export type CompareOneFrame = (
  designSource: string,
  screenshotPath: string,
) => Promise<{
  status: "PASS" | "FAIL" | "UNCERTAIN";
  matchRate: number;
  comparisonId: string;
  diffImagePath?: string;
}>;

export interface AnimationCompareInput {
  /** 設計側。1枚だけの場合はここに置く。 */
  designSource: string;
  /** 設計側を時刻つきで複数渡す場合。渡すと時刻のズレまで測れる。 */
  designFrames?: TimedImage[];
  /** 実装側の各時刻の絵。 */
  implFrames: TimedImage[];
  driftWindowMs?: number;
  driftFailMs?: number;
  /**
   * 各フレームの時刻をどうやって合わせたか。
   * seek=動きを止めてその時刻へ巻き戻した / wall-clock=実時間で待った。
   * wall-clock では撮影にかかった時間ぶんの誤差が乗るので、
   * 測ったズレをそのまま実装の遅れとは言えん。
   */
  frameTimeSource?: "seek" | "wall-clock";
}

export interface AnimationCompareResult {
  frames: FrameComparison[];
  alignments: FrameAlignment[];
  temporal: TemporalVerdict;
  /** 時刻のズレを測ったかどうか。測っていない場合はその理由。 */
  driftMeasured: boolean;
  driftUnmeasuredReason?: string;
  evidencePaths: string[];
  frameTimeSource?: "seek" | "wall-clock";
}

/**
 * 実装側の各時刻を、1枚の設計と突き合わせる。
 *
 * 設計側が1枚しか無いときは、時刻の対応づけができん。どの時刻の絵も同じ設計と
 * 比べることになるので、「早い・遅い」を言う基準が存在せんため。
 */
async function compareEachFrame(
  designSource: string,
  implFrames: readonly TimedImage[],
  compareOne: CompareOneFrame,
): Promise<FrameComparison[]> {
  const frames: FrameComparison[] = [];
  for (const frame of implFrames) {
    const outcome = await compareOne(designSource, frame.path);
    frames.push({
      atMs: frame.atMs,
      screenshotPath: frame.path,
      status: outcome.status,
      matchRate: outcome.matchRate,
      comparisonId: outcome.comparisonId,
      diffImagePath: outcome.diffImagePath,
    });
  }
  return frames;
}

export async function runAnimationCompare(
  input: AnimationCompareInput,
  compareOne: CompareOneFrame,
): Promise<AnimationCompareResult> {
  if (input.implFrames.length === 0) {
    throw new Error("実装側のフレームが1枚もありません。");
  }

  const driftWindowMs = input.driftWindowMs ?? DEFAULT_DRIFT_WINDOW_MS;
  const driftFailMs = input.driftFailMs ?? DEFAULT_DRIFT_FAIL_MS;
  const designFrames = input.designFrames ?? [];

  if (designFrames.length === 0) {
    const frames = await compareEachFrame(input.designSource, input.implFrames, compareOne);
    // ここで aggregateTemporalVerdict を使わん。時刻のズレを測っとらんのに
    // 「ズレ 0ms」を返してしまい、測った結果と見分けが付かんようになるため。
    const statuses = frames.map((frame) => frame.status);
    const temporal: TemporalVerdict = {
      status: statuses.includes("FAIL")
        ? "FAIL"
        : statuses.includes("UNCERTAIN")
          ? "UNCERTAIN"
          : "PASS",
      rationale: statuses.includes("FAIL")
        ? "見た目が設計と違うフレームがある。"
        : statuses.includes("UNCERTAIN")
          ? "判定できんフレームがある。"
          : "全フレームの見た目が設計と一致しとる。時刻のズレは測っとらん。",
      maxAbsDriftMs: null,
      orderViolation: false,
    };
    return {
      frames,
      alignments: [],
      temporal,
      driftMeasured: false,
      frameTimeSource: input.frameTimeSource,
      driftUnmeasuredReason:
        "設計側が1枚だけなので、どの時刻の絵も同じ設計と比べることになる。早い・遅いを言う基準が無いため、時刻のズレは測っていない。design_frames に時刻つきの設計を複数渡すと測れる。",
      evidencePaths: frames.map((frame) => frame.screenshotPath),
    };
  }

  // 設計側が複数あるときは、設計の1枚ごとに、その時刻の前後にある実装側の絵を
  // 全部比べて、いちばん合う1枚を探す。その時刻の差が動きのズレになる。
  const frames: FrameComparison[] = [];
  const alignments: FrameAlignment[] = [];
  const comparedByPath = new Map<string, FrameComparison>();

  for (const designFrame of designFrames) {
    const candidates = selectCandidates(
      designFrame.atMs,
      input.implFrames.map((frame) => ({ atMs: frame.atMs, mismatchRate: 0 })),
      driftWindowMs,
    );
    const measured: FrameMismatch[] = [];
    for (const candidate of candidates) {
      const implFrame = input.implFrames.find((frame) => frame.atMs === candidate.atMs);
      if (implFrame === undefined) continue;
      const outcome = await compareOne(designFrame.path, implFrame.path);
      const comparison: FrameComparison = {
        atMs: implFrame.atMs,
        screenshotPath: implFrame.path,
        status: outcome.status,
        matchRate: outcome.matchRate,
        comparisonId: outcome.comparisonId,
        diffImagePath: outcome.diffImagePath,
      };
      measured.push({ atMs: implFrame.atMs, mismatchRate: 1 - outcome.matchRate });
      // 同じ実装の1枚が複数の設計時刻の候補になることがある。合否は、
      // いちばんよく合った設計時刻のものを残す。
      const previous = comparedByPath.get(implFrame.path);
      if (previous === undefined || comparison.matchRate > previous.matchRate) {
        comparedByPath.set(implFrame.path, comparison);
      }
    }
    alignments.push(alignFrame(designFrame.atMs, measured));
  }

  for (const comparison of comparedByPath.values()) frames.push(comparison);
  frames.sort((a, b) => a.atMs - b.atMs);

  const matchedStatuses = alignments
    .map((alignment) =>
      alignment.matchedAtMs === null
        ? undefined
        : frames.find((frame) => frame.atMs === alignment.matchedAtMs)?.status,
    )
    .filter((status): status is "PASS" | "FAIL" | "UNCERTAIN" => status !== undefined);

  const temporal = aggregateTemporalVerdict(alignments, matchedStatuses, driftFailMs);

  return {
    frames,
    alignments,
    temporal,
    driftMeasured: true,
    evidencePaths: frames.map((frame) => frame.screenshotPath),
    frameTimeSource: input.frameTimeSource,
  };
}

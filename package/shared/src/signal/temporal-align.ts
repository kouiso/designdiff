/**
 * 時間で並んだフレーム列どうしの突き合わせ。
 *
 * 静止画1枚の比較では「その一瞬が合っているか」しか言えん。動きを確かめるには、
 * 設計側の各時刻の絵が、実装側のどの時刻の絵と一番よく合うかを見る必要がある。
 * 合った時刻と本来の時刻の差が、動きの速さのズレになる。
 *
 * 画像を読む処理はここに置かん。残差の数値だけを受け取る純粋な計算にして、
 * 実際の撮影も比較も通さずに検査できる形にしてある。
 */

/** 設計側の1枚に対して、実装側のどの範囲まで見に行くか（ms）。 */
export const DEFAULT_DRIFT_WINDOW_MS = 500;

/**
 * ここを超えたズレは不合格にする（ms）。
 *
 * 60分の1秒で描く画面では1コマが約17ms。120ms はおよそ7コマぶんで、
 * 並べて見たときに人が「ワンテンポ遅い」と気づく境目に置いた。
 * 撮影そのものの誤差（数ms〜十数ms）よりは十分に大きい。
 */
export const DEFAULT_DRIFT_FAIL_MS = 120;

/** 1回の比較で扱えるフレームの上限。これを超えると比較の回数が現実的な時間で終わらん。 */
export const MAX_FRAMES = 12;

export interface FrameMismatch {
  /** 撮影した時刻（ms、読み込み完了を0とする）。 */
  atMs: number;
  /** その1枚が設計側とどれだけ違うか。0が完全一致。 */
  mismatchRate: number;
}

export interface FrameAlignment {
  /** 設計側の時刻（ms）。 */
  designAtMs: number;
  /** 一番よく合った実装側の時刻（ms）。範囲内に1枚も無ければ null。 */
  matchedAtMs: number | null;
  /** 合った時刻 − 設計側の時刻。正なら実装が遅れとる。 */
  driftMs: number | null;
  /** そのときの違いの量。 */
  mismatchRate: number | null;
  /** 対応づけできんかった理由。できた場合は付かん。 */
  reason?: string;
}

export interface TemporalVerdict {
  status: "PASS" | "FAIL" | "UNCERTAIN";
  /** 判定の理由。人が読む文。 */
  rationale: string;
  /** ズレの絶対値の最大（ms）。1つも対応づかんかったら null。 */
  maxAbsDriftMs: number | null;
  /** 時刻の前後が入れ替わっとるか。動きの緩急が崩れとる証拠になる。 */
  orderViolation: boolean;
}

/**
 * 撮影する時刻の並びを検査する。
 *
 * 同じ時刻を2回撮っても情報が増えず、逆順は「あとで撮った絵が先」という
 * 成立せん指示になる。ここで弾かんと、あとの対応づけが黙って狂う。
 */
export function parseFrameTimestamps(input: readonly number[]): number[] {
  if (input.length === 0) {
    throw new Error("撮影する時刻を1つ以上指定してください。");
  }
  if (input.length > MAX_FRAMES) {
    throw new Error(`撮影する時刻は${MAX_FRAMES}個までです（指定 ${input.length}個）。`);
  }
  const parsed: number[] = [];
  let previous = Number.NEGATIVE_INFINITY;
  for (const value of input) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`撮影する時刻は0以上の整数（ms）で指定してください: ${String(value)}`);
    }
    if (value <= previous) {
      throw new Error(`撮影する時刻は小さい順に並べてください: ${previous} のあとに ${value}`);
    }
    parsed.push(value);
    previous = value;
  }
  return parsed;
}

/** 設計側の1枚に対して、見に行く範囲に入る実装側の枚数を絞る。 */
export function selectCandidates(
  designAtMs: number,
  frames: readonly FrameMismatch[],
  windowMs: number = DEFAULT_DRIFT_WINDOW_MS,
): FrameMismatch[] {
  if (!Number.isFinite(windowMs) || windowMs < 0) {
    throw new Error(`見に行く範囲は0以上で指定してください: ${String(windowMs)}`);
  }
  return frames.filter((frame) => Math.abs(frame.atMs - designAtMs) <= windowMs);
}

/**
 * 設計側の1枚を、実装側の1枚へ対応づける。
 *
 * 違いの量が同じ枚が複数あるときは、時刻が近いほうを採る。近いほうを採らんと、
 * 何も変わっとらん画面（どの時刻も同じ絵）で、端の時刻が選ばれてズレが誇張される。
 */
export function alignFrame(
  designAtMs: number,
  candidates: readonly FrameMismatch[],
): FrameAlignment {
  if (candidates.length === 0) {
    return {
      designAtMs,
      matchedAtMs: null,
      driftMs: null,
      mismatchRate: null,
      reason: "この時刻の前後に、比べられる実装側の1枚が無い",
    };
  }

  let best = candidates[0];
  for (const candidate of candidates.slice(1)) {
    if (candidate.mismatchRate < best.mismatchRate) {
      best = candidate;
      continue;
    }
    if (candidate.mismatchRate === best.mismatchRate) {
      const bestDistance = Math.abs(best.atMs - designAtMs);
      const candidateDistance = Math.abs(candidate.atMs - designAtMs);
      if (candidateDistance < bestDistance) best = candidate;
    }
  }

  return {
    designAtMs,
    matchedAtMs: best.atMs,
    driftMs: best.atMs - designAtMs,
    mismatchRate: best.mismatchRate,
  };
}

/**
 * 対応づけた時刻の順番が入れ替わっとらんかを見る。
 *
 * 設計の順に並べたとき、対応づいた実装側の時刻が戻る箇所があれば、
 * 単純な遅れではなく動きの緩急そのものが崩れとる。
 */
export function detectOrderViolation(alignments: readonly FrameAlignment[]): boolean {
  let previous = Number.NEGATIVE_INFINITY;
  for (const alignment of alignments) {
    if (alignment.matchedAtMs === null) continue;
    if (alignment.matchedAtMs < previous) return true;
    previous = alignment.matchedAtMs;
  }
  return false;
}

/**
 * 1枚ごとの合否と時刻のズレから、動き全体の合否を出す。
 *
 * 1枚でも見た目が違えばそこで不合格。見た目が全部合っていても、出るのが早すぎたり
 * 遅すぎたりすれば動きとしては違う。対応づかん時刻が残る場合は、
 * 測れとらんので合格とは言わずに人へ回す。
 */
export function aggregateTemporalVerdict(
  alignments: readonly FrameAlignment[],
  frameStatuses: readonly ("PASS" | "FAIL" | "UNCERTAIN")[],
  driftFailMs: number = DEFAULT_DRIFT_FAIL_MS,
): TemporalVerdict {
  if (alignments.length === 0 || frameStatuses.length === 0) {
    return {
      status: "UNCERTAIN",
      rationale: "比べたフレームが1枚も無い。",
      maxAbsDriftMs: null,
      orderViolation: false,
    };
  }

  const drifts = alignments
    .map((alignment) => alignment.driftMs)
    .filter((drift): drift is number => drift !== null);
  const maxAbsDriftMs =
    drifts.length > 0 ? Math.max(...drifts.map((drift) => Math.abs(drift))) : null;
  const orderViolation = detectOrderViolation(alignments);
  const unmatched = alignments.length - drifts.length;

  if (frameStatuses.includes("FAIL")) {
    return {
      status: "FAIL",
      rationale: "見た目が設計と違うフレームがある。",
      maxAbsDriftMs,
      orderViolation,
    };
  }

  if (orderViolation) {
    return {
      status: "FAIL",
      rationale: "対応づいた時刻の前後が入れ替わっとる。動きの緩急が設計と違う。",
      maxAbsDriftMs,
      orderViolation,
    };
  }

  if (maxAbsDriftMs !== null && maxAbsDriftMs > driftFailMs) {
    return {
      status: "FAIL",
      rationale: `時刻のズレが最大 ${maxAbsDriftMs}ms で、許容 ${driftFailMs}ms を超えとる。`,
      maxAbsDriftMs,
      orderViolation,
    };
  }

  if (unmatched > 0) {
    return {
      status: "UNCERTAIN",
      rationale: `${unmatched}個の時刻に対応する実装側の1枚が見つからん。撮影する時刻を増やすか、範囲を広げて測り直す。`,
      maxAbsDriftMs,
      orderViolation,
    };
  }

  if (frameStatuses.includes("UNCERTAIN")) {
    return {
      status: "UNCERTAIN",
      rationale: "判定できんフレームがある。",
      maxAbsDriftMs,
      orderViolation,
    };
  }

  return {
    status: "PASS",
    rationale:
      maxAbsDriftMs === null
        ? "全フレームの見た目が設計と一致しとる。"
        : `全フレームの見た目が一致し、時刻のズレも最大 ${maxAbsDriftMs}ms に収まっとる。`,
    maxAbsDriftMs,
    orderViolation,
  };
}

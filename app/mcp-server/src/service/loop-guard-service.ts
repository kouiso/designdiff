import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { z } from "zod";

import type { DiffVerdict, LoopGuardReport } from "@figdiff/shared";

import { getFigdiffLoopStateDir } from "../util/figdiff-paths.js";

// 自走ループ (compare → fix → re-compare) の停止基準。
// AI が同じ比較対象に対して修正を繰り返すとき、
//   (a) 反復回数が上限に達した
//   (b) 直近の反復で matchRate が停滞している (収束停滞)
//   (c) PASS に到達した / UNCERTAIN で人間レビューが必要
// のいずれかで「これ以上の自動修正を止める」判定を返す。
// 状態は ~/.figdiff/loop-state/ に sourceKey 単位で永続化し、
// プロセスをまたいでも同一ループとして数えられるようにする。

export const MAX_LOOP_ITERATIONS = 5;
// matchRate の変化 (パーセントポイント) がこの値未満なら「進捗なし」とみなす。
export const STAGNATION_DELTA = 0.5;
// 見える差の割合 (0..1) の変化がこの値未満なら「進捗なし」とみなす。
// 0.005 = 全画素の 0.5% ぶん。matchRate の 0.5pt と同じ粒度に合わせている。
export const PERCEPTIBLE_STAGNATION_DELTA = 0.005;
// これより古い記録は別ループとみなして捨てる。
export const LOOP_STATE_TTL_MS = 2 * 60 * 60 * 1000;

export interface LoopIterationInput {
  sourceKey: string;
  comparisonId: string;
  matchRate: number;
  captureWidth?: number;
  captureHeight?: number;
  diffPixelCount?: number;
  regionCount?: number;
  /**
   * ΔE2000 で「人が見て違うと分かる」画素の割合 (0..1)。
   * matchRate は pixelmatch の閾値に引きずられ、文字の縁のぼかしだけで動く。
   * 停滞・悪化の判定を matchRate 単独に任せると、実際には何も直っていない編集を
   * 「進捗あり」と誤読して回り続ける。独立した知覚側の軸として併用する。
   */
  perceptibleDiffRatio?: number;
  structuralVerdict: DiffVerdict;
  status: "PASS" | "FAIL" | "UNCERTAIN";
}

const LoopStateEntrySchema = z.object({
  comparisonId: z.string(),
  matchRate: z.number(),
  captureWidth: z.number().optional(),
  captureHeight: z.number().optional(),
  diffPixelCount: z.number().optional(),
  regionCount: z.number().optional(),
  perceptibleDiffRatio: z.number().optional(),
  structuralVerdict: z.enum(["pass", "fail", "inconclusive"]),
  status: z.enum(["PASS", "FAIL", "UNCERTAIN"]),
  timestamp: z.number(),
});

type LoopStateEntry = z.infer<typeof LoopStateEntrySchema>;

export function getLoopStateDir(): string {
  return getFigdiffLoopStateDir();
}

function stateFilePath(sourceKey: string, stateDir: string): string {
  const hash = crypto.createHash("sha256").update(sourceKey).digest("hex").slice(0, 16);
  return path.join(stateDir, `${hash}.json`);
}

// Node のエラーは e.code を持つ。ENOENT (初回でファイル無し) は正常系。
function errorCode(e: unknown): string | undefined {
  if (typeof e === "object" && e !== null && "code" in e && typeof e.code === "string") {
    return e.code;
  }
  return undefined;
}

async function loadEntries(filePath: string): Promise<LoopStateEntry[]> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (e: unknown) {
    if (errorCode(e) !== "ENOENT") {
      console.warn(
        `[loop-guard] failed to read loop-state file: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return [];
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    console.warn("[loop-guard] loop-state file is not valid JSON (resetting)");
    return [];
  }
  if (!Array.isArray(json)) {
    console.warn("[loop-guard] loop-state file is not an array (resetting)");
    return [];
  }

  // 1件の破損エントリで履歴全体を捨てず、壊れたエントリだけ除外する。
  const entries: LoopStateEntry[] = [];
  for (const item of json) {
    const parsed = LoopStateEntrySchema.safeParse(item);
    if (parsed.success) {
      entries.push(parsed.data);
    } else {
      console.warn(`[loop-guard] dropping malformed loop-state entry: ${parsed.error.message}`);
    }
  }
  return entries;
}

export interface LoopGuardOptions {
  stateDir?: string;
  now?: number;
}

interface PerceptibleSeries {
  /** [2回前, 1回前, 今回] の見える差の割合 */
  values: [number, number, number];
  /** 今回 - 1回前。正なら悪化 */
  signed1: number;
  /** 1回前 - 2回前。正なら悪化 */
  signed2: number;
}

/** 3件すべてに見える差の記録があるときだけ、知覚側の系列として使う。 */
function readPerceptibleSeries(
  prev2: LoopStateEntry,
  prev1: LoopStateEntry,
  latest: LoopStateEntry,
): PerceptibleSeries | undefined {
  const a = prev2.perceptibleDiffRatio;
  const b = prev1.perceptibleDiffRatio;
  const c = latest.perceptibleDiffRatio;
  if (typeof a !== "number" || typeof b !== "number" || typeof c !== "number") return undefined;
  return { values: [a, b, c], signed1: c - b, signed2: b - a };
}

function formatRatio(ratio: number): string {
  return `${(ratio * 100).toFixed(2)}%`;
}

/**
 * 撮影条件が同じかどうかは幅だけで見る。
 *
 * ページ全体を撮ると高さは中身の量で決まるので、実装で1行足しただけでも変わる。
 * 高さを条件に入れると、実装を直すたびに履歴が捨てられて停止判定が働かない。
 */
function hasMatchingCaptureDimensions(entry: LoopStateEntry, input: LoopIterationInput): boolean {
  return typeof input.captureWidth === "number" && entry.captureWidth === input.captureWidth;
}

function comparablePriorEntries(
  entries: LoopStateEntry[],
  input: LoopIterationInput,
): LoopStateEntry[] {
  return entries.every((entry) => hasMatchingCaptureDimensions(entry, input)) ? entries : [];
}

/**
 * 今回の比較結果をループ履歴に記録し、続行/停止の判定を返す。
 * 判定優先順: PASS到達 > UNCERTAIN > 反復上限 > 収束停滞 > 続行。
 */
export async function recordIterationAndEvaluate(
  input: LoopIterationInput,
  options: LoopGuardOptions = {},
): Promise<LoopGuardReport> {
  const stateDir = options.stateDir ?? getLoopStateDir();
  const now = options.now ?? Date.now();
  await fs.mkdir(stateDir, { recursive: true });
  const filePath = stateFilePath(input.sourceKey, stateDir);

  const prior = (await loadEntries(filePath)).filter(
    (entry) => now - entry.timestamp < LOOP_STATE_TTL_MS,
  );
  // 撮影条件が違う結果を同じ改善系列に混ぜると、撮り直し自体を悪化と誤認する。
  const comparablePrior = comparablePriorEntries(prior, input);
  const entries: LoopStateEntry[] = [
    ...comparablePrior,
    {
      comparisonId: input.comparisonId,
      matchRate: input.matchRate,
      captureWidth: input.captureWidth,
      captureHeight: input.captureHeight,
      diffPixelCount: input.diffPixelCount,
      regionCount: input.regionCount,
      perceptibleDiffRatio: input.perceptibleDiffRatio,
      structuralVerdict: input.structuralVerdict,
      status: input.status,
      timestamp: now,
    },
  ];
  await fs.writeFile(filePath, JSON.stringify(entries, null, 2));

  const iteration = entries.length;

  if (input.status === "PASS") {
    // 完了したキャンペーンの履歴を持ち越さない。残すと次の修正キャンペーンが
    // 初回から反復済み扱いになり、上限/停滞判定が早発する。
    await resetLoopState(input.sourceKey, { stateDir });
    return {
      iteration,
      decision: "stop",
      reason: `PASS に到達しました (反復 ${iteration} 回)。ループを終了してください。`,
    };
  }

  if (input.status === "UNCERTAIN") {
    await resetLoopState(input.sourceKey, { stateDir });
    return {
      iteration,
      decision: "stop",
      reason:
        "判定が UNCERTAIN です。この比較は判定の確からしさを損なう条件を含むため、自動修正を止めて人間のレビューに回してください。",
    };
  }

  // 上限・停滞・悪化で止めたあとも履歴を残すと、人間が原因を直して再実行しても
  // TTL (2時間) のあいだ stop を返し続ける。sourceKey は Figma ファイル/ノードしか
  // 含まず実装側やキャンペーンを区別できないため、同じノードの独立した比較まで
  // 巻き添えになる。停止を一度返した時点でこのキャンペーンの役目は終わりなので破棄する。
  const stopAndReset = async (reason: string): Promise<LoopGuardReport> => {
    await resetLoopState(input.sourceKey, { stateDir });
    return { iteration, decision: "stop", reason };
  };

  if (iteration >= MAX_LOOP_ITERATIONS) {
    return await stopAndReset(
      `反復回数が上限 (${MAX_LOOP_ITERATIONS} 回) に達しました。これ以上の自動修正は止めて、現状と残差分を人間に報告してください。`,
    );
  }

  if (iteration >= 3) {
    const [prev2, prev1, latest] = entries.slice(-3);
    const hasComparableDiffMetrics = [prev2, prev1, latest].every(
      (entry) => typeof entry.diffPixelCount === "number" && typeof entry.regionCount === "number",
    );
    if (
      hasComparableDiffMetrics &&
      latest.matchRate === prev1.matchRate &&
      prev1.matchRate === prev2.matchRate &&
      latest.diffPixelCount === prev1.diffPixelCount &&
      prev1.diffPixelCount === prev2.diffPixelCount &&
      latest.regionCount === prev1.regionCount &&
      prev1.regionCount === prev2.regionCount
    ) {
      return await stopAndReset(
        "直近3回の比較結果（matchRate・diffPixelCount・差分領域数）が完全に同一です。提案された修正が実際には適用/反映されていない可能性が高いため、自動修正を止めて設定（capture_width / crop / node選択）を人間が確認してください。",
      );
    }

    // 悪化の検出を停滞より先に見る。停滞判定は絶対値なので、下がり続けていても
    // 変化量が閾値を超えていれば continue に落ちてしまい、悪化する編集を続けろと
    // 指示することになる。
    // 悪化と呼ぶには、停滞と見なす幅を超えて下がっている必要がある。閾値未満の
    // 下降は測定の揺れであり、これを悪化として止めると直せる修正まで捨てる。
    const signed1 = latest.matchRate - prev1.matchRate;
    const signed2 = prev1.matchRate - prev2.matchRate;
    if (signed1 <= -STAGNATION_DELTA && signed2 <= -STAGNATION_DELTA) {
      return await stopAndReset(
        `matchRate が2回続けて悪化しています (${prev2.matchRate.toFixed(2)} → ${prev1.matchRate.toFixed(2)} → ${latest.matchRate.toFixed(2)})。修正が逆効果になっているため、自動修正を止めて直前の変更を戻すか人間に報告してください。`,
      );
    }

    const perceptible = readPerceptibleSeries(prev2, prev1, latest);

    // 見える差が2回続けて増えている = 人の目で分かる劣化。matchRate が
    // 文字の縁のぼかしで揺れて悪化判定を逃れる場合でも、こちらで捕まえる。
    if (
      perceptible &&
      perceptible.signed1 >= PERCEPTIBLE_STAGNATION_DELTA &&
      perceptible.signed2 >= PERCEPTIBLE_STAGNATION_DELTA
    ) {
      return await stopAndReset(
        `人が見て分かる差が2回続けて増えています (${formatRatio(perceptible.values[0])} → ${formatRatio(perceptible.values[1])} → ${formatRatio(perceptible.values[2])})。修正が逆効果になっているため、自動修正を止めて直前の変更を戻すか人間に報告してください。`,
      );
    }

    const delta1 = Math.abs(signed1);
    const delta2 = Math.abs(signed2);
    const matchRateStagnant = delta1 < STAGNATION_DELTA && delta2 < STAGNATION_DELTA;

    // 停滞は matchRate 単独では決めない。matchRate はアンチエイリアスの揺れで
    // 動かないことがあり、その裏で見える差が確実に減っている場合がある。
    // そこで止めると、効いている修正を途中で捨てることになる。
    // 知覚側の軸が取れているときは、両方が動いていないことを停止の条件にする。
    if (matchRateStagnant) {
      if (perceptible === undefined) {
        return await stopAndReset(
          `収束が停滞しています (直近2回の matchRate 変化 ${delta2.toFixed(2)}pt → ${delta1.toFixed(2)}pt、いずれも ${STAGNATION_DELTA}pt 未満)。修正が効いていないため、自動修正を止めて人間に報告してください。`,
        );
      }
      const pDelta1 = Math.abs(perceptible.signed1);
      const pDelta2 = Math.abs(perceptible.signed2);
      if (pDelta1 < PERCEPTIBLE_STAGNATION_DELTA && pDelta2 < PERCEPTIBLE_STAGNATION_DELTA) {
        return await stopAndReset(
          `収束が停滞しています (matchRate の変化 ${delta2.toFixed(2)}pt → ${delta1.toFixed(2)}pt、人が見て分かる差の変化 ${formatRatio(pDelta2)} → ${formatRatio(pDelta1)}。どちらも動いていません)。修正が効いていないため、自動修正を止めて人間に報告してください。`,
        );
      }
      return {
        iteration,
        decision: "continue",
        reason: `反復 ${iteration}/${MAX_LOOP_ITERATIONS} 回。matchRate は止まっていますが、人が見て分かる差は ${formatRatio(perceptible.values[0])} → ${formatRatio(perceptible.values[2])} と動いています。修正は効いているので続行できます。`,
      };
    }
  }

  return {
    iteration,
    decision: "continue",
    reason: `反復 ${iteration}/${MAX_LOOP_ITERATIONS} 回。改善の余地があるため修正を続行できます。`,
  };
}

/** ループ履歴を破棄する (新しい修正キャンペーンを開始するとき用)。 */
export async function resetLoopState(
  sourceKey: string,
  options: Pick<LoopGuardOptions, "stateDir"> = {},
): Promise<void> {
  const stateDir = options.stateDir ?? getLoopStateDir();
  try {
    await fs.rm(stateFilePath(sourceKey, stateDir));
  } catch (e: unknown) {
    // 存在しない (ENOENT) のは正常系。それ以外は観測できるよう警告を残す。
    if (errorCode(e) !== "ENOENT") {
      console.warn(
        `[loop-guard] failed to reset loop-state: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}

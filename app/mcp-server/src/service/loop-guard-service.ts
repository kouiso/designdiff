import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";

import { z } from "zod";

import type { DiffVerdict, LoopGuardReport } from "@figdiff/shared";

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
// これより古い記録は別ループとみなして捨てる。
export const LOOP_STATE_TTL_MS = 2 * 60 * 60 * 1000;

export interface LoopIterationInput {
  sourceKey: string;
  comparisonId: string;
  matchRate: number;
  diffPixelCount?: number;
  regionCount?: number;
  structuralVerdict: DiffVerdict;
  status: "PASS" | "FAIL" | "UNCERTAIN";
}

const LoopStateEntrySchema = z.object({
  comparisonId: z.string(),
  matchRate: z.number(),
  diffPixelCount: z.number().optional(),
  regionCount: z.number().optional(),
  structuralVerdict: z.enum(["pass", "fail", "inconclusive"]),
  status: z.enum(["PASS", "FAIL", "UNCERTAIN"]),
  timestamp: z.number(),
});

type LoopStateEntry = z.infer<typeof LoopStateEntrySchema>;

export function getLoopStateDir(): string {
  return path.join(homedir(), ".figdiff", "loop-state");
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
  const entries: LoopStateEntry[] = [
    ...prior,
    {
      comparisonId: input.comparisonId,
      matchRate: input.matchRate,
      diffPixelCount: input.diffPixelCount,
      regionCount: input.regionCount,
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

  if (iteration >= MAX_LOOP_ITERATIONS) {
    return {
      iteration,
      decision: "stop",
      reason: `反復回数が上限 (${MAX_LOOP_ITERATIONS} 回) に達しました。これ以上の自動修正は止めて、現状と残差分を人間に報告してください。`,
    };
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
      return {
        iteration,
        decision: "stop",
        reason:
          "直近3回の比較結果（matchRate・diffPixelCount・差分領域数）が完全に同一です。提案された修正が実際には適用/反映されていない可能性が高いため、自動修正を止めて設定（capture_width / crop / node選択）を人間が確認してください。",
      };
    }

    const delta1 = Math.abs(latest.matchRate - prev1.matchRate);
    const delta2 = Math.abs(prev1.matchRate - prev2.matchRate);
    if (delta1 < STAGNATION_DELTA && delta2 < STAGNATION_DELTA) {
      return {
        iteration,
        decision: "stop",
        reason: `収束が停滞しています (直近2回の matchRate 変化 ${delta2.toFixed(2)}pt → ${delta1.toFixed(2)}pt、いずれも ${STAGNATION_DELTA}pt 未満)。修正が効いていないため、自動修正を止めて人間に報告してください。`,
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

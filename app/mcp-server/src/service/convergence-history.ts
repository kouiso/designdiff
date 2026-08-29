import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { ConvergenceHistorySchema } from "@figdiff/shared";
import type {
  ConvergenceCampaign,
  ConvergenceHistory,
  ConvergenceIteration,
  LoopGuardReport,
} from "@figdiff/shared";

import { getFigdiffConvergenceDir } from "../util/figdiff-paths.js";

// 1つの sourceKey につき残すキャンペーン数。振り返りに使う分だけあればよく、
// 無制限に貯めると読み込みが重くなる。
const MAX_CAMPAIGNS_PER_KEY = 5;
// 1キャンペーンの反復上限。ループガードの上限 (10) より少し余裕を持たせる。
const MAX_ITERATIONS_PER_CAMPAIGN = 20;
// 最後の反復からこれ以上空いたら、別のキャンペーンとして開き直す。
const CAMPAIGN_IDLE_MS = 2 * 60 * 60 * 1000;
// 残す比較対象の数。対象ごとに1ファイル増えるので、上限が無いと
// ~/.figdiff/convergence が使うほど増え続ける。
const MAX_SOURCE_KEYS = 50;

export interface ConvergenceRecordInput {
  sourceKey: string;
  designSource?: string;
  implementationUrl?: string;
  iteration: ConvergenceIteration;
  loopGuard?: LoopGuardReport;
  now?: number;
  campaignId?: string;
}

export const getConvergenceDir = (): string => getFigdiffConvergenceDir();

const historyFilePath = (sourceKey: string, dir: string): string => {
  const hash = crypto.createHash("sha256").update(sourceKey).digest("hex").slice(0, 16);
  return path.join(dir, `${hash}.json`);
};

const errorCode = (e: unknown): string | undefined => {
  if (typeof e === "object" && e !== null && "code" in e && typeof e.code === "string") {
    return e.code;
  }
  return undefined;
};

const loadHistory = async (filePath: string, sourceKey: string): Promise<ConvergenceHistory> => {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (e: unknown) {
    if (errorCode(e) !== "ENOENT") {
      console.warn(
        `[convergence] failed to read history: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return { sourceKey, campaigns: [] };
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    console.warn("[convergence] history file is not valid JSON (starting over)");
    return { sourceKey, campaigns: [] };
  }

  const parsed = ConvergenceHistorySchema.safeParse(json);
  if (!parsed.success) {
    console.warn(`[convergence] dropping malformed history: ${parsed.error.message}`);
    return { sourceKey, campaigns: [] };
  }
  return parsed.data;
};

const isOpen = (campaign: ConvergenceCampaign, now: number): boolean =>
  campaign.endedAt === undefined && now - campaign.updatedAt < CAMPAIGN_IDLE_MS;

/**
 * 反復を1件記録する。停止判定が来たキャンペーンはその場で閉じ、次の反復は
 * 新しいキャンペーンとして開く。記録に失敗しても比較そのものは成立するので、
 * 呼び出し側は例外を握って続行してよい。
 */
export const recordConvergenceIteration = async (
  input: ConvergenceRecordInput,
): Promise<ConvergenceCampaign> => {
  const dir = getConvergenceDir();
  await fs.mkdir(dir, { recursive: true });
  const filePath = historyFilePath(input.sourceKey, dir);
  // キャンペーンの時刻は反復の時刻に合わせる。別々の時計を混ぜると、
  // 「開始が最初の反復より後」のような読めん記録ができる。
  const now = input.now ?? input.iteration.timestamp;

  const history = await loadHistory(filePath, input.sourceKey);
  const last = history.campaigns.at(-1);
  const appendable = last !== undefined && isOpen(last, now);

  const campaign: ConvergenceCampaign = appendable
    ? {
        ...last,
        designSource: input.designSource ?? last.designSource,
        implementationUrl: input.implementationUrl ?? last.implementationUrl,
        updatedAt: now,
        iterations: [...last.iterations, input.iteration].slice(-MAX_ITERATIONS_PER_CAMPAIGN),
      }
    : {
        campaignId: input.campaignId ?? crypto.randomUUID(),
        sourceKey: input.sourceKey,
        designSource: input.designSource,
        implementationUrl: input.implementationUrl,
        startedAt: now,
        updatedAt: now,
        iterations: [input.iteration],
      };

  const closed: ConvergenceCampaign =
    input.loopGuard?.stop === true
      ? {
          ...campaign,
          endedAt: now,
          endReason: input.loopGuard.reason,
          endMessage: input.loopGuard.message,
        }
      : campaign;

  const campaigns = appendable
    ? [...history.campaigns.slice(0, -1), closed]
    : [...history.campaigns, closed];

  const next: ConvergenceHistory = {
    sourceKey: input.sourceKey,
    campaigns: campaigns.slice(-MAX_CAMPAIGNS_PER_KEY),
  };

  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(next, null, 2));
  await fs.rename(tmp, filePath);
  await pruneOldHistories(dir, filePath);
  return closed;
};

/**
 * 比較対象の数が上限を超えたら、古い順に捨てる。
 * 記録は振り返りのためのもので、全期間を保つ必要は無い。
 */
const pruneOldHistories = async (dir: string, keepPath: string): Promise<void> => {
  let names: string[];
  try {
    names = (await fs.readdir(dir)).filter((name) => name.endsWith(".json"));
  } catch {
    return;
  }
  if (names.length <= MAX_SOURCE_KEYS) return;

  const stamped: { filePath: string; modifiedAt: number }[] = [];
  for (const name of names) {
    const filePath = path.join(dir, name);
    if (filePath === keepPath) continue;
    try {
      const stat = await fs.stat(filePath);
      stamped.push({ filePath, modifiedAt: stat.mtimeMs });
    } catch {
      // 消えとるファイルは対象外。並行して別プロセスが片付けた場合に起きる。
    }
  }
  stamped.sort((a, b) => a.modifiedAt - b.modifiedAt);

  const removeCount = names.length - MAX_SOURCE_KEYS;
  for (const entry of stamped.slice(0, removeCount)) {
    await fs.rm(entry.filePath, { force: true });
  }
};

/** 1つの比較対象の履歴を読む。無ければ空の履歴を返す。 */
export const readConvergenceHistory = async (sourceKey: string): Promise<ConvergenceHistory> =>
  await loadHistory(historyFilePath(sourceKey, getConvergenceDir()), sourceKey);

/** 保存されている全比較対象の履歴を、最後に動いた順で返す。 */
export const listConvergenceHistories = async (): Promise<ConvergenceHistory[]> => {
  const dir = getConvergenceDir();
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (e: unknown) {
    if (errorCode(e) !== "ENOENT") {
      console.warn(
        `[convergence] failed to list history dir: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return [];
  }

  const histories: ConvergenceHistory[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const history = await loadHistory(path.join(dir, name), "");
    if (history.campaigns.length > 0) histories.push(history);
  }

  const lastTouched = (history: ConvergenceHistory): number =>
    history.campaigns.reduce((latest, campaign) => Math.max(latest, campaign.updatedAt), 0);
  return histories.sort((a, b) => lastTouched(b) - lastTouched(a));
};

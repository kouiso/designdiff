import { randomUUID } from "node:crypto";
import { chmodSync, existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { classifyIgnoreRegionEntries } from "../ignore-region-context.js";
import { IgnoreRegionConfigFileSchema } from "../schema.js";

import type {
  IgnoreRegion,
  IgnoreRegionConfigEntry,
  IgnoreRegionConfigFile,
  IgnoreRegionCoordinateContext,
} from "../type.js";
import type { z } from "zod";

const EMPTY_CONFIG: IgnoreRegionConfigFile = { version: 1, regions: [] };
const PROJECT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const LOCK_OWNER_FILE = "owner.json";
const SQLITE_BUSY = 5;
const MUTATION_LOCK_ATTEMPTS = 200;
const LEGACY_LOCK_GRACE_MS = 1_000;
const LOCAL_MUTATION_QUEUES = new Map<string, Promise<void>>();
export interface IgnoreRegionStoreOptions {
  getProjectDir(projectId: string): string;
  assertProjectExists(projectId: string): Promise<void>;
}
export interface IgnoreRegionStore {
  getIgnoreRegionPath(projectId: string): string;
  getIgnoreRegionConfig(projectId: string, frameName?: string): Promise<IgnoreRegionConfigEntry[]>;
  getIgnoreRegionConfigForComparison(
    projectId: string,
    frameName?: string,
  ): Promise<IgnoreRegionConfigEntry[]>;
  getIgnoreRegions(projectId: string, frameName?: string): Promise<IgnoreRegion[]>;
  getIgnoreRegionsForComparison(
    projectId: string,
    frameName?: string,
    context?: IgnoreRegionCoordinateContext,
  ): Promise<IgnoreRegion[]>;
  setIgnoreRegionConfig(
    projectId: string,
    regions: IgnoreRegionConfigEntry[],
  ): Promise<IgnoreRegionConfigFile>;
  deleteIgnoreRegion(projectId: string, regionId: string): Promise<IgnoreRegionConfigFile>;
}
function isEnoentError(error: unknown): error is Error & { code: string } {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function isSqliteBusy(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "ERR_SQLITE_ERROR" &&
    "errcode" in error &&
    error.errcode === SQLITE_BUSY
  );
}

function isWindowsBusyError(error: unknown): boolean {
  return hasErrorCode(error, "EPERM") || hasErrorCode(error, "EBUSY");
}

function emitSecondaryFailure(error: unknown): void {
  process.emitWarning(error instanceof Error ? error : String(error));
}

async function retryWindowsBusy(operation: () => Promise<void>): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await operation();
      return;
    } catch (error) {
      if (attempt >= 9 || !isWindowsBusyError(error)) throw error;
      await delay(25);
    }
  }
}

function isStoppedProcess(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return hasErrorCode(error, "ESRCH");
  }
}

async function removeLegacyLockDirectory(lockPath: string): Promise<boolean> {
  const quarantinePath = `${lockPath}.stale.${randomUUID()}`;
  try {
    await retryWindowsBusy(() => fs.rename(lockPath, quarantinePath));
  } catch (error) {
    if (isEnoentError(error)) return true;
    throw error;
  }
  await fs.rm(quarantinePath, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  return true;
}

async function recoverLegacyMutationLock(lockPath: string): Promise<boolean> {
  let lockMtimeMs: number;
  try {
    lockMtimeMs = (await fs.stat(lockPath)).mtimeMs;
  } catch (error) {
    if (isEnoentError(error)) return true;
    throw error;
  }
  const ownerPath = path.join(lockPath, LOCK_OWNER_FILE);
  try {
    const raw = await fs.readFile(ownerPath, "utf-8");
    const owner: unknown = JSON.parse(raw);
    const validOwner =
      typeof owner === "object" &&
      owner !== null &&
      "pid" in owner &&
      Number.isSafeInteger(owner.pid) &&
      Number(owner.pid) > 0;
    if (validOwner) {
      if (!isStoppedProcess(Number(owner.pid))) return false;
      return removeLegacyLockDirectory(lockPath);
    }
  } catch (error) {
    if (isEnoentError(error)) {
      if (Date.now() - lockMtimeMs < LEGACY_LOCK_GRACE_MS) return false;
      return removeLegacyLockDirectory(lockPath);
    }
    if (!(error instanceof SyntaxError)) throw error;
  }

  const ownerStat = await fs.stat(ownerPath);
  if (Date.now() - ownerStat.mtimeMs < LEGACY_LOCK_GRACE_MS) return false;
  return removeLegacyLockDirectory(lockPath);
}

async function beginMutationTransaction(databasePath: string): Promise<DatabaseSync> {
  await fs.mkdir(path.dirname(databasePath), { recursive: true });
  for (let attempt = 0; attempt < MUTATION_LOCK_ATTEMPTS; attempt += 1) {
    let database: DatabaseSync | undefined;
    try {
      database = new DatabaseSync(databasePath, { timeout: 0 });
      chmodSync(databasePath, 0o600);
      database.exec("BEGIN IMMEDIATE");
      return database;
    } catch (error) {
      if (database) {
        try {
          database.close();
        } catch (closeError) {
          // 元のSQLiteエラーを保ったまま、lockを保持し得るclose失敗も観測可能にする。
          emitSecondaryFailure(closeError);
        }
      }
      if (!isSqliteBusy(error)) throw error;
      if (attempt < MUTATION_LOCK_ATTEMPTS - 1) await delay(25);
    }
  }
  throw new Error(`Timed out waiting for ignore-region transaction: ${databasePath}`);
}

async function withLocalMutationQueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = LOCAL_MUTATION_QUEUES.get(key) ?? Promise.resolve();
  let release = (): void => undefined;
  const ownTurn = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => ownTurn);
  LOCAL_MUTATION_QUEUES.set(key, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (LOCAL_MUTATION_QUEUES.get(key) === queued) LOCAL_MUTATION_QUEUES.delete(key);
  }
}

async function withMutationTransaction<T>(
  yamlPath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const databasePath = `${yamlPath}.lock.sqlite`;
  return withLocalMutationQueue(databasePath, async () => {
    const database = await beginMutationTransaction(databasePath);
    try {
      // 旧版のdirectory lockはSQLite transactionの内側で一人だけ回収する。
      // 新版同士はSQLiteのOS lockを使うため、process crash時に自動解放される。
      for (let attempt = 0; attempt < MUTATION_LOCK_ATTEMPTS; attempt += 1) {
        if (await recoverLegacyMutationLock(`${yamlPath}.lock`)) break;
        if (attempt === MUTATION_LOCK_ATTEMPTS - 1) {
          throw new Error(`Timed out waiting for legacy ignore-region lock: ${yamlPath}.lock`);
        }
        await delay(25);
      }
      const result = await operation();
      database.exec("COMMIT");
      database.close();
      return result;
    } catch (error) {
      if (database.isTransaction) {
        try {
          database.exec("ROLLBACK");
        } catch (rollbackError) {
          // rollback失敗で保存処理の原因を隠さず、二次障害も捨てない。
          emitSecondaryFailure(rollbackError);
        }
      }
      try {
        database.close();
      } catch (closeError) {
        // close失敗で保存処理の原因を隠さず、二次障害も捨てない。
        emitSecondaryFailure(closeError);
      }
      throw error;
    }
  });
}

function summarizeZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "<root>"}: ${issue.message}`)
    .join("; ");
}
function parseConfig(raw: string, filePath: string, projectId: string): IgnoreRegionConfigFile {
  let value: unknown;
  try {
    value = parseYaml(raw);
  } catch (error) {
    throw new Error(
      `Invalid ignore-region YAML for project ${projectId} at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const parsed = IgnoreRegionConfigFileSchema.safeParse(value);
  if (!parsed.success)
    throw new Error(
      `Invalid ignore-region YAML for project ${projectId} at ${filePath}: ${summarizeZodIssues(parsed.error)}`,
    );
  return parsed.data;
}
export function normalizeFrameName(frameName: string): string {
  return frameName.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}
function matchesFrame(entry: IgnoreRegionConfigEntry, frameName?: string): boolean {
  return (
    !frameName ||
    entry.frame_name === undefined ||
    normalizeFrameName(entry.frame_name) === normalizeFrameName(frameName)
  );
}
function matchesComparisonFrame(entry: IgnoreRegionConfigEntry, frameName?: string): boolean {
  return frameName ? matchesFrame(entry, frameName) : entry.frame_name === undefined;
}
function toIgnoreRegion(entry: IgnoreRegionConfigEntry): IgnoreRegion {
  return { x: entry.x, y: entry.y, width: entry.width, height: entry.height, label: entry.label };
}

export function createIgnoreRegionStore(options: IgnoreRegionStoreOptions): IgnoreRegionStore {
  const getIgnoreRegionPath = (projectId: string): string => {
    if (!PROJECT_ID_PATTERN.test(projectId)) throw new Error(`Invalid project ID: ${projectId}`);
    return path.join(options.getProjectDir(projectId), "ignore-regions.yaml");
  };
  const readConfig = async (projectId: string): Promise<IgnoreRegionConfigFile> => {
    const filePath = getIgnoreRegionPath(projectId);
    try {
      return parseConfig(await fs.readFile(filePath, "utf-8"), filePath, projectId);
    } catch (error) {
      if (isEnoentError(error)) return EMPTY_CONFIG;
      throw error;
    }
  };
  const writeConfig = async (projectId: string, config: IgnoreRegionConfigFile): Promise<void> => {
    const filePath = getIgnoreRegionPath(projectId);
    const directoryPath = path.dirname(filePath);
    const tempPath = path.join(
      directoryPath,
      `.ignore-regions.yaml.${process.pid}.${randomUUID()}.tmp`,
    );
    const normalized = IgnoreRegionConfigFileSchema.parse(config);
    await fs.mkdir(directoryPath, { recursive: true });
    try {
      await fs.writeFile(tempPath, stringifyYaml(normalized), "utf-8");
      await fs.rename(tempPath, filePath);
    } catch (error) {
      await fs.rm(tempPath, { force: true });
      throw error;
    }
  };
  const getIgnoreRegionConfig = async (
    projectId: string,
    frameName?: string,
  ): Promise<IgnoreRegionConfigEntry[]> =>
    (await readConfig(projectId)).regions.filter((entry) => matchesFrame(entry, frameName));
  const getIgnoreRegionConfigForComparison = async (
    projectId: string,
    frameName?: string,
  ): Promise<IgnoreRegionConfigEntry[]> =>
    (await readConfig(projectId)).regions.filter((entry) =>
      matchesComparisonFrame(entry, frameName),
    );

  const withMutationLock = async <T>(projectId: string, mutate: () => Promise<T>): Promise<T> =>
    withMutationTransaction(getIgnoreRegionPath(projectId), mutate);
  return {
    getIgnoreRegionPath,
    getIgnoreRegionConfig,
    getIgnoreRegionConfigForComparison,
    async getIgnoreRegions(projectId, frameName) {
      return (await getIgnoreRegionConfig(projectId, frameName)).map(toIgnoreRegion);
    },
    async getIgnoreRegionsForComparison(projectId, frameName, context) {
      const scoped = await getIgnoreRegionConfigForComparison(projectId, frameName);
      return classifyIgnoreRegionEntries(scoped, context).applicable.map(toIgnoreRegion);
    },
    async setIgnoreRegionConfig(projectId, regions) {
      await options.assertProjectExists(projectId);
      return withMutationLock(projectId, async () => {
        const merged = new Map(
          (await readConfig(projectId)).regions.map((region) => [region.id, region]),
        );
        for (const region of regions) merged.set(region.id, region);
        const maskedArea = [...merged.values()].reduce(
          (sum, region) => sum + region.width * region.height,
          0,
        );
        const referenceArea = 1440 * 1024;
        if (maskedArea / referenceArea > 0.4) {
          console.error(
            `[ignore-region-store] Warning: total masked area is ${((maskedArea / referenceArea) * 100).toFixed(1)}% of reference frame. Review masks for coverage creep.`,
          );
        }
        const config = IgnoreRegionConfigFileSchema.parse({
          version: 1,
          regions: [...merged.values()],
        });
        await writeConfig(projectId, config);
        return config;
      });
    },
    async deleteIgnoreRegion(projectId, regionId) {
      if (!existsSync(getIgnoreRegionPath(projectId))) return EMPTY_CONFIG;
      return withMutationLock(projectId, async () => {
        const config = IgnoreRegionConfigFileSchema.parse({
          version: 1,
          regions: (await readConfig(projectId)).regions.filter((region) => region.id !== regionId),
        });
        await writeConfig(projectId, config);
        return config;
      });
    },
  };
}

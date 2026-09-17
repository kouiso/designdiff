import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as FsPromises from "node:fs/promises";

const sqliteMocks = vi.hoisted(() => ({
  close: vi.fn(),
  construct: vi.fn(),
  exec: vi.fn(),
}));

vi.mock("node:fs", () => ({ chmodSync: vi.fn() }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof FsPromises>();
  return {
    ...original,
    mkdir: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn(),
    rename: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
  };
});
vi.mock("node:sqlite", () => ({
  DatabaseSync: class {
    isTransaction = false;

    constructor() {
      sqliteMocks.construct();
    }

    exec(sql: string): void {
      sqliteMocks.exec(sql);
      if (sql === "BEGIN IMMEDIATE") this.isTransaction = true;
      if (sql === "COMMIT" || sql === "ROLLBACK") this.isTransaction = false;
    }

    close(): void {
      sqliteMocks.close();
    }
  },
}));

const mockFs = await import("node:fs/promises");
const { createIgnoreRegionStore } = await import("./ignore-region-store.js");

function makeError(message: string, properties: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(message), properties);
}

function createStore() {
  return createIgnoreRegionStore({
    getProjectDir: () => "/virtual/project",
    assertProjectExists: async () => undefined,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(mockFs.mkdir).mockResolvedValue(undefined);
  vi.mocked(mockFs.readFile).mockRejectedValue(makeError("missing", { code: "ENOENT" }));
  vi.mocked(mockFs.rename).mockResolvedValue(undefined);
  vi.mocked(mockFs.rm).mockResolvedValue(undefined);
  vi.mocked(mockFs.writeFile).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ignore region SQLite transaction errors", () => {
  it("retries when opening the SQLite sidecar reports busy", async () => {
    sqliteMocks.construct.mockImplementationOnce(() => {
      throw makeError("busy", { code: "ERR_SQLITE_ERROR", errcode: 5 });
    });

    await expect(
      createStore().setIgnoreRegionConfig("project-1", [
        { id: "after-open-busy", x: 0, y: 0, width: 1, height: 1 },
      ]),
    ).resolves.toMatchObject({
      regions: [expect.objectContaining({ id: "after-open-busy" })],
    });
    expect(sqliteMocks.construct).toHaveBeenCalledTimes(2);
  });

  it("keeps the mutation error when rollback and close also fail", async () => {
    const mutationError = makeError("disk full");
    const rollbackError = makeError("rollback failed");
    const closeError = makeError("close failed");
    vi.mocked(mockFs.writeFile).mockRejectedValueOnce(mutationError);
    sqliteMocks.exec.mockImplementation((sql: string) => {
      if (sql === "ROLLBACK") throw rollbackError;
    });
    sqliteMocks.close.mockImplementationOnce(() => {
      throw closeError;
    });
    const emitWarning = vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);

    const rejection = await createStore()
      .setIgnoreRegionConfig("project-1", [
        { id: "write-failure", x: 0, y: 0, width: 1, height: 1 },
      ])
      .catch((error: unknown) => error);

    expect(rejection).toBe(mutationError);
    expect(emitWarning).toHaveBeenCalledWith(rollbackError);
    expect(emitWarning).toHaveBeenCalledWith(closeError);
  });
});

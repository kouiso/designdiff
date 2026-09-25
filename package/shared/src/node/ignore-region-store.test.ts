import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

import { createIgnoreRegionStore } from "./ignore-region-store.js";

import type * as FsPromises from "node:fs/promises";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof FsPromises>();
  return { ...original, rename: vi.fn(original.rename) };
});

const cleanupPaths: string[] = [];

const createStore = (projectDir: string) =>
  createIgnoreRegionStore({
    getProjectDir: () => projectDir,
    assertProjectExists: async () => undefined,
  });

async function waitForChildReady(child: ReturnType<typeof spawn>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    child.once("message", () => resolve());
    child.once("error", reject);
  });
}

afterEach(async () => {
  const original = await vi.importActual<typeof FsPromises>("node:fs/promises");
  vi.mocked(rename).mockReset().mockImplementation(original.rename);
  await Promise.all(
    cleanupPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })),
  );
});

describe("ignore region store mutations", () => {
  it("serializes concurrent upserts so both ids remain", async () => {
    const root = await mkdtemp(join(tmpdir(), "figdiff-ignore-store-"));
    cleanupPaths.push(root);
    const projectDir = join(root, "project-1");
    await mkdir(projectDir);
    const store = createStore(projectDir);

    await Promise.all([
      store.setIgnoreRegionConfig("project-1", [{ id: "first", x: 0, y: 0, width: 1, height: 1 }]),
      store.setIgnoreRegionConfig("project-1", [{ id: "second", x: 1, y: 1, width: 1, height: 1 }]),
    ]);

    const saved = parse(await readFile(join(projectDir, "ignore-regions.yaml"), "utf-8"));
    expect(saved.regions.map((entry: { id: string }) => entry.id).sort()).toEqual([
      "first",
      "second",
    ]);
    const databaseMode = (await stat(join(projectDir, "ignore-regions.yaml.lock.sqlite"))).mode;
    if (process.platform !== "win32") expect(databaseMode & 0o777).toBe(0o600);
  });

  it.each([
    undefined,
    "EPERM",
    "EBUSY",
    "persistent EPERM",
  ])("recovers a killed legacy owner after %s", async (code) => {
    const root = await mkdtemp(join(tmpdir(), "figdiff-ignore-store-"));
    cleanupPaths.push(root);
    const projectDir = join(root, "project-1");
    const lockPath = join(projectDir, "ignore-regions.yaml.lock");
    await mkdir(projectDir);
    const child = spawn(
      process.execPath,
      [
        "-e",
        `const fs=require("node:fs");const p=process.argv[1];fs.mkdirSync(p);fs.writeFileSync(p+"/owner.json",JSON.stringify({pid:process.pid,token:"killed"}));process.send("ready");setInterval(()=>{},1000);`,
        lockPath,
      ],
      { stdio: ["ignore", "ignore", "ignore", "ipc"] },
    );
    await waitForChildReady(child);
    child.kill("SIGKILL");
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));

    const store = createStore(projectDir);
    if (code === "persistent EPERM") {
      vi.mocked(rename).mockRejectedValue(
        Object.assign(new Error("still busy"), { code: "EPERM" }),
      );
      await expect(
        store.setIgnoreRegionConfig("project-1", [
          { id: "rejected", x: 0, y: 0, width: 1, height: 1 },
        ]),
      ).rejects.toMatchObject({ code: "EPERM" });
      expect(vi.mocked(rename)).toHaveBeenCalledTimes(10);
      const original = await vi.importActual<typeof FsPromises>("node:fs/promises");
      vi.mocked(rename).mockReset().mockImplementation(original.rename);
    } else if (code) {
      vi.mocked(rename).mockRejectedValueOnce(
        Object.assign(new Error("temporarily busy"), { code }),
      );
    }

    await Promise.all([
      store.setIgnoreRegionConfig("project-1", [
        { id: "after-crash-a", x: 0, y: 0, width: 1, height: 1 },
      ]),
      store.setIgnoreRegionConfig("project-1", [
        { id: "after-crash-b", x: 1, y: 1, width: 1, height: 1 },
      ]),
    ]);
    await expect(store.getIgnoreRegionConfig("project-1")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "after-crash-a" }),
        expect.objectContaining({ id: "after-crash-b" }),
      ]),
    );
  });

  it("recovers an incomplete legacy lock after its grace period", async () => {
    const root = await mkdtemp(join(tmpdir(), "figdiff-ignore-store-"));
    cleanupPaths.push(root);
    const projectDir = join(root, "project-1");
    const lockPath = join(projectDir, "ignore-regions.yaml.lock");
    await mkdir(lockPath, { recursive: true });
    const staleAt = new Date(Date.now() - 2_000);
    await utimes(lockPath, staleAt, staleAt);

    await expect(
      createStore(projectDir).setIgnoreRegionConfig("project-1", [
        { id: "after-incomplete-lock", x: 0, y: 0, width: 1, height: 1 },
      ]),
    ).resolves.toMatchObject({
      regions: [expect.objectContaining({ id: "after-incomplete-lock" })],
    });
    await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    "{broken",
    JSON.stringify({ token: "missing-pid" }),
  ])("recovers stale legacy owner metadata: %s", async (ownerJson) => {
    const root = await mkdtemp(join(tmpdir(), "figdiff-ignore-store-"));
    cleanupPaths.push(root);
    const projectDir = join(root, "project-1");
    const lockPath = join(projectDir, "ignore-regions.yaml.lock");
    const ownerPath = join(lockPath, "owner.json");
    await mkdir(lockPath, { recursive: true });
    await writeFile(ownerPath, ownerJson, "utf-8");
    const staleAt = new Date(Date.now() - 2_000);
    await utimes(ownerPath, staleAt, staleAt);

    await expect(
      createStore(projectDir).setIgnoreRegionConfig("project-1", [
        { id: "after-invalid-owner", x: 0, y: 0, width: 1, height: 1 },
      ]),
    ).resolves.toMatchObject({
      regions: [expect.objectContaining({ id: "after-invalid-owner" })],
    });
    await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("continues after a process dies while holding the SQLite transaction", async () => {
    const root = await mkdtemp(join(tmpdir(), "figdiff-ignore-store-"));
    cleanupPaths.push(root);
    const projectDir = join(root, "project-1");
    await mkdir(projectDir);
    const databasePath = join(projectDir, "ignore-regions.yaml.lock.sqlite");
    const child = spawn(
      process.execPath,
      [
        "-e",
        `const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(process.argv[1]);db.exec("BEGIN IMMEDIATE");process.send("ready");setInterval(()=>{},1000);`,
        databasePath,
      ],
      { stdio: ["ignore", "ignore", "ignore", "ipc"] },
    );
    await waitForChildReady(child);
    child.kill("SIGKILL");
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));

    await expect(
      createStore(projectDir).setIgnoreRegionConfig("project-1", [
        { id: "after-sqlite-crash", x: 0, y: 0, width: 1, height: 1 },
      ]),
    ).resolves.toMatchObject({
      regions: [expect.objectContaining({ id: "after-sqlite-crash" })],
    });
  });

  it("waits for a live process to release the SQLite transaction", async () => {
    const root = await mkdtemp(join(tmpdir(), "figdiff-ignore-store-"));
    cleanupPaths.push(root);
    const projectDir = join(root, "project-1");
    await mkdir(projectDir);
    const databasePath = join(projectDir, "ignore-regions.yaml.lock.sqlite");
    const child = spawn(
      process.execPath,
      [
        "-e",
        `const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(process.argv[1]);db.exec("BEGIN IMMEDIATE");process.send("ready");setTimeout(()=>{db.exec("ROLLBACK");db.close();},150);`,
        databasePath,
      ],
      { stdio: ["ignore", "ignore", "ignore", "ipc"] },
    );
    const childExit = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    await waitForChildReady(child);

    await expect(
      createStore(projectDir).setIgnoreRegionConfig("project-1", [
        { id: "after-sqlite-release", x: 0, y: 0, width: 1, height: 1 },
      ]),
    ).resolves.toMatchObject({
      regions: [expect.objectContaining({ id: "after-sqlite-release" })],
    });
    await childExit;
  });
});

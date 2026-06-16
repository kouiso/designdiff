import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as NodeOs from "node:os";

const TMP_DIR = path.join(tmpdir(), `figdiff-fbtest-${process.pid}`);
const TMP_CRED_PATH = path.join(TMP_DIR, ".figdiff", "credentials.json");

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof NodeOs>("node:os");
  return {
    ...actual,
    homedir: () => TMP_DIR,
  };
});

const { createFileBackend } = await import("./file-backend.js");

describe("FileBackend", () => {
  beforeEach(() => {
    mkdirSync(TMP_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TMP_DIR)) {
      rmSync(TMP_DIR, { recursive: true, force: true });
    }
  });

  it("returns null for missing account", () => {
    const backend = createFileBackend();
    expect(backend.get("nonexistent")).toBeNull();
  });

  it("sets and gets a value", () => {
    const backend = createFileBackend();
    backend.set("figma-pat", "figd_test_token_123");
    expect(backend.get("figma-pat")).toBe("figd_test_token_123");
  });

  it("deletes a value", () => {
    const backend = createFileBackend();
    backend.set("figma-pat", "figd_test");
    backend.delete("figma-pat");
    expect(backend.get("figma-pat")).toBeNull();
  });

  it("handles multiple accounts", () => {
    const backend = createFileBackend();
    backend.set("account-a", "value-a");
    backend.set("account-b", "value-b");
    expect(backend.get("account-a")).toBe("value-a");
    expect(backend.get("account-b")).toBe("value-b");
  });

  it("deletes only the specified account", () => {
    const backend = createFileBackend();
    backend.set("account-a", "value-a");
    backend.set("account-b", "value-b");
    backend.delete("account-a");
    expect(backend.get("account-a")).toBeNull();
    expect(backend.get("account-b")).toBe("value-b");
  });

  it("removes credentials.json when last entry deleted", () => {
    const backend = createFileBackend();
    backend.set("figma-pat", "token");
    backend.delete("figma-pat");
    expect(existsSync(TMP_CRED_PATH)).toBe(false);
  });

  it("no-ops delete on nonexistent account", () => {
    const backend = createFileBackend();
    expect(() => backend.delete("nonexistent")).not.toThrow();
  });
});

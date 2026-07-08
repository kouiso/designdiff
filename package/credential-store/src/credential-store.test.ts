import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as NodeOs from "node:os";

const TMP_DIR = path.join(tmpdir(), `figdiff-cstest-${process.pid}`);

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof NodeOs>("node:os");
  return {
    ...actual,
    homedir: () => TMP_DIR,
  };
});

describe("getCredential — keychain-unavailable-data fallback", () => {
  beforeEach(() => {
    mkdirSync(TMP_DIR, { recursive: true });
    vi.resetModules();
  });

  afterEach(() => {
    if (existsSync(TMP_DIR)) {
      rmSync(TMP_DIR, { recursive: true, force: true });
    }
  });

  it("keychain backendがgetでnullを返した時、file backendの既存クレデンシャルへ read-only フォールバックする", async () => {
    // keychain probe は「利用可能」と判定されるが、該当エントリが無い
    // (probeKeychainAvailability は機構が動くかだけを見て、データの
    // 有無は見ないため実際に起こりうる状態)。
    vi.doMock("./keychain-backend.js", () => ({
      probeKeychainAvailability: () => true,
      createKeychainBackend: () => ({
        type: "keychain" as const,
        get: () => null,
        set: () => {
          throw new Error("not expected to be called in this test");
        },
        delete: () => {
          throw new Error("not expected to be called in this test");
        },
      }),
    }));

    const { createFileBackend } = await import("./file-backend.js");
    createFileBackend().set("figma-pat", "figd_from_file_backend");

    const { getCredential } = await import("./credential-store.js");
    expect(getCredential("figma-pat")).toBe("figd_from_file_backend");
  });

  it("keychainにもfileにも無ければnullを返す (フォールバックが偽陽性を作らない)", async () => {
    vi.doMock("./keychain-backend.js", () => ({
      probeKeychainAvailability: () => true,
      createKeychainBackend: () => ({
        type: "keychain" as const,
        get: () => null,
        set: () => {
          throw new Error("not expected to be called in this test");
        },
        delete: () => {
          throw new Error("not expected to be called in this test");
        },
      }),
    }));

    const { getCredential } = await import("./credential-store.js");
    expect(getCredential("figma-pat")).toBeNull();
  });

  it("keychainにデータがあればfile backendへは見に行かない (keychain値を優先)", async () => {
    vi.doMock("./keychain-backend.js", () => ({
      probeKeychainAvailability: () => true,
      createKeychainBackend: () => ({
        type: "keychain" as const,
        get: (account: string) => (account === "figma-pat" ? "figd_from_keychain" : null),
        set: () => {
          throw new Error("not expected to be called in this test");
        },
        delete: () => {
          throw new Error("not expected to be called in this test");
        },
      }),
    }));

    const { createFileBackend } = await import("./file-backend.js");
    createFileBackend().set("figma-pat", "figd_from_file_backend");

    const { getCredential } = await import("./credential-store.js");
    expect(getCredential("figma-pat")).toBe("figd_from_keychain");
  });
});

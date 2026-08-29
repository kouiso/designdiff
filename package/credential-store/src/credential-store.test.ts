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

  it("deleteCredentialはkeychain選択時にfile backendからも削除する (削除後にフォールバックで復活しない)", async () => {
    vi.doMock("./keychain-backend.js", () => ({
      probeKeychainAvailability: () => true,
      createKeychainBackend: () => ({
        type: "keychain" as const,
        get: () => null,
        set: () => {
          throw new Error("not expected to be called in this test");
        },
        delete: () => {
          // keychain側の削除自体は成功しているものとして扱う
        },
      }),
    }));

    const { createFileBackend } = await import("./file-backend.js");
    createFileBackend().set("figma-pat", "figd_from_file_backend");

    const { getCredential, deleteCredential } = await import("./credential-store.js");
    expect(getCredential("figma-pat")).toBe("figd_from_file_backend");

    deleteCredential("figma-pat");

    expect(getCredential("figma-pat")).toBeNull();
  });
});

// desktop は OS keychain へ、MCP は file backend へ。読む方向が片側だけやと
// 「デスクトップでログインしたのに MCP からは未ログイン」の袋小路になる。
describe("getCredential — file backend から keychain への read-only フォールバック", () => {
  beforeEach(() => {
    mkdirSync(TMP_DIR, { recursive: true });
    vi.resetModules();
    delete process.env.FIGDIFF_DISABLE_KEYCHAIN_READ;
  });

  afterEach(() => {
    if (existsSync(TMP_DIR)) {
      rmSync(TMP_DIR, { recursive: true, force: true });
    }
    delete process.env.FIGDIFF_DISABLE_KEYCHAIN_READ;
  });

  const mockKeychain = (stored: Map<string, string>, calls: string[] = []) => {
    vi.doMock("./keychain-backend.js", () => ({
      probeKeychainAvailability: () => {
        calls.push("probe");
        return true;
      },
      createKeychainBackend: () => ({
        type: "keychain" as const,
        get: (account: string) => {
          calls.push(`get:${account}`);
          return stored.get(account) ?? null;
        },
        set: () => {
          throw new Error("set must not be called on the read-only fallback");
        },
        delete: (account: string) => {
          calls.push(`delete:${account}`);
          stored.delete(account);
        },
      }),
    }));
  };

  it("file backend に無いトークンを keychain から読む", async () => {
    mockKeychain(new Map([["figma-pat", "from-desktop"]]));
    const api = await import("./credential-store.js");
    api.selectFileCredentialBackend();

    expect(api.getCredential("figma-pat")).toBe("from-desktop");
  });

  // 書き込みを伴う probe を踏むと、対話でけん MCP が固まる余地ができる。
  it("フォールバックでは probe を踏まん", async () => {
    const calls: string[] = [];
    mockKeychain(new Map([["figma-pat", "from-desktop"]]), calls);
    const api = await import("./credential-store.js");
    api.selectFileCredentialBackend();
    api.getCredential("figma-pat");

    expect(calls).not.toContain("probe");
  });

  it("FIGDIFF_DISABLE_KEYCHAIN_READ=1 なら keychain へ触らん", async () => {
    process.env.FIGDIFF_DISABLE_KEYCHAIN_READ = "1";
    const calls: string[] = [];
    mockKeychain(new Map([["figma-pat", "from-desktop"]]), calls);
    const api = await import("./credential-store.js");
    api.selectFileCredentialBackend();

    expect(api.getCredential("figma-pat")).toBeNull();
    expect(calls).toEqual([]);
  });

  // 消す側を揃えんと、削除したトークンが次の get で復活する。
  it("file backend からの削除は keychain 側も消す", async () => {
    const stored = new Map([["figma-pat", "from-desktop"]]);
    mockKeychain(stored);
    const api = await import("./credential-store.js");
    api.selectFileCredentialBackend();

    api.deleteCredential("figma-pat");
    expect(api.getCredential("figma-pat")).toBeNull();
    expect(stored.has("figma-pat")).toBe(false);
  });
});

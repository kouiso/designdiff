import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as NodeOs from "node:os";

const TMP_DIR = path.join(tmpdir(), `figdiff-indextest-${process.pid}`);

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof NodeOs>("node:os");
  return {
    ...actual,
    homedir: () => TMP_DIR,
  };
});

// 実物の Entry は開発者本人の OS キーチェーンへ書き込むため使わない。
vi.mock("@napi-rs/keyring", () => ({
  Entry: class {
    setPassword(): void {
      throw new Error("keychain should not be used in tests");
    }
    getPassword(): string | null {
      throw new Error("keychain should not be used in tests");
    }
    deletePassword(): void {
      throw new Error("keychain should not be used in tests");
    }
  },
}));

const api = await import("./index.js");

describe("index barrel", () => {
  beforeEach(() => {
    mkdirSync(TMP_DIR, { recursive: true });
    api.selectFileCredentialBackend();
  });

  afterEach(() => {
    if (existsSync(TMP_DIR)) {
      rmSync(TMP_DIR, { recursive: true, force: true });
    }
  });

  it("公開APIが全て再エクスポートされている", () => {
    const expected = [
      "ACCOUNTS",
      "FigmaRefreshError",
      "credentialStoreInfo",
      "deleteCredential",
      "deleteOAuthClientCredentials",
      "deleteOAuthTokens",
      "deletePat",
      "getCredential",
      "getOAuthClientCredentials",
      "getOAuthTokens",
      "getPat",
      "refreshFigmaOAuthToken",
      "resolveFigmaAccessToken",
      "saveOAuthClientCredentials",
      "saveOAuthTokens",
      "savePat",
      "selectFileCredentialBackend",
      "setCredential",
    ];

    expect(Object.keys(api).sort()).toEqual(expected);
  });

  it("selectFileCredentialBackend 後は file backend が選ばれ、barrel 経由で読み書きできる", () => {
    expect(api.credentialStoreInfo()).toEqual({ backend: "file" });

    api.setCredential(api.ACCOUNTS.PAT, "figd_via_barrel");
    expect(api.getCredential(api.ACCOUNTS.PAT)).toBe("figd_via_barrel");

    api.deleteCredential(api.ACCOUNTS.PAT);
    expect(api.getCredential(api.ACCOUNTS.PAT)).toBeNull();
  });

  it("deleteOAuthClientCredentials は client_id / client_secret を両方消す", () => {
    api.saveOAuthClientCredentials({ clientId: "client-id-1", clientSecret: "secret-1" });
    expect(api.getOAuthClientCredentials()).toEqual({
      clientId: "client-id-1",
      clientSecret: "secret-1",
    });

    api.deleteOAuthClientCredentials();
    expect(api.getOAuthClientCredentials()).toBeNull();
  });
});

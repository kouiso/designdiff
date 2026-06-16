import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as NodeOs from "node:os";

const TMP_DIR = path.join(tmpdir(), `figdiff-credstest-${process.pid}`);

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof NodeOs>("node:os");
  return {
    ...actual,
    homedir: () => TMP_DIR,
  };
});

vi.mock("./keychain-backend.js", () => ({
  probeKeychainAvailability: () => false,
  createKeychainBackend: () => {
    throw new Error("keychain should not be used in tests");
  },
}));

const {
  savePat,
  getPat,
  deletePat,
  saveOAuthTokens,
  getOAuthTokens,
  deleteOAuthTokens,
  saveOAuthClientCredentials,
  getOAuthClientCredentials,
} = await import("./figma-credentials.js");

describe("figma-credentials (file backend)", () => {
  beforeEach(() => {
    mkdirSync(TMP_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TMP_DIR)) {
      rmSync(TMP_DIR, { recursive: true, force: true });
    }
    vi.resetModules();
  });

  it("PAT round-trip", () => {
    savePat("figd_test_pat_value");
    expect(getPat()).toBe("figd_test_pat_value");
    deletePat();
    expect(getPat()).toBeNull();
  });

  it("OAuth tokens round-trip", () => {
    const tokens = {
      accessToken: "access-123",
      refreshToken: "refresh-456",
      expiresAt: 9999999999000,
    };
    saveOAuthTokens(tokens);
    const result = getOAuthTokens();
    expect(result).toEqual(tokens);
    deleteOAuthTokens();
    expect(getOAuthTokens()).toBeNull();
  });

  it("OAuth client credentials round-trip", () => {
    saveOAuthClientCredentials({ clientId: "client-id-1", clientSecret: "secret-1" });
    const result = getOAuthClientCredentials();
    expect(result).toEqual({ clientId: "client-id-1", clientSecret: "secret-1" });
  });

  it("returns null when no tokens stored", () => {
    expect(getPat()).toBeNull();
    expect(getOAuthTokens()).toBeNull();
    expect(getOAuthClientCredentials()).toBeNull();
  });
});

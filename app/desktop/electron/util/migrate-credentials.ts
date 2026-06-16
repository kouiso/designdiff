import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";

import { app, safeStorage } from "electron";
import { z } from "zod";

import { saveOAuthClientCredentials, saveOAuthTokens, savePat } from "@figdiff/credential-store";

const CredentialStoreSchema = z.record(z.string(), z.string());

const CREDENTIAL_KEY = "figma-token";
const OAUTH_ACCESS_TOKEN_KEY = "figma-oauth-access-token";
const OAUTH_REFRESH_TOKEN_KEY = "figma-oauth-refresh-token";
const OAUTH_EXPIRY_KEY = "figma-oauth-token-expiry";
const OAUTH_CLIENT_ID_KEY = "figma-oauth-client-id";
const OAUTH_CLIENT_SECRET_KEY = "figma-oauth-client-secret";

function decryptValue(store: Record<string, string>, key: string): string | null {
  const encoded = store[key];
  if (!encoded) return null;
  const flag = store[`${key}-encrypted`];
  if (flag === "dev-plaintext") {
    if (!app.isPackaged) return Buffer.from(encoded, "base64").toString("utf-8");
    return null;
  }
  if (flag !== "true") return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(encoded, "base64"));
  } catch {
    return null;
  }
}

export function migrateCredentials(): void {
  const credPath = join(app.getPath("userData"), "credentials.enc");
  const migratedPath = `${credPath}.migrated`;

  if (!existsSync(credPath) || existsSync(migratedPath)) return;

  let store: Record<string, string>;
  try {
    const raw = readFileSync(credPath, "utf-8");
    store = CredentialStoreSchema.parse(JSON.parse(raw));
  } catch {
    console.warn("[migrate-credentials] Failed to read credentials.enc; skipping migration.");
    return;
  }

  let migrated = 0;

  const pat = decryptValue(store, CREDENTIAL_KEY);
  if (pat) {
    try {
      savePat(pat);
      migrated++;
    } catch (e) {
      console.warn("[migrate-credentials] Failed to migrate PAT:", e);
    }
  }

  const accessToken = decryptValue(store, OAUTH_ACCESS_TOKEN_KEY);
  const refreshToken = decryptValue(store, OAUTH_REFRESH_TOKEN_KEY);
  const expiryStr = decryptValue(store, OAUTH_EXPIRY_KEY);
  if (accessToken && refreshToken && expiryStr) {
    const expiresAt = Number(expiryStr);
    if (Number.isFinite(expiresAt)) {
      try {
        saveOAuthTokens({ accessToken, refreshToken, expiresAt });
        migrated++;
      } catch (e) {
        console.warn("[migrate-credentials] Failed to migrate OAuth tokens:", e);
      }
    }
  }

  const clientId = decryptValue(store, OAUTH_CLIENT_ID_KEY);
  const clientSecret = decryptValue(store, OAUTH_CLIENT_SECRET_KEY);
  if (clientId && clientSecret) {
    try {
      saveOAuthClientCredentials({ clientId, clientSecret });
      migrated++;
    } catch (e) {
      console.warn("[migrate-credentials] Failed to migrate OAuth client credentials:", e);
    }
  }

  if (migrated > 0) {
    try {
      renameSync(credPath, migratedPath);
      console.info(
        `[migrate-credentials] Migrated ${migrated} credential(s). Old file renamed to credentials.enc.migrated.`,
      );
    } catch (e) {
      console.warn("[migrate-credentials] Failed to rename credentials.enc:", e);
    }
  }
}

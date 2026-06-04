import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { app, safeStorage } from "electron";
import { z } from "zod";

const CREDENTIAL_KEY = "figma-token";

const OAUTH_ACCESS_TOKEN_KEY = "figma-oauth-access-token";
const OAUTH_REFRESH_TOKEN_KEY = "figma-oauth-refresh-token";
const OAUTH_EXPIRY_KEY = "figma-oauth-token-expiry";
const OAUTH_CLIENT_ID_KEY = "figma-oauth-client-id";
const OAUTH_CLIENT_SECRET_KEY = "figma-oauth-client-secret";

const getCredentialPath = (): string => {
  return join(app.getPath("userData"), "credentials.enc");
};

const CredentialStoreSchema = z.record(z.string(), z.string());

const readStore = (): Record<string, string> => {
  const path = getCredentialPath();
  if (!existsSync(path)) return {};
  try {
    return CredentialStoreSchema.parse(JSON.parse(readFileSync(path, "utf-8")));
  } catch (e) {
    console.warn("[safe-storage] 資格情報ファイルのパースに失敗:", e);
    return {};
  }
};

const writeStore = (store: Record<string, string>): void => {
  const path = getCredentialPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(store), "utf-8");
};

const canEncrypt = (): boolean => {
  try {
    if (safeStorage.isEncryptionAvailable()) return true;
    // setUsePlainTextEncryption(true) を呼んでも isEncryptionAvailable() は
    // OS Keychain の状態を返すため false のまま。
    // dev環境では plaintext fallback が有効なので暗号化可能とみなす。
    return !app.isPackaged;
  } catch (e) {
    console.warn("[safe-storage] isEncryptionAvailable failed:", e);
    return false;
  }
};

export const saveToken = (token: string): void => {
  if (!canEncrypt()) {
    throw new Error(
      "OS Keychainによる暗号化が利用できません。トークンの安全な保存ができないため、保存を中止しました。",
    );
  }

  const store = readStore();

  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(token);
    store[CREDENTIAL_KEY] = encrypted.toString("base64");
    store[`${CREDENTIAL_KEY}-encrypted`] = "true";
  } else if (!app.isPackaged) {
    // macOS dev環境: setUsePlainTextEncryption は no-op のため plaintext fallback
    store[CREDENTIAL_KEY] = Buffer.from(token).toString("base64");
    store[`${CREDENTIAL_KEY}-encrypted`] = "dev-plaintext";
  }

  writeStore(store);
};

export const getToken = (): string | null => {
  const store = readStore();
  const encoded = store[CREDENTIAL_KEY];
  if (!encoded) return null;

  const encryptedFlag = store[`${CREDENTIAL_KEY}-encrypted`];

  if (encryptedFlag === "dev-plaintext") {
    if (!app.isPackaged) {
      return Buffer.from(encoded, "base64").toString("utf-8");
    }
    console.error(
      "[safe-storage] dev-plaintext トークンは本番環境では読み取れません。再設定してください。",
    );
    return null;
  }

  if (encryptedFlag !== "true") {
    console.error(
      "[safe-storage] 不明な暗号化フラグです。セキュリティのため読み取りを拒否します。",
    );
    return null;
  }

  if (!safeStorage.isEncryptionAvailable()) {
    console.warn(
      "[safe-storage] OS Keychainが利用できないため、暗号化済みトークンを復号化できません。トークンを再設定してください。",
    );
    return null;
  }

  try {
    const encrypted = Buffer.from(encoded, "base64");
    return safeStorage.decryptString(encrypted);
  } catch (e) {
    console.error("[safe-storage] トークンの復号化に失敗:", e);
    return null;
  }
};

export const deleteToken = (): void => {
  const path = getCredentialPath();
  if (!existsSync(path)) return;

  const store = readStore();
  const keysToRemove = new Set([CREDENTIAL_KEY, `${CREDENTIAL_KEY}-encrypted`]);
  const cleaned = Object.fromEntries(
    Object.entries(store).filter(([key]) => !keysToRemove.has(key)),
  );

  if (Object.keys(cleaned).length === 0) {
    unlinkSync(path);
  } else {
    writeStore(cleaned);
  }
};

// =============================================================================
// OAuth helpers — shared encrypt/decrypt logic
// =============================================================================

const saveEncryptedValue = (
  store: Record<string, string>,
  key: string,
  value: string,
  allowDevPlaintext: boolean,
): void => {
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(value);
    store[key] = encrypted.toString("base64");
    store[`${key}-encrypted`] = "true";
  } else if (allowDevPlaintext && !app.isPackaged) {
    store[key] = Buffer.from(value).toString("base64");
    store[`${key}-encrypted`] = "dev-plaintext";
  } else {
    throw new Error(
      "OS Keychainによる暗号化が利用できません。トークンの安全な保存ができないため、保存を中止しました。",
    );
  }
};

const getDecryptedValue = (store: Record<string, string>, key: string): string | null => {
  const encoded = store[key];
  if (!encoded) return null;

  const flag = store[`${key}-encrypted`];

  if (flag === "dev-plaintext") {
    if (!app.isPackaged) {
      return Buffer.from(encoded, "base64").toString("utf-8");
    }
    console.error(`[safe-storage] dev-plaintext key ${key} は本番環境では読み取れません。`);
    return null;
  }

  if (flag !== "true") {
    console.error(`[safe-storage] 不明な暗号化フラグ (${key}): ${flag}`);
    return null;
  }

  if (!safeStorage.isEncryptionAvailable()) {
    console.warn(`[safe-storage] OS Keychain 利用不可のため ${key} を復号できません。`);
    return null;
  }

  try {
    return safeStorage.decryptString(Buffer.from(encoded, "base64"));
  } catch (e) {
    console.error(`[safe-storage] ${key} の復号に失敗:`, e);
    return null;
  }
};

const removeKeys = (store: Record<string, string>, keys: string[]): Record<string, string> => {
  const removeSet = new Set(keys.flatMap((k) => [k, `${k}-encrypted`]));
  return Object.fromEntries(Object.entries(store).filter(([k]) => !removeSet.has(k)));
};

// =============================================================================
// OAuth token storage (access_token / refresh_token / expiry)
// These use dev-plaintext fallback so dev login works without OS Keychain.
// =============================================================================

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export const saveOAuthTokens = (tokens: OAuthTokens): void => {
  if (!canEncrypt()) {
    throw new Error("OS Keychainによる暗号化が利用できません。OAuthトークンを保存できません。");
  }

  const store = readStore();
  saveEncryptedValue(store, OAUTH_ACCESS_TOKEN_KEY, tokens.accessToken, true);
  saveEncryptedValue(store, OAUTH_REFRESH_TOKEN_KEY, tokens.refreshToken, true);
  saveEncryptedValue(store, OAUTH_EXPIRY_KEY, String(tokens.expiresAt), true);
  writeStore(store);
};

export const getOAuthTokens = (): OAuthTokens | null => {
  const store = readStore();
  const accessToken = getDecryptedValue(store, OAUTH_ACCESS_TOKEN_KEY);
  const refreshToken = getDecryptedValue(store, OAUTH_REFRESH_TOKEN_KEY);
  const expiryStr = getDecryptedValue(store, OAUTH_EXPIRY_KEY);

  if (!accessToken || !refreshToken || !expiryStr) return null;

  const expiresAt = Number(expiryStr);
  if (!Number.isFinite(expiresAt)) return null;

  return { accessToken, refreshToken, expiresAt };
};

export const deleteOAuthTokens = (): void => {
  const store = readStore();
  const cleaned = removeKeys(store, [
    OAUTH_ACCESS_TOKEN_KEY,
    OAUTH_REFRESH_TOKEN_KEY,
    OAUTH_EXPIRY_KEY,
  ]);

  const credPath = getCredentialPath();
  if (Object.keys(cleaned).length === 0 && existsSync(credPath)) {
    unlinkSync(credPath);
  } else {
    writeStore(cleaned);
  }
};

// =============================================================================
// OAuth client credentials (client_id / client_secret)
// Secret NEVER uses dev-plaintext — dev must read from .env.local.
// =============================================================================

export interface OAuthClientCredentials {
  clientId: string;
  clientSecret: string;
}

export const saveOAuthClientCredentials = (creds: OAuthClientCredentials): void => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "OS Keychainによる暗号化が利用できません。クライアント資格情報を保存できません。",
    );
  }

  const store = readStore();
  saveEncryptedValue(store, OAUTH_CLIENT_ID_KEY, creds.clientId, true);
  // client_secret: never dev-plaintext
  saveEncryptedValue(store, OAUTH_CLIENT_SECRET_KEY, creds.clientSecret, false);
  writeStore(store);
};

export const getOAuthClientCredentials = (): OAuthClientCredentials | null => {
  const store = readStore();
  const clientId = getDecryptedValue(store, OAUTH_CLIENT_ID_KEY);
  const clientSecret = getDecryptedValue(store, OAUTH_CLIENT_SECRET_KEY);

  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
};

export const deleteOAuthClientCredentials = (): void => {
  const store = readStore();
  const cleaned = removeKeys(store, [OAUTH_CLIENT_ID_KEY, OAUTH_CLIENT_SECRET_KEY]);

  const credPath = getCredentialPath();
  if (Object.keys(cleaned).length === 0 && existsSync(credPath)) {
    unlinkSync(credPath);
  } else {
    writeStore(cleaned);
  }
};

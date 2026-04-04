import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { app, safeStorage } from "electron";
import { z } from "zod";

const CREDENTIAL_KEY = "figma-token";

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

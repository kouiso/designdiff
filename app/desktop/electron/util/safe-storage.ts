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
    return safeStorage.isEncryptionAvailable();
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
  const encrypted = safeStorage.encryptString(token);
  store[CREDENTIAL_KEY] = encrypted.toString("base64");
  store[`${CREDENTIAL_KEY}-encrypted`] = "true";
  writeStore(store);
};

export const getToken = (): string | null => {
  const store = readStore();
  const encoded = store[CREDENTIAL_KEY];
  if (!encoded) return null;

  const isEncrypted = store[`${CREDENTIAL_KEY}-encrypted`] === "true";

  if (!isEncrypted) {
    console.error(
      "[safe-storage] 非暗号化トークンが検出されました。セキュリティのため読み取りを拒否します。",
    );
    return null;
  }

  if (!canEncrypt()) {
    console.error(
      "[safe-storage] 暗号化されたトークンが保存されていますが、復号化が利用できません。",
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
  delete store[CREDENTIAL_KEY];
  delete store[`${CREDENTIAL_KEY}-encrypted`];

  if (Object.keys(store).length === 0) {
    unlinkSync(path);
  } else {
    writeStore(store);
  }
};

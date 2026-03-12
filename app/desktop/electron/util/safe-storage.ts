import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { app, safeStorage } from "electron";

const CREDENTIAL_KEY = "figma-token";

const getCredentialPath = (): string => {
  return join(app.getPath("userData"), "credentials.enc");
};

interface CredentialStore {
  [key: string]: string;
}

const readStore = (): CredentialStore => {
  const path = getCredentialPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as CredentialStore;
  } catch {
    return {};
  }
};

const writeStore = (store: CredentialStore): void => {
  const path = getCredentialPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(store), "utf-8");
};

export const saveToken = (token: string): void => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("OS暗号化が利用不可（Linux: libsecretがインストールされていない可能性）");
  }
  const encrypted = safeStorage.encryptString(token);
  const store = readStore();
  store[CREDENTIAL_KEY] = encrypted.toString("base64");
  writeStore(store);
};

export const getToken = (): string | null => {
  if (!safeStorage.isEncryptionAvailable()) {
    return null;
  }
  const store = readStore();
  const encoded = store[CREDENTIAL_KEY];
  if (!encoded) return null;

  try {
    const encrypted = Buffer.from(encoded, "base64");
    return safeStorage.decryptString(encrypted);
  } catch {
    return null;
  }
};

export const deleteToken = (): void => {
  const path = getCredentialPath();
  if (!existsSync(path)) return;

  const store = readStore();
  delete store[CREDENTIAL_KEY];

  if (Object.keys(store).length === 0) {
    unlinkSync(path);
  } else {
    writeStore(store);
  }
};

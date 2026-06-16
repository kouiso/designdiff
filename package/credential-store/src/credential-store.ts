import { createFileBackend, type FileBackend } from "./file-backend.js";
import {
  createKeychainBackend,
  probeKeychainAvailability,
  type KeychainBackend,
} from "./keychain-backend.js";

export type Backend = KeychainBackend | FileBackend;

export interface CredentialStoreInfo {
  backend: "keychain" | "file";
}

let _backend: Backend | undefined;

export function getBackend(): Backend {
  if (_backend) return _backend;
  if (probeKeychainAvailability()) {
    _backend = createKeychainBackend();
  } else {
    console.info("[credential-store] OS keychain unavailable; using ~/.figdiff/credentials.json");
    _backend = createFileBackend();
  }
  return _backend;
}

export function getCredential(account: string): string | null {
  return getBackend().get(account);
}

export function setCredential(account: string, value: string): void {
  getBackend().set(account, value);
}

export function deleteCredential(account: string): void {
  getBackend().delete(account);
}

export function credentialStoreInfo(): CredentialStoreInfo {
  const backend = getBackend();
  return { backend: backend.type };
}

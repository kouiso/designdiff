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

export function selectFileCredentialBackend(): void {
  _backend = createFileBackend();
}

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
  const backend = getBackend();
  const value = backend.get(account);
  if (value !== null) return value;
  // keychain backend が「利用可能」と判定されても、そのkeychainには
  // 該当エントリが無く、file backend (~/.figdiff/credentials.json) の方に
  // 既存のクレデンシャルが保存されているケースがある (probeKeychainAvailability
  // は「keychain機構が動くか」だけを見て「該当データがそこにあるか」は
  // 見ていないため)。read-only フォールバックとしてfile backendも確認する。
  // set/delete の意味論は変えない (常に選択済みbackendへ書く)。
  if (backend.type === "keychain") {
    return createFileBackend().get(account);
  }
  return null;
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

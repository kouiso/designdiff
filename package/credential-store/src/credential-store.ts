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
let _keychainReader: KeychainBackend | null | undefined;

/**
 * file backend が選ばれとるときに、読むだけ試す keychain。
 *
 * desktop はトークンを OS keychain へ保存する (平文保存を禁じとるため)。
 * 一方 MCP サーバは対話でけん経路で動くので、書き込みを伴う
 * probeKeychainAvailability() を避けて file backend を明示的に選ぶ。
 * その結果「desktop でログインしたのに MCP からは未ログインに見える」が起きとった。
 *
 * probe はせず get だけ試す。読めん環境では例外を握って null になるだけで、
 * file backend の動作は変わらん。keychain へ触れたくない環境では
 * FIGDIFF_DISABLE_KEYCHAIN_READ=1 で止められる。
 */
function getKeychainReader(): KeychainBackend | null {
  if (_keychainReader !== undefined) return _keychainReader;
  if (process.env.FIGDIFF_DISABLE_KEYCHAIN_READ === "1") {
    _keychainReader = null;
    return _keychainReader;
  }
  try {
    _keychainReader = createKeychainBackend();
  } catch {
    // keychain の無い環境ではネイティブ側で落ちる。file backend だけで動く
    // 従来の挙動へ戻すだけなので、読み取りは失敗として扱う。
    _keychainReader = null;
  }
  return _keychainReader;
}

/** keychain 側の読み書きは、失敗しても file backend の結果を壊さん。 */
function tryKeychain<T>(action: (backend: KeychainBackend) => T): T | null {
  const reader = getKeychainReader();
  if (reader === null) return null;
  try {
    return action(reader);
  } catch {
    return null;
  }
}

export function selectFileCredentialBackend(): void {
  _backend = createFileBackend();
}

/** テスト用: backend の選択と keychain 読み取りのキャッシュを捨てる。 */
export function _resetCredentialBackendForTesting(): void {
  _backend = undefined;
  _keychainReader = undefined;
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
  // set の意味論は変えない (常に選択済みbackendへ書く)。
  if (backend.type === "keychain") {
    return createFileBackend().get(account);
  }
  // 逆向きも要る。file backend しか見んと、desktop が keychain へ保存した
  // トークンが MCP から見えず、「デスクトップでログインしてください」という
  // 案内どおりにしても直らん袋小路になる。
  return tryKeychain((keychain) => keychain.get(account)) ?? null;
}

export function setCredential(account: string, value: string): void {
  getBackend().set(account, value);
}

export function deleteCredential(account: string): void {
  const backend = getBackend();
  backend.delete(account);
  // getCredential の read-only フォールバックにより、keychain削除後も
  // file backend側の値が「復活」して見えてしまう非対称を防ぐため、
  // keychain選択時は file backend からも削除する。
  if (backend.type === "keychain") {
    createFileBackend().delete(account);
  }
  // 読む側と揃える。片方に残ると、消したはずのトークンが次の get で復活する。
  if (backend.type === "file") {
    tryKeychain((keychain) => {
      keychain.delete(account);
    });
  }
}

export function credentialStoreInfo(): CredentialStoreInfo {
  const backend = getBackend();
  return { backend: backend.type };
}

import { Entry } from "@napi-rs/keyring";

const SERVICE = "figdiff";
const PROBE_ACCOUNT = "__probe__";
const PROBE_VALUE = "ok";

export interface KeychainBackend {
  type: "keychain";
  get(account: string): string | null;
  set(account: string, value: string): void;
  delete(account: string): void;
}

let _available: boolean | undefined;

export function probeKeychainAvailability(): boolean {
  if (_available !== undefined) return _available;
  const entry = new Entry(SERVICE, PROBE_ACCOUNT);
  try {
    entry.setPassword(PROBE_VALUE);
    const val = entry.getPassword();
    _available = val === PROBE_VALUE;
  } catch {
    _available = false;
  } finally {
    try {
      entry.deletePassword();
    } catch {
      // ignore cleanup errors
    }
  }
  return _available;
}

export function createKeychainBackend(): KeychainBackend {
  return {
    type: "keychain",
    get(account: string): string | null {
      try {
        const entry = new Entry(SERVICE, account);
        return entry.getPassword() ?? null;
      } catch {
        return null;
      }
    },
    set(account: string, value: string): void {
      const entry = new Entry(SERVICE, account);
      entry.setPassword(value);
    },
    delete(account: string): void {
      try {
        const entry = new Entry(SERVICE, account);
        entry.deletePassword();
      } catch {
        // ignore if not found
      }
    },
  };
}

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";

import { z } from "zod";

const CREDENTIAL_PATH = path.join(homedir(), ".figdiff", "credentials.json");
const CredentialFileSchema = z.record(z.string(), z.string());

export interface FileBackend {
  type: "file";
  get(account: string): string | null;
  set(account: string, value: string): void;
  delete(account: string): void;
}

function readStore(): Record<string, string> {
  try {
    if (!existsSync(CREDENTIAL_PATH)) return {};
    const raw = readFileSync(CREDENTIAL_PATH, "utf-8");
    return CredentialFileSchema.parse(JSON.parse(raw));
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, string>): void {
  const dir = path.dirname(CREDENTIAL_PATH);
  mkdirSync(dir, { recursive: true });
  const tmp = `${CREDENTIAL_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(store), { encoding: "utf-8", mode: 0o600 });
  renameSync(tmp, CREDENTIAL_PATH);
  chmodSync(CREDENTIAL_PATH, 0o600);
}

export function createFileBackend(): FileBackend {
  return {
    type: "file",
    get(account: string): string | null {
      const store = readStore();
      return store[account] ?? null;
    },
    set(account: string, value: string): void {
      const store = readStore();
      store[account] = value;
      writeStore(store);
    },
    delete(account: string): void {
      const store = readStore();
      if (!(account in store)) return;
      const nextStore = Object.fromEntries(Object.entries(store).filter(([key]) => key !== account));
      if (Object.keys(nextStore).length === 0) {
        try {
          unlinkSync(CREDENTIAL_PATH);
        } catch {
          // ignore
        }
      } else {
        writeStore(nextStore);
      }
    },
  };
}

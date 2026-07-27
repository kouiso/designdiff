import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as KeychainBackend from "./keychain-backend.js";

// 実物の Entry は開発者本人の OS キーチェーンへ書き込むため、絶対に使わない。
// ここでは全ての振る舞いをメモリ上の fake で再現する。
interface KeyringState {
  passwords: Map<string, string>;
  setShouldThrow: boolean;
  getShouldThrow: boolean;
  deleteShouldThrow: boolean;
  getReturnsWrongValue: boolean;
}

const state: KeyringState = {
  passwords: new Map(),
  setShouldThrow: false,
  getShouldThrow: false,
  deleteShouldThrow: false,
  getReturnsWrongValue: false,
};

vi.mock("@napi-rs/keyring", () => {
  class FakeEntry {
    private readonly key: string;

    constructor(service: string, account: string) {
      this.key = `${service}::${account}`;
    }

    setPassword(value: string): void {
      if (state.setShouldThrow) throw new Error("keychain locked");
      state.passwords.set(this.key, value);
    }

    getPassword(): string | null {
      if (state.getShouldThrow) throw new Error("keychain locked");
      if (state.getReturnsWrongValue) return "tampered";
      return state.passwords.get(this.key) ?? null;
    }

    deletePassword(): void {
      if (state.deleteShouldThrow) throw new Error("keychain locked");
      state.passwords.delete(this.key);
    }
  }
  return { Entry: FakeEntry };
});

function resetState(): void {
  state.passwords.clear();
  state.setShouldThrow = false;
  state.getShouldThrow = false;
  state.deleteShouldThrow = false;
  state.getReturnsWrongValue = false;
}

// probeKeychainAvailability はモジュールスコープ変数で結果を記憶するため、
// 判定を作り直したいテストごとにモジュールを読み直す。
async function freshModule(): Promise<typeof KeychainBackend> {
  vi.resetModules();
  return import("./keychain-backend.js");
}

describe("probeKeychainAvailability", () => {
  beforeEach(resetState);

  it("書き込んだ値をそのまま読み戻せれば利用可能と判定し、probeエントリを残さない", async () => {
    const { probeKeychainAvailability } = await freshModule();

    expect(probeKeychainAvailability()).toBe(true);
    expect(state.passwords.size).toBe(0);
  });

  it("読み戻した値が一致しなければ利用不可と判定する", async () => {
    state.getReturnsWrongValue = true;
    const { probeKeychainAvailability } = await freshModule();

    expect(probeKeychainAvailability()).toBe(false);
  });

  it("書き込みが例外を投げれば利用不可と判定する", async () => {
    state.setShouldThrow = true;
    const { probeKeychainAvailability } = await freshModule();

    expect(probeKeychainAvailability()).toBe(false);
  });

  it("後片付けの削除が失敗しても判定結果は変わらない", async () => {
    state.deleteShouldThrow = true;
    const { probeKeychainAvailability } = await freshModule();

    expect(probeKeychainAvailability()).toBe(true);
  });

  it("2回目以降は記憶した判定結果を返し、再度キーチェーンを触らない", async () => {
    const { probeKeychainAvailability } = await freshModule();
    expect(probeKeychainAvailability()).toBe(true);

    state.setShouldThrow = true;
    expect(probeKeychainAvailability()).toBe(true);
  });
});

describe("createKeychainBackend", () => {
  beforeEach(resetState);

  it("type は keychain", async () => {
    const { createKeychainBackend } = await freshModule();

    expect(createKeychainBackend().type).toBe("keychain");
  });

  it("set した値を get で取り出せ、delete すると消える", async () => {
    const { createKeychainBackend } = await freshModule();
    const backend = createKeychainBackend();

    backend.set("figma-pat", "figd_value");
    expect(backend.get("figma-pat")).toBe("figd_value");

    backend.delete("figma-pat");
    expect(backend.get("figma-pat")).toBeNull();
  });

  it("未登録アカウントの get は null", async () => {
    const { createKeychainBackend } = await freshModule();

    expect(createKeychainBackend().get("missing")).toBeNull();
  });

  it("get が例外を投げても null を返す", async () => {
    const { createKeychainBackend } = await freshModule();
    const backend = createKeychainBackend();
    backend.set("figma-pat", "figd_value");

    state.getShouldThrow = true;
    expect(backend.get("figma-pat")).toBeNull();
  });

  it("delete が例外を投げても伝播させない", async () => {
    const { createKeychainBackend } = await freshModule();
    const backend = createKeychainBackend();

    state.deleteShouldThrow = true;
    expect(() => backend.delete("figma-pat")).not.toThrow();
  });

  it("set の失敗は呼び出し元へ伝える (保存できていないことを隠さない)", async () => {
    const { createKeychainBackend } = await freshModule();
    const backend = createKeychainBackend();

    state.setShouldThrow = true;
    expect(() => backend.set("figma-pat", "figd_value")).toThrow("keychain locked");
  });
});

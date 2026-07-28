import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 旧い保管形式から新しい保管先へ移す処理。取りこぼすと利用者は繋ぎ直しになり、
// 二重に走らせると古い値で上書きしてしまう。
const mocks = vi.hoisted(() => ({
  getPath: vi.fn(),
  isEncryptionAvailable: vi.fn(() => true),
  decryptString: vi.fn((buffer: Buffer) => buffer.toString("utf-8")),
  savePat: vi.fn(),
  saveOAuthTokens: vi.fn(),
  saveOAuthClientCredentials: vi.fn(),
  isPackaged: false,
}));

vi.mock("electron", () => ({
  app: {
    getPath: mocks.getPath,
    get isPackaged() {
      return mocks.isPackaged;
    },
  },
  safeStorage: {
    isEncryptionAvailable: mocks.isEncryptionAvailable,
    decryptString: mocks.decryptString,
  },
}));

vi.mock("@figdiff/credential-store", () => ({
  savePat: mocks.savePat,
  saveOAuthTokens: mocks.saveOAuthTokens,
  saveOAuthClientCredentials: mocks.saveOAuthClientCredentials,
}));

const encoded = (value: string): string => Buffer.from(value, "utf-8").toString("base64");

describe("migrateCredentials", () => {
  let userDataDir: string;
  let credPath: string;

  beforeEach(async () => {
    userDataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "figdiff-migrate-"));
    credPath = path.join(userDataDir, "credentials.enc");
    mocks.getPath.mockReturnValue(userDataDir);
    mocks.isPackaged = false;
    mocks.isEncryptionAvailable.mockReturnValue(true);
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(async () => {
    await fs.promises.rm(userDataDir, { recursive: true, force: true });
  });

  async function migrate(): Promise<void> {
    const { migrateCredentials } = await import("./migrate-credentials.js");
    migrateCredentials();
  }

  const writeStore = (store: Record<string, string>): void => {
    fs.writeFileSync(credPath, JSON.stringify(store), "utf-8");
  };

  it("移す元が無ければ何もしないこと", async () => {
    await migrate();

    expect(mocks.savePat).not.toHaveBeenCalled();
  });

  it("暗号化された個人用トークンを移すこと", async () => {
    writeStore({ "figma-token": encoded("pat-value"), "figma-token-encrypted": "true" });

    await migrate();

    expect(mocks.savePat).toHaveBeenCalledWith("pat-value");
  });

  it("開発用の平文は、出荷版では移さないこと", async () => {
    writeStore({ "figma-token": encoded("pat"), "figma-token-encrypted": "dev-plaintext" });
    mocks.isPackaged = true;

    await migrate();

    expect(mocks.savePat).not.toHaveBeenCalled();
  });

  it("開発用の平文は、開発版では移すこと", async () => {
    writeStore({ "figma-token": encoded("pat"), "figma-token-encrypted": "dev-plaintext" });

    await migrate();

    expect(mocks.savePat).toHaveBeenCalledWith("pat");
  });

  it("暗号化の印が無い値は移さないこと", async () => {
    writeStore({ "figma-token": encoded("pat") });

    await migrate();

    expect(mocks.savePat).not.toHaveBeenCalled();
  });

  it("復号できない環境では移さないこと", async () => {
    writeStore({ "figma-token": encoded("pat"), "figma-token-encrypted": "true" });
    mocks.isEncryptionAvailable.mockReturnValue(false);

    await migrate();

    expect(mocks.savePat).not.toHaveBeenCalled();
  });

  it("復号に失敗した値は飛ばし、他は移すこと", async () => {
    mocks.decryptString.mockImplementationOnce(() => {
      throw new Error("decrypt failed");
    });
    writeStore({
      "figma-token": encoded("pat"),
      "figma-token-encrypted": "true",
      "figma-oauth-client-id": encoded("id"),
      "figma-oauth-client-id-encrypted": "true",
      "figma-oauth-client-secret": encoded("secret"),
      "figma-oauth-client-secret-encrypted": "true",
    });

    await migrate();

    expect(mocks.savePat).not.toHaveBeenCalled();
    expect(mocks.saveOAuthClientCredentials).toHaveBeenCalledWith({
      clientId: "id",
      clientSecret: "secret",
    });
  });

  it("引き換え用のトークン一式を移すこと", async () => {
    writeStore({
      "figma-oauth-access-token": encoded("access"),
      "figma-oauth-access-token-encrypted": "true",
      "figma-oauth-refresh-token": encoded("refresh"),
      "figma-oauth-refresh-token-encrypted": "true",
      "figma-oauth-token-expiry": encoded("1730000000000"),
      "figma-oauth-token-expiry-encrypted": "true",
    });

    await migrate();

    expect(mocks.saveOAuthTokens).toHaveBeenCalledWith({
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: 1730000000000,
    });
  });

  it("中身が壊れていたら、何も移さずに終わること", async () => {
    fs.writeFileSync(credPath, "{ not json", "utf-8");

    await migrate();

    expect(mocks.savePat).not.toHaveBeenCalled();
  });

  it("一度移したら、二度目は何もしないこと", async () => {
    writeStore({ "figma-token": encoded("pat"), "figma-token-encrypted": "true" });

    await migrate();
    mocks.savePat.mockClear();
    await migrate();

    // 二度走ると、後から入れ直した新しい値を古い値で上書きしてしまう。
    expect(mocks.savePat).not.toHaveBeenCalled();
  });
});

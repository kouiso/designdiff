import { beforeEach, describe, expect, it, vi } from "vitest";

// 資格情報の保管は別パッケージが持つ。ここが検査したいのは「どの保管先へ、
// 何をそのまま渡しているか」だけなので、保管側を差し替える。
const mocks = vi.hoisted(() => ({
  savePat: vi.fn(),
  getPat: vi.fn(),
  deletePat: vi.fn(),
  saveOAuthTokens: vi.fn(),
  getOAuthTokens: vi.fn(),
  deleteOAuthTokens: vi.fn(),
  saveOAuthClientCredentials: vi.fn(),
  getOAuthClientCredentials: vi.fn(),
  deleteOAuthClientCredentials: vi.fn(),
}));

vi.mock("@figdiff/credential-store", () => mocks);

import {
  deleteOAuthClientCredentials,
  deleteOAuthTokens,
  deleteToken,
  getOAuthClientCredentials,
  getOAuthTokens,
  getToken,
  saveOAuthClientCredentials,
  saveOAuthTokens,
  saveToken,
} from "./safe-storage.js";

describe("safe-storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("個人用のトークンを保管先へそのまま渡すこと", () => {
    saveToken("pat-value");

    expect(mocks.savePat).toHaveBeenCalledWith("pat-value");
  });

  it("保管先が返した値をそのまま返すこと", () => {
    mocks.getPat.mockReturnValue("stored-pat");

    expect(getToken()).toBe("stored-pat");
  });

  it("保管先が空なら null を返すこと", () => {
    mocks.getPat.mockReturnValue(null);

    expect(getToken()).toBeNull();
  });

  it("個人用のトークンの削除を保管先へ伝えること", () => {
    deleteToken();

    expect(mocks.deletePat).toHaveBeenCalledOnce();
  });

  it("引き換え用のトークン一式をそのまま渡すこと", () => {
    const tokens = { accessToken: "a", refreshToken: "r", expiresAt: 123 };

    saveOAuthTokens(tokens);

    expect(mocks.saveOAuthTokens).toHaveBeenCalledWith(tokens);
  });

  it("引き換え用のトークン一式を保管先から取り出すこと", () => {
    const tokens = { accessToken: "a", refreshToken: "r", expiresAt: 123 };
    mocks.getOAuthTokens.mockReturnValue(tokens);

    expect(getOAuthTokens()).toEqual(tokens);
  });

  it("引き換え用のトークンの削除を保管先へ伝えること", () => {
    deleteOAuthTokens();

    expect(mocks.deleteOAuthTokens).toHaveBeenCalledOnce();
  });

  it("接続に使う識別情報をそのまま渡すこと", () => {
    const credentials = { clientId: "id", clientSecret: "secret" };

    saveOAuthClientCredentials(credentials);

    expect(mocks.saveOAuthClientCredentials).toHaveBeenCalledWith(credentials);
  });

  it("接続に使う識別情報を保管先から取り出すこと", () => {
    const credentials = { clientId: "id", clientSecret: "secret" };
    mocks.getOAuthClientCredentials.mockReturnValue(credentials);

    expect(getOAuthClientCredentials()).toEqual(credentials);
  });

  it("接続に使う識別情報の削除を保管先へ伝えること", () => {
    deleteOAuthClientCredentials();

    expect(mocks.deleteOAuthClientCredentials).toHaveBeenCalledOnce();
  });
});

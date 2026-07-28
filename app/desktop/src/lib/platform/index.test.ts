import { afterEach, describe, expect, it } from "vitest";

import {
  _resetPlatformForTesting,
  _setPlatformForTesting,
  getCapabilities,
  getOverlay,
  getPlatform,
} from "./index";

import type { PlatformAdapter } from "./platform-adapter";

// テストでは __mock__/electron.ts が window.electronAPI を差し込むので、
// 判定は常に Electron 側へ倒れる。Web 側の分岐は web-adapter.test.ts が受け持つ。
describe("platform 解決", () => {
  afterEach(() => {
    _resetPlatformForTesting();
  });

  it("Electron 環境では Electron 用の実装を返す", async () => {
    const platform = await getPlatform();
    expect(typeof platform.figma.getFrames).toBe("function");
    expect(typeof platform.oauth.start).toBe("function");
  });

  // 毎回 import し直すと、呼ぶたびに別の実装が返って
  // 差し替えたはずのものが効かんことがある。
  it("2回目以降は同じものを返す", async () => {
    const first = await getPlatform();
    const second = await getPlatform();
    expect(second).toBe(first);
  });

  it("できることの一覧も同じものを返し続ける", async () => {
    const first = await getCapabilities();
    expect(first).toEqual({
      hasOverlay: true,
      hasLocalFileAccess: true,
      hasSecureTokenStorage: true,
    });
    expect(await getCapabilities()).toBe(first);
  });

  it("重ね表示は Electron でだけ取れる", async () => {
    const overlay = await getOverlay();
    expect(overlay).not.toBeNull();
    expect(typeof overlay?.open).toBe("function");
  });

  it("_setPlatformForTesting で差し替えた実装が使われる", async () => {
    const stub = { figma: {}, token: {}, file: {}, project: {}, oauth: {} } as PlatformAdapter;
    _setPlatformForTesting(stub);

    expect(await getPlatform()).toBe(stub);

    _resetPlatformForTesting();
    expect(await getPlatform()).not.toBe(stub);
  });
});

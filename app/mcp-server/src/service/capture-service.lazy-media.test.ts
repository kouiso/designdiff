import { afterEach, describe, expect, it } from "vitest";

import { forceEagerMediaInPage } from "./capture-service.js";

// この package は playwright をモックする方針なので、実ブラウザは立てん。
// ブラウザ側で走る関数だけを、最小の DOM 代役で確かめる。
// 実ブラウザでの挙動 (captureBeyondViewport がスクロールせんため lazy が
// 発火せんこと) は E2E と実測で確認済み。

interface FakeElement {
  attributes: Record<string, string>;
  setAttribute(name: string, value: string): void;
}

interface FakeImage extends FakeElement {
  complete: boolean;
  listeners: Record<string, (() => void)[]>;
  addEventListener(type: string, listener: () => void, options?: { once?: boolean }): void;
  fire(type: string): void;
}

const createImage = (loading: string | null, complete: boolean): FakeImage => ({
  attributes: loading === null ? {} : { loading },
  setAttribute(name, value) {
    this.attributes[name] = value;
  },
  complete,
  listeners: {},
  addEventListener(type, listener) {
    const existing = this.listeners[type] ?? [];
    existing.push(listener);
    this.listeners[type] = existing;
  },
  fire(type) {
    for (const listener of this.listeners[type] ?? []) listener();
  },
});

const installFakeDocument = (images: FakeImage[], iframes: FakeElement[] = []): void => {
  const fakeDocument = {
    images,
    querySelectorAll: (selector: string): FakeElement[] => {
      if (selector.startsWith("img")) return images.filter((i) => i.attributes.loading === "lazy");
      return iframes.filter((f) => f.attributes.loading === "lazy");
    },
  };
  Object.defineProperty(globalThis, "document", {
    value: fakeDocument,
    configurable: true,
    writable: true,
  });
};

afterEach(() => {
  Reflect.deleteProperty(globalThis, "document");
});

describe("forceEagerMediaInPage", () => {
  it("lazy な img を eager へ倒す", async () => {
    const lazyImage = createImage("lazy", true);
    installFakeDocument([lazyImage]);

    await forceEagerMediaInPage();

    expect(lazyImage.attributes.loading).toBe("eager");
  });

  it("lazy な iframe も eager へ倒す", async () => {
    const lazyFrame: FakeElement = {
      attributes: { loading: "lazy" },
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
    };
    installFakeDocument([], [lazyFrame]);

    await forceEagerMediaInPage();

    expect(lazyFrame.attributes.loading).toBe("eager");
  });

  // 倒すだけで撮ると、読み込みが間に合わんまま写る。
  it("読み込み中の画像を待ってから返る", async () => {
    const pendingImage = createImage("lazy", false);
    installFakeDocument([pendingImage]);

    let settled = false;
    const done = forceEagerMediaInPage().then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    pendingImage.fire("load");
    await done;
    expect(settled).toBe(true);
  });

  // 1枚の失敗で撮影全体を止めん。壊れた画像はデザイン側にも写らんだけ。
  it("読み込みに失敗した画像でも止まらん", async () => {
    const brokenImage = createImage("lazy", false);
    installFakeDocument([brokenImage]);

    const done = forceEagerMediaInPage();
    brokenImage.fire("error");

    await expect(done).resolves.toBeUndefined();
  });

  it("読み終わっとる画像は待たん", async () => {
    const loadedImage = createImage(null, true);
    installFakeDocument([loadedImage]);

    await expect(forceEagerMediaInPage()).resolves.toBeUndefined();
  });
});

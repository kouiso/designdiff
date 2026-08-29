import { afterEach, describe, expect, it, vi } from "vitest";

import { forceEagerMediaInPage } from "./capture-service.js";

// この package は playwright をモックする方針なので、実ブラウザは立てん。
// ブラウザ側で走る関数だけを、最小の DOM 代役で確かめる。
// 実ブラウザでの挙動 (captureBeyondViewport がスクロールせんため lazy が
// 発火せんこと) は E2E と実測で確認済み。

const TIMEOUT_MS = 15_000;

interface FakeElement {
  tag: "img" | "iframe";
  attributes: Record<string, string>;
  src: string;
  currentSrc: string;
  complete: boolean;
  listeners: Record<string, (() => void)[]>;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  addEventListener(type: string, listener: () => void, options?: { once?: boolean }): void;
  fire(type: string): void;
}

const createElement = (
  tag: "img" | "iframe",
  loading: string | null,
  complete: boolean,
  src = `https://example.test/${tag}.png`,
): FakeElement => ({
  tag,
  attributes: loading === null ? {} : { loading },
  src,
  currentSrc: src,
  complete,
  listeners: {},
  getAttribute(name) {
    return this.attributes[name] ?? null;
  },
  setAttribute(name, value) {
    this.attributes[name] = value;
  },
  addEventListener(type, listener) {
    const existing = this.listeners[type] ?? [];
    existing.push(listener);
    this.listeners[type] = existing;
  },
  fire(type) {
    for (const listener of this.listeners[type] ?? []) listener();
  },
});

const installFakeDocument = (elements: FakeElement[]): void => {
  const fakeDocument = {
    querySelectorAll: (selector: string): FakeElement[] =>
      elements.filter((element) => element.tag === selector),
  };
  Object.defineProperty(globalThis, "document", {
    value: fakeDocument,
    configurable: true,
    writable: true,
  });
};

afterEach(() => {
  Reflect.deleteProperty(globalThis, "document");
  vi.useRealTimers();
});

describe("forceEagerMediaInPage", () => {
  it("lazy な img を eager へ倒す", async () => {
    const lazyImage = createElement("img", "lazy", true);
    installFakeDocument([lazyImage]);

    await forceEagerMediaInPage(TIMEOUT_MS);

    expect(lazyImage.attributes.loading).toBe("eager");
  });

  it("lazy な iframe も eager へ倒す", async () => {
    const lazyFrame = createElement("iframe", "lazy", false);
    installFakeDocument([lazyFrame]);

    const done = forceEagerMediaInPage(TIMEOUT_MS);
    lazyFrame.fire("load");

    expect(await done).toEqual([]);
    expect(lazyFrame.attributes.loading).toBe("eager");
  });

  // 既に読み込み済みの iframe は load が二度と来ん。待つと必ず時間切れになる。
  it("lazy やない iframe は待たん", async () => {
    installFakeDocument([createElement("iframe", null, false)]);
    expect(await forceEagerMediaInPage(TIMEOUT_MS)).toEqual([]);
  });

  it("読み込み中の画像を待ってから返る", async () => {
    const pendingImage = createElement("img", "lazy", false);
    installFakeDocument([pendingImage]);

    let settled = false;
    const done = forceEagerMediaInPage(TIMEOUT_MS).then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    pendingImage.fire("load");
    await done;
    expect(settled).toBe(true);
  });

  it("読み込みに失敗した画像でも止まらん", async () => {
    const brokenImage = createElement("img", "lazy", false);
    installFakeDocument([brokenImage]);

    const done = forceEagerMediaInPage(TIMEOUT_MS);
    brokenImage.fire("error");

    expect(await done).toEqual([]);
  });

  it("読み終わっとる画像は待たん", async () => {
    installFakeDocument([createElement("img", null, true)]);
    expect(await forceEagerMediaInPage(TIMEOUT_MS)).toEqual([]);
  });

  // load も error も来ん相手に当たると、期限が無ければ撮影が永久に止まる。
  it("期限を過ぎたメディアは名指しして返す", async () => {
    vi.useFakeTimers();
    const stuck = createElement("img", "lazy", false, "https://example.test/stuck.png");
    installFakeDocument([stuck]);

    const done = forceEagerMediaInPage(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(await done).toEqual(["https://example.test/stuck.png"]);
  });
});

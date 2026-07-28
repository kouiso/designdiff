import { describe, expect, it, vi } from "vitest";

import {
  collectScrollFrames,
  resolveViewport,
  MAX_SCROLL_CAPTURES,
  SCROLL_VIEWPORT_FRACTION,
} from "./scroll-capture.js";

import type { RawImage } from "./stitch.js";

const WIDTH = 4;
const HEIGHT = 10;

function frameFromRows(rows: number[]): RawImage {
  const data = new Uint8Array(WIDTH * rows.length * 4);
  rows.forEach((value, y) => {
    for (let x = 0; x < WIDTH; x++) {
      const offset = (y * WIDTH + x) * 4;
      data[offset] = value & 0xff;
      data[offset + 3] = 0xff;
    }
  });
  return { width: WIDTH, height: rows.length, data };
}

/** offset 行目から HEIGHT 行ぶんを切り出した、長い一枚の一部を返す。 */
function windowOf(strip: number[], offset: number): RawImage {
  const rows: number[] = [];
  for (let y = 0; y < HEIGHT; y++) {
    rows.push(strip[Math.min(offset + y, strip.length - 1)]);
  }
  return frameFromRows(rows);
}

interface FakeDriverOptions {
  strip: number[];
  /** 1回のスクロールで実際に進む行数。0 ならスクロールしない画面。 */
  scrollRows: number;
  /** 撮り始める位置。上端に居らん端末を再現するのに使う。 */
  initialOffset?: number;
}

function createFakeDriver(options: FakeDriverOptions) {
  const maxOffset = Math.max(0, options.strip.length - HEIGHT);
  let offset = Math.min(maxOffset, options.initialOffset ?? 0);
  // 送る向きは距離の符号で決まる。向きを無視すると、上端へ戻す動きを
  // 検査できんようになる。
  const scroll = vi.fn(async ({ distancePx }: { distancePx: number }) => {
    const direction = distancePx < 0 ? -1 : 1;
    offset = Math.min(maxOffset, Math.max(0, offset + direction * options.scrollRows));
  });
  const captureFrame = vi.fn(async () => windowOf(options.strip, offset));
  return { captureFrame, scroll, offsetNow: () => offset };
}

function longStrip(length: number): number[] {
  return Array.from({ length }, (_, index) => index);
}

describe("collectScrollFrames", () => {
  it("stops as soon as two consecutive captures are identical", async () => {
    const driver = createFakeDriver({ strip: longStrip(20), scrollRows: 6 });

    const collected = await collectScrollFrames(driver, { settleMs: 0, rewindToTop: false });

    // 20行 / 画面10行 / 1回6行進む → 0, 6, 10(下端) で止まる。4枚目は3枚目と同一。
    expect(collected.frames).toHaveLength(3);
    expect(collected.reachedBottom).toBe(true);
    expect(collected.truncatedAtCaptureLimit).toBe(false);
    expect(collected.didNotScroll).toBe(false);
  });

  it("reports a screen that does not scroll instead of looping", async () => {
    const driver = createFakeDriver({ strip: longStrip(HEIGHT), scrollRows: 0 });

    const collected = await collectScrollFrames(driver, { settleMs: 0, rewindToTop: false });

    expect(collected.frames).toHaveLength(1);
    expect(collected.didNotScroll).toBe(true);
    expect(collected.reachedBottom).toBe(true);
    expect(driver.scroll).toHaveBeenCalledTimes(1);
    expect(collected.notes.join("")).toContain("スクロール");
  });

  it("stops at the capture cap and says the content was truncated", async () => {
    const driver = createFakeDriver({ strip: longStrip(10_000), scrollRows: 6 });

    const collected = await collectScrollFrames(driver, { settleMs: 0, maxCaptures: 4 });

    expect(collected.frames).toHaveLength(4);
    expect(collected.truncatedAtCaptureLimit).toBe(true);
    expect(collected.reachedBottom).toBe(false);
    expect(collected.notes.join("")).toContain("4");
  });

  it("scrolls by slightly less than one viewport so consecutive frames overlap", async () => {
    const driver = createFakeDriver({ strip: longStrip(40), scrollRows: 6 });

    await collectScrollFrames(driver, { settleMs: 0, maxCaptures: 2 });

    expect(driver.scroll).toHaveBeenCalledWith(
      expect.objectContaining({
        distancePx: Math.round(HEIGHT * SCROLL_VIEWPORT_FRACTION),
        width: WIDTH,
        height: HEIGHT,
      }),
    );
    expect(SCROLL_VIEWPORT_FRACTION).toBeLessThan(1);
  });

  it("defaults the capture cap to the documented constant", async () => {
    const driver = createFakeDriver({ strip: longStrip(100_000), scrollRows: 6 });

    const collected = await collectScrollFrames(driver, { settleMs: 0, rewindToTop: false });

    expect(collected.frames).toHaveLength(MAX_SCROLL_CAPTURES);
    expect(collected.truncatedAtCaptureLimit).toBe(true);
  });

  it("rejects a driver whose frames change size mid-scroll", async () => {
    const frames = [frameFromRows(longStrip(HEIGHT)), frameFromRows(longStrip(HEIGHT - 2))];
    let index = 0;
    const driver = {
      captureFrame: vi.fn(async () => frames[Math.min(index++, frames.length - 1)]),
      scroll: vi.fn(async () => undefined),
    };

    await expect(collectScrollFrames(driver, { settleMs: 0 })).rejects.toThrow(/dimension/i);
  });
});

describe("collectScrollFrames 撮り始める前に上端へ戻す", () => {
  it("途中まで送られた画面でも、上端から撮り直す", async () => {
    const driver = createFakeDriver({ strip: longStrip(30), scrollRows: 6, initialOffset: 12 });

    const collected = await collectScrollFrames(driver, { settleMs: 0 });

    expect(collected.startedAtTop).toBe(true);
    // 1枚目が strip の先頭から始まっとる = 上端まで戻せとる。
    expect(collected.frames[0].data[0]).toBe(0);
    expect(collected.frames.length).toBeGreaterThan(1);
  });

  it("戻さん指定なら、今おる位置から撮る", async () => {
    const driver = createFakeDriver({ strip: longStrip(30), scrollRows: 6, initialOffset: 12 });

    const collected = await collectScrollFrames(driver, { settleMs: 0, rewindToTop: false });

    expect(collected.frames[0].data[0]).toBe(12);
  });

  it("戻し切れんかったら、その旨を残す", async () => {
    // 送り量より戻り量が小さいと、上限まで戻しても先頭に着かん画面を再現する。
    const driver = createFakeDriver({ strip: longStrip(400), scrollRows: 6, initialOffset: 390 });

    const collected = await collectScrollFrames(driver, {
      settleMs: 0,
      maxCaptures: 2,
    });

    expect(collected.startedAtTop).toBe(false);
    expect(collected.notes.join("")).toMatch(/上端/);
  });
});

describe("resolveViewport", () => {
  it("繋ぐ前の1画面を返す", () => {
    const first = frameFromRows([1, 2, 3]);
    expect(resolveViewport([first, frameFromRows([4, 5, 6])])).toBe(first);
  });

  it("1枚も無ければ落とす", () => {
    expect(() => resolveViewport([])).toThrow(/no frames/);
  });
});

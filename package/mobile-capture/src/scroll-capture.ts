import * as fs from "node:fs/promises";

import { resolveCaptureOutputPath } from "./path.js";
import {
  detectFixedBands,
  imagesNearlyIdentical,
  stitchScrollFrames,
  type RawImage,
} from "./stitch.js";

import type { CaptureDevice, DeviceCaptureProvider, DeviceScrollOptions } from "./types.js";

/**
 * 1回の比較で撮る上限枚数。
 *
 * 無限ループを防ぐための固い上限。ここで打ち切った場合は下端まで届いていないので、
 * 黙って短い画像を返さず truncatedAtCaptureLimit で呼び出し側へ伝える。
 */
export const MAX_SCROLL_CAPTURES = 20;

/**
 * 1回のスクロールで送る量（画面高に対する比）。
 *
 * 1画面ぶんちょうど送ると重なりが無くなり、繋ぎ目を検出できない。
 * 少なめに送って必ず重なりを残す。
 */
export const SCROLL_VIEWPORT_FRACTION = 0.6;

/** スクロール操作そのものにかける時間 (ms)。短いと慣性が付いて送り量が読めなくなる。 */
export const SCROLL_DURATION_MS = 600;

/** スクロール後、描画が落ち着くまでの待ち (ms)。 */
export const SCROLL_SETTLE_MS = 700;

export interface ScrollFrameDriver {
  captureFrame(): Promise<RawImage>;
  scroll(options: { distancePx: number; width: number; height: number }): Promise<void>;
}

export interface CollectScrollFramesOptions {
  maxCaptures?: number;
  settleMs?: number;
  /** 撮り始める前に上端まで戻すか。既定 true。 */
  rewindToTop?: boolean;
}

export interface CollectedScrollFrames {
  frames: RawImage[];
  /** 下端まで届いたか。上限で打ち切った場合は false。 */
  reachedBottom: boolean;
  truncatedAtCaptureLimit: boolean;
  /** 1回目のスクロールで画面が動かなかったか。スクロールしない画面の判定に使う。 */
  didNotScroll: boolean;
  /** 撮り始める前に上端まで戻せたか。戻せんかった場合、繋いだ画像は途中から始まる。 */
  startedAtTop: boolean;
  notes: string[];
}

/**
 * 繋ぐ前の1画面を返す。向きの判定と、見込みの重なりの計算に使う。
 * 撮影が1枚も返さんかった場合は、黙って空の結果を作らずに落とす。
 */
export function resolveViewport(frames: readonly RawImage[]): RawImage {
  const [first] = frames;
  if (first === undefined) {
    throw new Error("Scroll capture produced no frames.");
  }
  return first;
}

function assertSameSize(expected: RawImage, actual: RawImage): void {
  if (actual.width !== expected.width || actual.height !== expected.height) {
    throw new Error(
      `Scroll captures changed dimensions mid-scroll (${expected.width}x${expected.height} → ${actual.width}x${actual.height}). The screen rotated or a keyboard appeared.`,
    );
  }
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 下端に着くか上限に達するまで、スクロールしながら撮り続ける。
 *
 * 直前の1枚と画素まで同じものが返ってきた時点を下端とみなす。これは
 * 「もう送れない」と「そもそも送れない画面」の両方を拾うので、
 * 1枚目で起きた場合だけ didNotScroll として区別する。
 */
export async function collectScrollFrames(
  driver: ScrollFrameDriver,
  options: CollectScrollFramesOptions = {},
): Promise<CollectedScrollFrames> {
  const maxCaptures = Math.max(1, options.maxCaptures ?? MAX_SCROLL_CAPTURES);
  const settleMs = options.settleMs ?? SCROLL_SETTLE_MS;
  const notes: string[] = [];

  let firstFrame = await driver.captureFrame();
  const distancePx = Math.max(1, Math.round(firstFrame.height * SCROLL_VIEWPORT_FRACTION));

  // 撮り終わると端末は下端に居る。次にこの経路を通ると、その下端から
  // 撮り始めて「1回送っても変わらん＝下端」と読み、画面の下の一部だけを
  // 完全な1枚として返してしまう。撮る前に必ず上端まで戻す。
  let startedAtTop = true;
  if (options.rewindToTop !== false) {
    startedAtTop = false;
    for (let attempt = 0; attempt < maxCaptures; attempt++) {
      await driver.scroll({
        distancePx: -distancePx,
        width: firstFrame.width,
        height: firstFrame.height,
      });
      await delay(settleMs);
      const rewound = await driver.captureFrame();
      assertSameSize(firstFrame, rewound);
      const unchanged = imagesNearlyIdentical(rewound, firstFrame);
      firstFrame = rewound;
      if (unchanged) {
        startedAtTop = true;
        break;
      }
    }
    if (!startedAtTop) {
      notes.push(
        `上端まで戻し切れませんでした（${maxCaptures} 回さかのぼっても画面が変わり続けています）。繋いだ画像は画面の途中から始まっている可能性があります。`,
      );
    }
  }

  const frames: RawImage[] = [firstFrame];

  let reachedBottom = false;
  let didNotScroll = false;

  while (frames.length < maxCaptures) {
    await driver.scroll({ distancePx, width: firstFrame.width, height: firstFrame.height });
    await delay(settleMs);
    const frame = await driver.captureFrame();
    assertSameSize(firstFrame, frame);
    if (imagesNearlyIdentical(frame, frames[frames.length - 1])) {
      reachedBottom = true;
      if (frames.length === 1) {
        didNotScroll = true;
        notes.push(
          "1回スクロールしても画面が変わりませんでした。スクロールしない画面か、スクロール可能な領域の外を操作しています。1画面ぶんのスクショとして比較しています。",
        );
      }
      break;
    }
    frames.push(frame);
  }

  const truncatedAtCaptureLimit = !reachedBottom && frames.length >= maxCaptures;
  if (truncatedAtCaptureLimit) {
    notes.push(
      `撮影上限 ${maxCaptures} 枚で打ち切りました。画面の下端まで届いていないので、繋いだ画像はコンテンツの途中までです。`,
    );
  }

  return { frames, reachedBottom, truncatedAtCaptureLimit, didNotScroll, startedAtTop, notes };
}

export interface CaptureDeviceScrollOptions {
  device: CaptureDevice;
  outputDir?: string;
  maxCaptures?: number;
}

export interface ScrollCaptureOutcome {
  screenshotPath: string;
  captureCount: number;
  width: number;
  height: number;
  /** 繋ぐ前の1画面の寸法。向きの判定はこちらを使う。繋いだ後は必ず縦長になる。 */
  viewportWidth: number;
  viewportHeight: number;
  fixedHeaderHeight: number;
  fixedFooterHeight: number;
  reachedBottom: boolean;
  truncatedAtCaptureLimit: boolean;
  /** 1回送っても画面が変わらんかったか。1画面ぶんしか撮れとらんことを意味する。 */
  didNotScroll: boolean;
  /** 撮り始める前に上端まで戻せたか。 */
  startedAtTop: boolean;
  notes: string[];
}

/**
 * 端末をスクロールしながら撮り、1枚の縦長 PNG として書き出す。
 *
 * PNG の読み書きはこの層だけが持つ。繋ぐ処理と撮り続ける処理は生の RGBA で
 * 完結させてあるので、画像ライブラリ無しで検証できる。
 */
export async function captureDeviceScrollScreenshot(
  provider: DeviceCaptureProvider,
  options: CaptureDeviceScrollOptions,
): Promise<ScrollCaptureOutcome> {
  const sharp = (await import("sharp")).default;
  const framePaths: string[] = [];

  const driver: ScrollFrameDriver = {
    async captureFrame(): Promise<RawImage> {
      const framePath = await resolveCaptureOutputPath(options.device, options.outputDir);
      await provider.capture(framePath);
      framePaths.push(framePath);
      const { data, info } = await sharp(framePath)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      return { width: info.width, height: info.height, data: new Uint8Array(data) };
    },
    async scroll({ distancePx, width, height }): Promise<void> {
      const x = Math.round(width / 2);
      const fromY = Math.round(height / 2 + distancePx / 2);
      const toY = Math.round(height / 2 - distancePx / 2);
      const scrollOptions: DeviceScrollOptions = {
        x,
        fromY,
        toY,
        durationMs: SCROLL_DURATION_MS,
      };
      await provider.scroll(scrollOptions);
    },
  };

  const cleanupNotes: string[] = [];
  const removeFrameFiles = async (): Promise<void> => {
    // 繋いだ1枚だけを残す。素材を残すとキャッシュが撮影枚数ぶん膨らむ。
    // 途中で落ちた場合も必ずここを通す。消せんかったら黙らずに書き残す。
    const failures: string[] = [];
    await Promise.all(
      framePaths.map(async (framePath) => {
        try {
          await fs.rm(framePath, { force: true });
        } catch {
          failures.push(framePath);
        }
      }),
    );
    if (failures.length > 0) {
      cleanupNotes.push(
        `撮影の素材 ${failures.length} 件を消せませんでした: ${failures.join(", ")}`,
      );
    }
  };

  let collected: Awaited<ReturnType<typeof collectScrollFrames>>;
  let stitched: ReturnType<typeof stitchScrollFrames>;
  let outputPath: string;
  try {
    collected = await collectScrollFrames(driver, { maxCaptures: options.maxCaptures });
    // 見込みの重なりは、固定帯を除いた本文の高さから出す。画面全体から出すと、
    // ヘッダーとフッターのぶんだけ大きく見積もり、一様な行が続く画面で
    // 繋ぎ目が本文の高さぶんずれる。
    const bands = detectFixedBands(collected.frames);
    const first = resolveViewport(collected.frames);
    const bodyHeight = first.height - bands.headerHeight - bands.footerHeight;
    const advance = Math.round(first.height * SCROLL_VIEWPORT_FRACTION);
    stitched = stitchScrollFrames(collected.frames, {
      expectedOverlap: Math.max(1, bodyHeight - advance),
    });

    outputPath = await resolveCaptureOutputPath(options.device, options.outputDir);
    await sharp(stitched.image.data, {
      raw: { width: stitched.image.width, height: stitched.image.height, channels: 4 },
    })
      .png()
      .toFile(outputPath);
  } finally {
    await removeFrameFiles();
  }

  const viewport = resolveViewport(collected.frames);

  return {
    screenshotPath: outputPath,
    captureCount: collected.frames.length,
    width: stitched.image.width,
    height: stitched.image.height,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    fixedHeaderHeight: stitched.headerHeight,
    fixedFooterHeight: stitched.footerHeight,
    reachedBottom: collected.reachedBottom,
    truncatedAtCaptureLimit: collected.truncatedAtCaptureLimit,
    didNotScroll: collected.didNotScroll,
    startedAtTop: collected.startedAtTop,
    notes: [...collected.notes, ...stitched.notes, ...cleanupNotes],
  };
}

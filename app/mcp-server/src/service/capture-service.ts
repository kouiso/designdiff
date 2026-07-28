import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { type DomElementStyle, parseFrameTimestamps } from "@figdiff/shared";

import { getCaptureCacheDir } from "../util/figdiff-paths.js";

export interface CaptureOptions {
  width: number;
  height?: number;
  /**
   * 撮影直前に、実装が実際に使っている色・文字の値を DOM から採取する。
   * 画素を数える経路と違い、アンチエイリアスの影響を受けずに比べられる。
   */
  collectDomStyles?: boolean;
  /**
   * 動的コンテンツ検出のために2回撮る。時計・カウンタ・カルーセルのような
   * 撮るたびに変わる要素を、実装の誤りと切り分けるため。
   */
  detectDynamic?: boolean;
  /** 追加サンプル1枚ごとの待ち (ms)。既定 DEFAULT_DYNAMIC_SAMPLE_DELAY_MS。 */
  dynamicSampleDelayMs?: number;
  /** 追加で撮る枚数。既定 DEFAULT_DYNAMIC_SAMPLE_COUNT。 */
  dynamicSampleCount?: number;
  /**
   * 動きを確かめるために、指定した時刻で連続して撮る（ms、読み込み完了を0とする）。
   *
   * 指定した場合は、動きを止める指定を入れずに撮る。止めたままでは、
   * 動いている途中の見た目が原理的に1枚も写らんため。
   */
  frameTimestampsMs?: number[];
}

export interface CaptureResult {
  screenshotPath: string;
  width: number;
  height: number;
  /**
   * detectDynamic 指定時のみ。追加サンプルのパス一覧。
   * 突き合わせは呼び出し側 (画像を読む責務を持つ層) が行う。
   */
  dynamicSamplePaths?: string[];
  /** collectDomStyles 指定時のみ。採取に失敗した場合は undefined のまま。 */
  domStyles?: DomElementStyle[];
  /**
   * frameTimestampsMs 指定時のみ。指定した時刻ごとの撮影結果。
   *
   * actualAtMs は実際にその絵が表す時刻。巻き戻せる動きなら要求した時刻と一致する。
   * 実時間で待った場合は、撮影にかかった時間ぶん後ろへずれた実測値が入る。
   */
  framePaths?: { path: string; atMs: number; actualAtMs: number }[];
  /**
   * フレーム列の時刻をどうやって合わせたか。
   * seek=動きを止めてその時刻へ巻き戻した / wall-clock=実時間で待った。
   */
  frameTimeSource?: "seek" | "wall-clock";
}

/**
 * 採取する DOM 要素の上限。
 *
 * 上限が無いと巨大なページで数万件が返り、突合が現実的な時間で終わらない。
 * 打ち切った場合は未照合として正直に数えられるので、黙って劣化することはない。
 */
export const MAX_DOM_STYLE_ELEMENTS = 3_000;

/**
 * 既定の2回目撮影までの待ち時間 (ms)。
 *
 * 1秒境界を必ず跨ぐ長さにしている。1秒未満だと秒単位で更新される時計の
 * 「秒の桁」が2枚とも同じ値になり、ミリ秒の桁しかマスクされない。
 * 実測 (800px 幅の時計ページ): 700ms は覆う面積 3,072px、1,200ms は 6,912px。
 * 取りこぼした桁は毎回差分に出続けるので、自走ループが収束しなくなる。
 */
export const DEFAULT_DYNAMIC_SAMPLE_DELAY_MS = 1_200;

/**
 * 既定の追加サンプル枚数。
 *
 * 1枚だけだと「その間隔で動いた部分」しか取れない。更新周期の違う要素
 * (秒表示とミリ秒表示、数秒ごとに切り替わるカルーセル) を取りこぼす。
 * 2枚に増やして和を取ると、間隔の異なる2つの窓を見ることになる。
 */
export const DEFAULT_DYNAMIC_SAMPLE_COUNT = 2;

export function getCaptureDir(): string {
  return getCaptureCacheDir();
}

/**
 * ブラウザ側で実行され、見た目に関わる要素だけを拾って返す。
 *
 * この関数の中身は文字列化されてブラウザへ送られるため、外側の変数を掴めない。
 * 上限は引数で渡す。文字も背景色も持たない要素は、比べる値が無いので落とす。
 */
function harvestDomStyles(maxElements: number): DomElementStyle[] {
  const collected: DomElementStyle[] = [];
  for (const element of document.querySelectorAll("*")) {
    if (collected.length >= maxElements) break;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const style = window.getComputedStyle(element);
    if (style.visibility === "hidden" || style.display === "none") continue;
    if (Number(style.opacity) === 0) continue;

    // 直接の子テキストだけを見る。子孫のテキストまで数えると、同じ文字列が
    // 祖先の要素にも計上され、1つの文字に対して何重にも突合が走る。
    let ownText = "";
    for (const child of element.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) ownText += child.nodeValue ?? "";
    }
    ownText = ownText.replace(/\s+/g, " ").trim();

    const background = style.backgroundColor;
    const hasBackground =
      background !== "" &&
      background !== "transparent" &&
      !background.startsWith("rgba(0, 0, 0, 0");
    if (ownText === "" && !hasBackground) continue;

    const entry: DomElementStyle = {
      tag: element.tagName.toLowerCase(),
      x: Math.round(rect.left + window.scrollX),
      y: Math.round(rect.top + window.scrollY),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
    if (ownText !== "") {
      entry.text = ownText.slice(0, 60);
      entry.color = style.color;
      const fontSize = Number.parseFloat(style.fontSize);
      if (Number.isFinite(fontSize)) entry.fontSize = fontSize;
      const fontWeight = Number.parseFloat(style.fontWeight);
      if (Number.isFinite(fontWeight)) entry.fontWeight = fontWeight;
      entry.fontFamily = style.fontFamily;
      const lineHeight = Number.parseFloat(style.lineHeight);
      if (Number.isFinite(lineHeight)) entry.lineHeight = lineHeight;
      const letterSpacing = Number.parseFloat(style.letterSpacing);
      if (Number.isFinite(letterSpacing)) entry.letterSpacing = letterSpacing;
    }
    if (hasBackground) entry.backgroundColor = background;
    collected.push(entry);
  }
  return collected;
}

/**
 * Capture a URL as a full-page PNG screenshot with fidelity guarantees:
 * - waitUntil: "networkidle" — deferred images and web fonts fully loaded
 * - document.fonts.ready — font-face rendering complete before screenshot
 * - animation/transition CSS zeroed — non-deterministic diff prevention
 * - fullPage: true
 *
 * Requires `@playwright/test` installed and `playwright install chromium` run once.
 *
 * When env FIGDIFF_CDP_ENDPOINT is set, connects to an existing Chrome via CDP
 * instead of launching a new browser. Useful in WSL/sandbox where localhost
 * on the MCP server side cannot reach the host dev server.
 */
export async function captureUrl(url: string, options: CaptureOptions): Promise<CaptureResult> {
  const loadPw = async () => {
    try {
      return await import("@playwright/test");
    } catch {
      throw new Error(
        "Playwright is not installed. Run: pnpm add -D @playwright/test && npx playwright install chromium",
      );
    }
  };

  const cdpEndpoint = process.env.FIGDIFF_CDP_ENDPOINT?.trim();

  const pw = await loadPw();

  const captureDir = getCaptureDir();
  await fs.mkdir(captureDir, { recursive: true });

  const id = crypto.randomUUID();
  const screenshotPath = path.join(captureDir, `capture-${id}.png`);

  type PwPage = Awaited<ReturnType<Awaited<ReturnType<typeof pw.chromium.launch>>["newPage"]>>;

  const takeScreenshot = async (page: PwPage): Promise<CaptureResult> => {
    await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);

    // 動きを止めると、撮るたびに同じ絵になって差分が安定する。ただしフレーム列を
    // 撮るときだけは止めん。止めたままでは、動いている途中の見た目が1枚も写らん。
    const capturesFrameSequence =
      options.frameTimestampsMs !== undefined && options.frameTimestampsMs.length > 0;
    if (!capturesFrameSequence) {
      await page.addStyleTag({
        content:
          "*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important;}",
      });
    }

    // fullPage:true は要求された幅を無視し、DOMのscrollHeightはレイアウト領域を
    // 過小報告する（ビューポート高で止まる）ことがあるため、測定とキャプチャの
    // 両方をCDP経由で行う。captureBeyondViewportによりビューポート外も取得できる。
    // 採取は撮影前に行う。撮影後だと遅延読み込みや再レイアウトで、
    // 画像に写っている値と採取した値がずれる可能性がある。
    let domStyles: DomElementStyle[] | undefined;
    if (options.collectDomStyles === true) {
      try {
        domStyles = await page.evaluate(harvestDomStyles, MAX_DOM_STYLE_ELEMENTS);
      } catch (error) {
        // 採取に失敗しても撮影自体は続ける。画素経路だけで判定できる。
        console.warn(
          `[capture] DOM スタイルの採取に失敗しました: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const client = await page.context().newCDPSession(page);
    let contentHeight: number;
    let dynamicSamplePaths: string[] | undefined;
    let framePaths: { path: string; atMs: number; actualAtMs: number }[] | undefined;
    let frameTimeSource: "seek" | "wall-clock" | undefined;
    try {
      if (!(options.width > 0)) {
        throw new Error(`キャプチャ幅が不正です (width=${options.width})。`);
      }
      const metrics = await client.send("Page.getLayoutMetrics");
      const rawHeight = metrics?.contentSize?.height;
      if (typeof rawHeight !== "number" || !Number.isFinite(rawHeight) || rawHeight <= 0) {
        throw new Error(
          `CDP Page.getLayoutMetrics returned invalid contentSize height: ${String(rawHeight)}`,
        );
      }
      contentHeight = Math.ceil(rawHeight);

      const shootTo = async (outPath: string): Promise<void> => {
        const shot = await client.send("Page.captureScreenshot", {
          format: "png",
          clip: { x: 0, y: 0, width: options.width, height: contentHeight, scale: 1 },
          captureBeyondViewport: true,
        });
        if (!shot?.data) {
          throw new Error("CDP Page.captureScreenshot did not return image data");
        }
        await fs.writeFile(outPath, Buffer.from(shot.data, "base64"));
      };

      if (capturesFrameSequence) {
        const timestamps = parseFrameTimestamps(options.frameTimestampsMs ?? []);

        // 動きを止めて、任意の時刻へ巻き戻せるかを先に見る。巻き戻せるなら、
        // 待たずにその時刻の絵を出せるので、撮影にかかった時間のぶんズレる問題が
        // そもそも起きん。ページの読み込みを待つ間に動きが終わっとっても、
        // 0へ戻してから撮れる。
        const seekable = await page.evaluate(() => {
          const animations = document.getAnimations();
          if (animations.length === 0) return false;
          for (const animation of animations) animation.pause();
          return true;
        });

        const frames: { path: string; atMs: number; actualAtMs: number }[] = [];
        const startedAt = Date.now();
        for (const [index, atMs] of timestamps.entries()) {
          let actualAtMs = atMs;
          if (seekable) {
            await page.evaluate((target: number) => {
              for (const animation of document.getAnimations()) animation.currentTime = target;
            }, atMs);
          } else {
            // 巻き戻せん動き（描画を自前で回しとる画面など）は、実時間で待つしかない。
            // 撮影自体にも時間がかかるので、待ちは開始時刻からの残りで計算し、
            // 実際に撮れた時刻をそのまま記録する。要求した時刻を名乗ると、
            // 測ったズレが撮影の遅れなのか実装の遅れなのか分からんようになる。
            const remaining = atMs - (Date.now() - startedAt);
            if (remaining > 0) await page.waitForTimeout(remaining);
            actualAtMs = Date.now() - startedAt;
          }
          // 1枚目だけは既存の戻り値と同じ場所へ置く。呼び出し側が1枚だけを
          // 見る経路（従来の比較）と、そのまま繋がる形にするため。
          const framePath =
            index === 0 ? screenshotPath : path.join(captureDir, `capture-${id}-frame-${atMs}.png`);
          await shootTo(framePath);
          frames.push({ path: framePath, atMs, actualAtMs });
        }
        framePaths = frames;
        frameTimeSource = seekable ? "seek" : "wall-clock";
      } else {
        await shootTo(screenshotPath);
      }

      if (options.detectDynamic === true) {
        // 同じページ・同じレイアウトのまま少し待ってもう一度撮る。
        // 遷移し直すと広告やレイアウトごと変わり、動的要素の切り分けにならない。
        const delay = options.dynamicSampleDelayMs ?? DEFAULT_DYNAMIC_SAMPLE_DELAY_MS;
        const sampleCount = options.dynamicSampleCount ?? DEFAULT_DYNAMIC_SAMPLE_COUNT;
        const paths: string[] = [];
        for (let i = 0; i < sampleCount; i++) {
          await page.waitForTimeout(delay);
          const samplePath = path.join(captureDir, `capture-${id}-sample-${i}.png`);
          await shootTo(samplePath);
          paths.push(samplePath);
        }
        dynamicSamplePaths = paths.length > 0 ? paths : undefined;
      }
    } finally {
      await client.detach();
    }

    return {
      screenshotPath,
      width: options.width,
      height: contentHeight,
      dynamicSamplePaths,
      domStyles,
      framePaths,
      frameTimeSource,
    };
  };

  if (cdpEndpoint === undefined) {
    const browser = await pw.chromium.launch();
    try {
      const context = await browser.newContext({
        viewport: { width: options.width, height: options.height ?? 1200 },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      const result = await takeScreenshot(page);
      await context.close();
      return result;
    } finally {
      await browser.close();
    }
  }

  let browser: Awaited<ReturnType<typeof pw.chromium.connectOverCDP>>;
  try {
    browser = await pw.chromium.connectOverCDP(cdpEndpoint);
  } catch (cause) {
    throw new Error(
      `FIGDIFF_CDP_ENDPOINT(=${cdpEndpoint})のChromeに接続できません。ホストで\`chrome --remote-debugging-port=9222\`を起動し、サンドボックスから到達可能なアドレスをFIGDIFF_CDP_ENDPOINTに指定してください。到達できない場合は事前に撮影したPNGを\`screenshot\`引数で渡してください。`,
      { cause },
    );
  }

  const context = await browser.newContext({
    viewport: { width: options.width, height: options.height ?? 1200 },
    deviceScaleFactor: 1,
  });
  try {
    const page = await context.newPage();
    const result = await takeScreenshot(page);
    await context.close();
    return result;
  } catch (error) {
    await context.close();
    throw error;
  } finally {
    await browser.close();
  }
}

// X07 前の「検証ページが描画済みか」の判定を、adb 撮影ループから切り離した
// 純関数にしたもの (#388)。画面サイズ非依存にするため標本「数」ではなく
// 標本の「比率」で見る — 320x640 では全標本が 200 個未満しか取れず、
// 固定数閾値 (colored > 200) では描画済みでも永久に未描画と誤判定する
// 実害があった。あわせて既知 fixture (8色縞 + #111 暗帯) の色と構成比を
// 使い、ブラウザ起動画面・白紙・エラーページを描画済みと取り違えない。

import sharp from "sharp";

import { STRIPE_COLORS } from "./stripe-stitch-oracle.mjs";

// 検証ページの縞間の暗帯色。ドライバの tallHtml と揃える。
const DARK_BAND = [0x11, 0x11, 0x11];
const COLOR_DISTANCE = 60;
// 1検体あたりの標本数の目安。画素数から間引き間隔を決めて揃える。
const TARGET_SAMPLES = 4096;
// 描画済み fixture は色帯と暗帯がページ領域をほぼ埋める。ブラウザ UI や
// ステータスバーで 3〜4 割欠けても余裕を持って超える比率を閾値にする。
const MIN_STRIPE_RATIO = 0.15;
const MIN_FIXTURE_RATIO = 0.4;
// fixture 以外のページ (ANDROID_PAGE_URL 指定時) では縞色を当てにできない
// ので、彩色標本の比率だけで判定する。
const MIN_CHROMATIC_RATIO = 0.2;

const distanceTo = (r, g, b, [cr, cg, cb]) =>
  Math.max(Math.abs(r - cr), Math.abs(g - cg), Math.abs(b - cb));

/**
 * @param {Buffer|Uint8Array} data sharp .raw() の画素列 (先頭3chを読む)
 * @param {{width:number,height:number,channels:number}} info
 * @param {{fixturePage?:boolean}} options 既定は縞 fixture 前提の判定
 */
export const judgePageRender = (data, info, { fixturePage = true } = {}) => {
  const pixels = info.width * info.height;
  const stride = Math.max(1, Math.floor(pixels / TARGET_SAMPLES));
  let sampleCount = 0;
  let stripe = 0;
  let darkBand = 0;
  let chromatic = 0;
  const stripeColorsSeen = new Set();
  for (let p = 0; p < pixels; p += stride) {
    const i = p * info.channels;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    sampleCount += 1;
    if (Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b)) > 60) chromatic += 1;
    if (distanceTo(r, g, b, DARK_BAND) <= COLOR_DISTANCE) {
      darkBand += 1;
      continue;
    }
    for (let id = 0; id < STRIPE_COLORS.length; id += 1) {
      if (distanceTo(r, g, b, STRIPE_COLORS[id]) <= COLOR_DISTANCE) {
        stripe += 1;
        stripeColorsSeen.add(id);
        break;
      }
    }
  }
  const stripeRatio = stripe / sampleCount;
  const fixtureRatio = (stripe + darkBand) / sampleCount;
  const chromaticRatio = chromatic / sampleCount;
  const base = {
    sampleCount,
    stripeRatio,
    fixtureRatio,
    chromaticRatio,
    stripeColorsSeen: stripeColorsSeen.size,
  };
  if (fixturePage) {
    const rendered = stripeRatio >= MIN_STRIPE_RATIO && fixtureRatio >= MIN_FIXTURE_RATIO;
    return {
      ...base,
      rendered,
      reason: rendered
        ? "stripe fixture colors fill the content area"
        : `stripeRatio ${stripeRatio.toFixed(3)} / fixtureRatio ${fixtureRatio.toFixed(3)} below threshold`,
    };
  }
  const rendered = chromaticRatio >= MIN_CHROMATIC_RATIO;
  return {
    ...base,
    rendered,
    reason: rendered
      ? "chromatic samples fill the content area"
      : `chromaticRatio ${chromaticRatio.toFixed(3)} below threshold`,
  };
};

/**
 * captureScreen が返す PNG を期限まで繰り返し検査し、描画を確認する。
 * 未描画のまま終わった場合でも、最後の検体・標本数・理由を返すので
 * 呼び出し側が証跡として保存できる。
 */
export const waitForPageRender = async ({
  captureScreen,
  fixturePage = true,
  deadlineMs = 60_000,
  intervalMs = 2_000,
}) => {
  const deadline = Date.now() + deadlineMs;
  let attempts = 0;
  let judgment = null;
  let lastShot = null;
  while (Date.now() < deadline) {
    attempts += 1;
    lastShot = await captureScreen();
    const { data, info } = await sharp(lastShot).raw().toBuffer({ resolveWithObject: true });
    judgment = judgePageRender(data, info, { fixturePage });
    if (judgment.rendered) return { rendered: true, attempts, lastShot, ...judgment };
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return {
    rendered: false,
    attempts,
    lastShot,
    ...(judgment ?? { reason: "deadline elapsed before the first capture" }),
  };
};

// 描画未確認のまま capture_scroll へ進ませないための門。進めない時の
// 記録形をここで決めることで、描画待ちの失敗と X07 (製品の結合検証) の
// 失敗が evidence 上で混ざらないようにする。
export const x07ScrollGate = (wait) =>
  wait.rendered
    ? { proceed: true }
    : {
        proceed: false,
        record: {
          status: "NOT_RUN",
          note: "page render was not confirmed; scroll capture skipped (see pageRenderWait)",
        },
      };

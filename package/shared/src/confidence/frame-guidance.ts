// フレーム選択ガイダンス: Figma URL に node-id が無い / frame_name が曖昧 /
// 空白フレームを選んだとき、フラットな羅列ではなく「実コンテンツらしいフレーム」を
// 上位に提示するための純粋関数。
//
// getFrames は depth=1 で取得するため各フレームの子要素数は信頼できない。
// 代わりに最も信頼できる手掛かりである「幅の一致」(撮影対象と同じ幅のフレームが
// ほぼ常に正解) と、ページらしい縦横比を使ってランク付けする。

import type { Frame } from "../type.js";

export interface RankedFrame {
  id: string;
  name: string;
  width: number;
  height: number;
  matchesWidth: boolean;
  aspectRatioDistance?: number;
  reason: string;
}

const WIDTH_MATCH_TOLERANCE_PX = 2;
// 横長すぎるフレームは概観ボード (サムネイル並べ) の可能性が高い。
const WIDE_BOARD_RATIO = 3;
// これより小さい面積は実ページとしては小さすぎる。
const TINY_AREA = 200 * 200;
// スコアリングの重み。撮影幅一致を支配的にし、形状ヒントで微調整する意図でこの大小関係にしている。
const WIDTH_MATCH_SCORE_BONUS = 1000;
const WIDE_BOARD_PENALTY = 100;
const TALL_PAGE_BONUS = 50;
const TINY_AREA_PENALTY = 50;
const ASPECT_RATIO_SCORE_WEIGHT = 220;
const WILD_ASPECT_RATIO_DISTANCE = 0.35;
const WILD_ASPECT_RATIO_PENALTY = 950;

interface ScoredFrame {
  frame: Frame;
  score: number;
  matchesWidth: boolean;
  aspectRatioDistance?: number;
  reason: string;
}

function scoreFrame(frame: Frame, targetWidth?: number, targetHeight?: number): ScoredFrame {
  const reasons: string[] = [];
  let score = 0;

  const matchesWidth =
    typeof targetWidth === "number" &&
    targetWidth > 0 &&
    Math.abs(frame.width - targetWidth) <= WIDTH_MATCH_TOLERANCE_PX;
  if (matchesWidth) {
    score += WIDTH_MATCH_SCORE_BONUS;
    reasons.push(`幅${targetWidth}px一致`);
  }

  const ratio = frame.height > 0 ? frame.width / frame.height : Number.POSITIVE_INFINITY;
  if (ratio > WIDE_BOARD_RATIO) {
    score -= WIDE_BOARD_PENALTY;
    reasons.push("横長: 概観ボードの可能性");
  } else if (frame.height >= frame.width) {
    score += TALL_PAGE_BONUS;
    reasons.push("縦長ページ");
  }

  let aspectRatioDistance: number | undefined;
  if (
    typeof targetWidth === "number" &&
    targetWidth > 0 &&
    typeof targetHeight === "number" &&
    targetHeight > 0 &&
    frame.width > 0 &&
    frame.height > 0
  ) {
    const targetRatio = targetWidth / targetHeight;
    const frameRatio = frame.width / frame.height;
    aspectRatioDistance = Math.abs(Math.log(frameRatio / targetRatio));
    score -= aspectRatioDistance * ASPECT_RATIO_SCORE_WEIGHT;
    if (aspectRatioDistance >= WILD_ASPECT_RATIO_DISTANCE) {
      score -= WILD_ASPECT_RATIO_PENALTY;
      reasons.push("縦横比が撮影画像と大きく不一致");
    } else {
      reasons.push("縦横比が近い");
    }
  }

  if (frame.width * frame.height < TINY_AREA) {
    score -= TINY_AREA_PENALTY;
    reasons.push("小サイズ");
  }

  return {
    frame,
    score,
    matchesWidth,
    aspectRatioDistance,
    reason: reasons.length > 0 ? reasons.join("・") : "通常フレーム",
  };
}

export function rankFrameCandidates(
  frames: Frame[],
  targetWidth?: number,
  targetHeight?: number,
): RankedFrame[] {
  return frames
    .map((frame, index) => ({ scored: scoreFrame(frame, targetWidth, targetHeight), index }))
    .sort((a, b) => {
      if (b.scored.score !== a.scored.score) {
        return b.scored.score - a.scored.score;
      }
      // 同点は元の順序を保つ (安定ソート)。
      return a.index - b.index;
    })
    .map(({ scored }) => ({
      id: scored.frame.id,
      name: scored.frame.name,
      width: scored.frame.width,
      height: scored.frame.height,
      matchesWidth: scored.matchesWidth,
      aspectRatioDistance: scored.aspectRatioDistance,
      reason: scored.reason,
    }));
}

export function formatFrameCandidates(ranked: RankedFrame[], targetWidth?: number): string {
  if (ranked.length === 0) {
    return "利用可能なフレームがありません。";
  }
  const header =
    typeof targetWidth === "number" && targetWidth > 0
      ? `利用可能なフレーム（撮影幅 ${targetWidth}px に一致するものを優先表示）:`
      : "利用可能なフレーム:";
  const lines = ranked.map((frame, index) => {
    const marker = index === 0 ? "★" : "-";
    return `${marker} ${frame.name} (${frame.id}, ${frame.width}x${frame.height}) — ${frame.reason}`;
  });
  return [header, ...lines].join("\n");
}

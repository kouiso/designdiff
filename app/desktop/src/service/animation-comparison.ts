import {
  type AnimationCompareResult,
  parseFrameTimestamps,
  runAnimationCompare,
} from "@figdiff/shared";

import { compareImages } from "./image-compare";

export interface DesktopAnimationFrame {
  image: string;
  atMs: number;
}

export interface DesktopAnimationInput {
  designFrames: DesktopAnimationFrame[];
  implFrames: DesktopAnimationFrame[];
  driftWindowMs?: number;
  driftFailMs?: number;
}

export async function compareAnimationImages(
  input: DesktopAnimationInput,
): Promise<AnimationCompareResult> {
  parseFrameTimestamps(input.designFrames.map((frame) => frame.atMs));
  parseFrameTimestamps(input.implFrames.map((frame) => frame.atMs));
  for (const value of [input.driftWindowMs, input.driftFailMs]) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      throw new Error("時間差の範囲は0以上の有限値で指定してください。");
    }
  }
  const sources = new Map<string, string>();
  const indexFrames = (frames: DesktopAnimationFrame[], prefix: string) =>
    frames.map((frame, index) => {
      if (frame.image.trim().length === 0) {
        throw new Error("比較するフレームの画像がありません。");
      }
      const path = `${prefix}:${index}`;
      sources.set(path, frame.image);
      return { path, atMs: frame.atMs };
    });
  const designFrames = indexFrames(input.designFrames, "design");
  const implFrames = indexFrames(input.implFrames, "implementation");
  const designSource = designFrames[0]?.path;
  if (!designSource) throw new Error("設計側のフレームがありません。");

  const result = await runAnimationCompare(
    {
      designSource,
      designFrames: designFrames.length > 1 ? designFrames : undefined,
      implFrames,
      driftWindowMs: input.driftWindowMs,
      driftFailMs: input.driftFailMs,
    },
    async (designId, implementationId) => {
      const designImage = sources.get(designId);
      const screenshotImage = sources.get(implementationId);
      if (!designImage || !screenshotImage) {
        throw new Error("比較対象のフレームを読み込めません。");
      }
      const result = await compareImages({ designImage, screenshotImage });
      const verdict = result.diffReport?.aggregateVerdict;
      return {
        status: verdict === "pass" ? "PASS" : verdict === "fail" ? "FAIL" : "UNCERTAIN",
        // 静止画の百分率を時系列比較の0〜1契約へ合わせる。
        matchRate: result.matchRate / 100,
        comparisonId: result.comparisonId,
        diffImagePath: result.diffImageBase64,
      };
    },
  );
  // renderer内のフレームIDは実ファイルの証跡パスではない。
  return { ...result, evidencePaths: [] };
}

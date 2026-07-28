/**
 * compare_animation — 時間で並んだフレーム列どうしを比べる。
 *
 * compare_design は1枚しか受け取らんので、動きの途中の見た目を確かめられん。
 * URL から撮る経路では動きを止める指定まで入れとるため、途中の状態は原理的に
 * 1枚も写らんかった。ここでは動きを止めずに、指定した時刻ごとに撮って比べる。
 */

import { z } from "zod";

import {
  CompareAnimationResultSchema,
  IgnoreRegionSchema,
  parseFrameTimestamps,
} from "@figdiff/shared";

import {
  type AnimationCompareResult,
  type CompareOneFrame,
  type TimedImage,
  runAnimationCompare,
} from "../service/animation-compare-service.js";
import { captureUrl } from "../service/capture-service.js";
import { runCompareDesign } from "../service/compare-design-runner.js";
import { resolveScreenshotInputPath } from "../util/path-guard.js";
import { assertNoUnknownToolArguments } from "../util/raw-tool-arguments.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const DESCRIPTION = `動きのあるUIを、時間で並んだ複数の絵として比べる。

使い分け:
- 実装をその場で撮る: screenshot_url と capture_frames_ms を渡す。指定した時刻ごとに撮る。動きは止めん。
- すでに撮ってある: screenshot_frames に {path, at_ms} を並べて渡す。
- 動きの速さのズレまで測る: design_frames に時刻つきの設計画像を並べる。設計が1枚だけの場合、
  早い・遅いを言う基準が無いので、時刻のズレは測らずその理由を返す。`;

const TimedImageSchema = z.object({
  path: z.string().describe("画像のローカルパス"),
  at_ms: z.number().int().nonnegative().describe("その絵の時刻（ms、開始を0とする）"),
});

async function resolveTimedImages(
  entries: readonly { path: string; at_ms: number }[],
  label: string,
): Promise<TimedImage[]> {
  const timestamps = parseFrameTimestamps(entries.map((entry) => entry.at_ms));
  const resolved: TimedImage[] = [];
  for (const [index, entry] of entries.entries()) {
    const path = await resolveScreenshotInputPath(entry.path);
    resolved.push({ path, atMs: timestamps[index] });
  }
  if (resolved.length === 0) throw new Error(`${label} が空です。`);
  return resolved;
}

function buildSummary(result: AnimationCompareResult): string {
  const lines: string[] = [];
  lines.push(`動き全体の判定: ${result.temporal.status} — ${result.temporal.rationale}`);
  if (result.frameTimeSource === "wall-clock") {
    lines.push(
      "注意: この画面の動きは巻き戻せんかったので、実時間で待って撮っとる。撮影にかかった時間ぶんの誤差が時刻に乗る。",
    );
  }
  lines.push("");
  lines.push("フレームごとの結果:");
  for (const frame of result.frames) {
    lines.push(
      `  ${frame.atMs}ms: ${frame.status} 一致 ${(frame.matchRate * 100).toFixed(2)}% (${frame.screenshotPath})`,
    );
  }
  if (result.driftMeasured) {
    lines.push("");
    lines.push("時刻のズレ:");
    for (const alignment of result.alignments) {
      lines.push(
        alignment.matchedAtMs === null
          ? `  設計 ${alignment.designAtMs}ms: 対応づかん（${alignment.reason ?? "理由不明"}）`
          : `  設計 ${alignment.designAtMs}ms → 実装 ${alignment.matchedAtMs}ms（差 ${alignment.driftMs}ms）`,
      );
    }
  } else if (result.driftUnmeasuredReason !== undefined) {
    lines.push("");
    lines.push(`時刻のズレは測っていない: ${result.driftUnmeasuredReason}`);
  }
  return lines.join("\n");
}

export function registerCompareAnimation(server: McpServer): void {
  const inputSchema = {
    design_source: z
      .string()
      .describe("Figma の URL、またはデザイン画像のローカルパス。design_frames を渡す場合も必須。"),
    design_frames: z
      .array(TimedImageSchema)
      .optional()
      .describe("時刻つきの設計画像。渡すと動きの速さのズレまで測れる。"),
    screenshot_frames: z
      .array(TimedImageSchema)
      .optional()
      .describe("すでに撮ってある実装側の絵。screenshot_url と同時には使えん。"),
    screenshot_url: z
      .string()
      .url()
      .optional()
      .describe("撮影対象のURL。capture_frames_ms と一緒に渡す。動きは止めずに撮る。"),
    capture_frames_ms: z
      .array(z.number().int().nonnegative())
      .optional()
      .describe("撮る時刻（ms、読み込み完了を0とする）。小さい順、重複なし。"),
    capture_width: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("撮影幅(px)。screenshot_url 指定時のみ有効。既定 1280。"),
    drift_window_ms: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe("設計の各時刻に対して、実装側のどこまでを見に行くか（ms）。既定 500。"),
    drift_fail_ms: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe("ここを超えるズレを不合格にする（ms）。既定 120。"),
    frame_name: z.string().optional().describe("Figma URL に node-id が無い場合のフレーム名"),
    threshold: z.number().min(0).max(1).optional().describe("色差の許容閾値（0-1）"),
    profile: z
      .enum(["strict", "balanced", "layout"])
      .optional()
      .describe("比較プロファイル。compare_design と同じ意味。"),
    project_id: z
      .string()
      .regex(/^[a-zA-Z0-9_-]+$/, "Project ID must be alphanumeric with hyphens/underscores only")
      .optional()
      .describe("保存済み設定を引くプロジェクトID"),
    ignore_regions: z.array(IgnoreRegionSchema).optional().describe("意図的差分マスク"),
    design_background: z
      .string()
      .regex(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "design_background must be a hex color")
      .optional()
      .describe("背景の塗りが無い設計を、どの色の上に置いて評価するか"),
  };

  server.registerTool(
    "compare_animation",
    {
      description: DESCRIPTION,
      inputSchema,
      outputSchema: CompareAnimationResultSchema,
    },
    async (args, extra) => {
      try {
        assertNoUnknownToolArguments("compare_animation", Object.keys(inputSchema), extra);

        if (args.screenshot_frames !== undefined && args.screenshot_url !== undefined) {
          throw new Error(
            "screenshot_frames と screenshot_url は同時に指定できません。どちらか一方にしてください。",
          );
        }

        let implFrames: TimedImage[];
        let frameTimeSource: "seek" | "wall-clock" | undefined;
        if (args.screenshot_frames !== undefined) {
          implFrames = await resolveTimedImages(args.screenshot_frames, "screenshot_frames");
        } else if (args.screenshot_url !== undefined) {
          if (args.capture_frames_ms === undefined) {
            throw new Error("screenshot_url を使う場合は capture_frames_ms も指定してください。");
          }
          const timestamps = parseFrameTimestamps(args.capture_frames_ms);
          const capture = await captureUrl(args.screenshot_url, {
            width: args.capture_width ?? 1280,
            frameTimestampsMs: timestamps,
          });
          if (capture.framePaths === undefined || capture.framePaths.length === 0) {
            throw new Error("撮影は成功しましたが、フレームが1枚も返りませんでした。");
          }
          // 実際にその絵が表す時刻を使う。要求した時刻をそのまま名乗ると、
          // 測ったズレが撮影の遅れなのか実装の遅れなのか分からんようになる。
          implFrames = capture.framePaths.map((frame) => ({
            path: frame.path,
            atMs: frame.actualAtMs,
          }));
          frameTimeSource = capture.frameTimeSource;
        } else {
          throw new Error(
            "実装側の絵がありません。screenshot_frames か、screenshot_url と capture_frames_ms を指定してください。",
          );
        }

        const designFrames =
          args.design_frames === undefined
            ? undefined
            : await resolveTimedImages(args.design_frames, "design_frames");

        const compareOne: CompareOneFrame = async (designSource, screenshotPath) => {
          const comparison = await runCompareDesign({
            design_source: designSource,
            screenshot: screenshotPath,
            frame_name: args.frame_name,
            threshold: args.threshold,
            profile: args.profile,
            project_id: args.project_id,
            ignore_regions: args.ignore_regions,
            design_background: args.design_background,
          });
          return {
            status: comparison.result.status ?? "UNCERTAIN",
            matchRate: comparison.result.matchRate,
            comparisonId: comparison.result.comparisonId,
            diffImagePath: comparison.result.diffImagePath,
          };
        };

        const result = await runAnimationCompare(
          {
            designSource: args.design_source,
            designFrames,
            implFrames,
            driftWindowMs: args.drift_window_ms,
            driftFailMs: args.drift_fail_ms,
            frameTimeSource,
          },
          compareOne,
        );

        const structured = CompareAnimationResultSchema.parse(result);
        return {
          content: [
            { type: "text", text: JSON.stringify(structured, null, 2) },
            { type: "text", text: buildSummary(result) },
          ],
          structuredContent: structured,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  );
}

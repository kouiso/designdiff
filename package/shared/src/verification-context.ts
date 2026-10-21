import { z } from "zod";

import { ComparisonConditionsInputSchema } from "./comparison-conditions.js";

const RectangleSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
  })
  .strict();

const MaskRegionSchema = RectangleSchema.extend({ label: z.string().optional() }).strict();
const CanvasSchema = z
  .object({ width: z.number().int().positive(), height: z.number().int().positive() })
  .strict();
const CoordinateContextSchema = z
  .object({
    canvas_width: z.number().int().positive(),
    canvas_height: z.number().int().positive(),
    design_original_width: z.number().int().positive(),
    design_original_height: z.number().int().positive(),
    screenshot_original_width: z.number().int().positive(),
    screenshot_original_height: z.number().int().positive(),
    crop_region: RectangleSchema.optional(),
  })
  .strict();

export const VerificationContextPayloadSchema = z
  .object({
    version: z.literal(1),
    design: z
      .object({
        sourceIdentitySha256: z.string().regex(/^[0-9a-f]{64}$/),
        imageSha256: z.string().regex(/^[0-9a-f]{64}$/),
        background: z.string().regex(/^#[0-9A-F]{6}$/),
        // design_background を明示したか。省略時は contents_only 書き出しの完全透明
        // 画素を採点から外す契約になるため、verify_fix の再現では両者を区別する。
        // 旧履歴にこの鍵は無く、当時の省略は白敷き採点 (=明示) だった。
        backgroundExplicit: z.boolean().optional(),
        figmaExportConditions: z
          .object({
            contentsOnly: z.boolean(),
            useAbsoluteBounds: z.boolean(),
            scale: z.number().finite().positive(),
            version: z.string().optional(),
          })
          .strict()
          .nullable(),
      })
      .strict(),
    comparison: z
      .object({
        effectiveThreshold: z.number().finite().min(0).max(1),
        profile: z.enum(["strict", "balanced", "layout"]).nullable(),
        declaredConditions: ComparisonConditionsInputSchema,
        // 撮影範囲は画像の寸法だけから復元できないため、再検証へ引き継ぐ。
        screenshotSingleViewport: z.literal(true).optional(),
        geometry: z
          .object({
            designNativeWidth: z.number().int().nonnegative(),
            designNativeHeight: z.number().int().nonnegative(),
            // 実装内容の修正で変わる高さ・contain倍率は比較結果であり、撮影条件ではない。
            // 撮影時の高さを固定したい場合は declaredConditions.viewport で照合する。
            screenshotWidth: z.number().int().nonnegative(),
            cropApplied: z.boolean(),
            autoCropped: z.boolean().optional(),
            cropRegion: RectangleSchema.optional(),
            workingCropRegion: RectangleSchema.optional(),
            cropSource: z.enum(["none", "explicit-project", "auto"]).optional(),
            // 下端へ足りない行を足して上端揃えで比べた回だけ入る。旧 contain 基準と
            // 今回の top-aligned は領域スコアの意味が違うため、混ぜて比べない。足す行が無い
            // 回 (高さが揃った回を含む) は鍵を持たない。高さや contain 倍率の変化は
            // 実装の修正で起きる比較結果なので、この契約では文脈変更にしない。
            alignment: z.literal("top-aligned").optional(),
            // contain 正規化で比べた回だけ true。alignment の鍵が無い回は
            // 「高さが揃って 1:1 で比べた」か「contain に戻った」のどちらか分から
            // ないため、比較方式の同一性を見る verify_fix がこの鍵で区別する。
            // 倍率の値は含めず「contain 方式だったか」だけを記録する。
            containResized: z.literal(true).optional(),
          })
          .strict(),
      })
      .strict(),
    mask: z.discriminatedUnion("status", [
      z.object({ status: z.literal("none") }).strict(),
      z
        .object({
          status: z.literal("applied"),
          coordinateContext: CoordinateContextSchema,
          effectiveCanvas: CanvasSchema,
          effectiveRegions: z.array(MaskRegionSchema).min(1),
          maskedPixelCount: z.number().int().positive(),
          maskSha256: z.string().regex(/^[0-9a-f]{64}$/),
          appliedIds: z.array(z.string()),
          legacyIds: z.array(z.string()),
        })
        .strict(),
    ]),
  })
  .strict();

export const VerificationContextSchema = VerificationContextPayloadSchema.extend({
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

export type VerificationContextPayload = z.infer<typeof VerificationContextPayloadSchema>;
export type VerificationContext = z.infer<typeof VerificationContextSchema>;

const compareNumber = (left: number, right: number): number => left - right;

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const compareRegions = (
  left: z.infer<typeof MaskRegionSchema>,
  right: z.infer<typeof MaskRegionSchema>,
): number =>
  compareNumber(left.x, right.x) ||
  compareNumber(left.y, right.y) ||
  compareNumber(left.width, right.width) ||
  compareNumber(left.height, right.height) ||
  compareText(left.label ?? "", right.label ?? "");

export function normalizeVerificationContextPayload(
  input: VerificationContextPayload,
): VerificationContextPayload {
  const parsed = VerificationContextPayloadSchema.parse(input);
  return {
    ...parsed,
    mask:
      parsed.mask.status === "none"
        ? parsed.mask
        : {
            ...parsed.mask,
            effectiveRegions: [...parsed.mask.effectiveRegions].sort(compareRegions),
            appliedIds: [...parsed.mask.appliedIds].sort(compareText),
            legacyIds: [...parsed.mask.legacyIds].sort(compareText),
          },
  };
}

export function canonicalizeVerificationContextPayload(input: VerificationContextPayload): string {
  return JSON.stringify(normalizeVerificationContextPayload(input));
}

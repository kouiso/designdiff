import { z } from "zod";

const DimensionsSchema = z
  .object({
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
  })
  .strict();

export const CoordinateConditionsSchema = z
  .object({
    viewport: DimensionsSchema.optional(),
    pixelRatio: z.number().finite().positive().optional(),
    origin: z.object({ x: z.number().finite(), y: z.number().finite() }).strict().optional(),
  })
  .strict();

export const ComparisonConditionsInputSchema = z
  .object({
    design: CoordinateConditionsSchema.optional(),
    screenshot: CoordinateConditionsSchema.optional(),
  })
  .strict();

const ObservationSchema = z.object({
  viewportPixels: DimensionsSchema,
  source: z.literal("scroll-capture"),
});
const ExportRequestSchema = z.object({
  pixelRatio: z.number().finite().positive(),
  source: z.literal("figma-export-request"),
});
const CaptureEvidenceSchema = z.object({
  observed: ObservationSchema.optional(),
  requested: ExportRequestSchema.optional(),
});

const SideReportSchema = z.object({
  canvas: DimensionsSchema,
  canvasSource: z.literal("image-metadata"),
  declared: CoordinateConditionsSchema.optional(),
  observed: ObservationSchema.optional(),
  requested: ExportRequestSchema.optional(),
  unverified: z.array(z.enum(["viewport", "pixelRatio", "origin"])),
});

export const ComparisonConditionsReportSchema = z.object({
  status: z.enum(["compatible", "mismatch", "unverified"]),
  design: SideReportSchema,
  screenshot: SideReportSchema,
  differences: z.array(z.enum(["viewport", "origin", "pixelRatio", "captureDeclaration"])),
  message: z.string(),
});

export type ComparisonConditionsInput = z.infer<typeof ComparisonConditionsInputSchema>;
export type ComparisonConditionsReport = z.infer<typeof ComparisonConditionsReportSchema>;

const sideReport = (
  canvas: z.infer<typeof DimensionsSchema>,
  declared?: z.infer<typeof CoordinateConditionsSchema>,
  evidence?: z.infer<typeof CaptureEvidenceSchema>,
): z.infer<typeof SideReportSchema> => ({
  canvas: DimensionsSchema.parse(canvas),
  canvasSource: "image-metadata",
  declared,
  ...CaptureEvidenceSchema.parse(evidence ?? {}),
  unverified: (["viewport", "pixelRatio", "origin"] as const).filter(
    (key) => declared?.[key] === undefined,
  ),
});

// 画像の外寸から端末の表示領域や原点を推定すると、長いキャンバスを誤った端末高として扱う。
export const describeComparisonConditions = (
  canvas: {
    design: z.infer<typeof DimensionsSchema>;
    screenshot: z.infer<typeof DimensionsSchema>;
  },
  input?: ComparisonConditionsInput,
  observations: {
    design?: z.infer<typeof CaptureEvidenceSchema>;
    screenshot?: z.infer<typeof CaptureEvidenceSchema>;
  } = {},
): ComparisonConditionsReport => {
  const parsed = ComparisonConditionsInputSchema.parse(input ?? {});
  const design = sideReport(canvas.design, parsed.design, observations.design);
  const screenshot = sideReport(canvas.screenshot, parsed.screenshot, observations.screenshot);
  const differences: ComparisonConditionsReport["differences"] = [];
  const a = parsed.design;
  const b = parsed.screenshot;
  if (
    a?.viewport &&
    b?.viewport &&
    (!equalCoordinate(a.viewport.width, b.viewport.width) ||
      !equalCoordinate(a.viewport.height, b.viewport.height))
  ) {
    differences.push("viewport");
  }
  if (
    a?.origin &&
    b?.origin &&
    (!equalCoordinate(a.origin.x, b.origin.x) || !equalCoordinate(a.origin.y, b.origin.y))
  ) {
    differences.push("origin");
  }
  if (
    a?.pixelRatio &&
    b?.pixelRatio &&
    !equalCoordinate(a.pixelRatio, b.pixelRatio) &&
    (!equalLogicalRaster(
      canvas.design.width,
      a.pixelRatio,
      canvas.screenshot.width,
      b.pixelRatio,
    ) ||
      !equalLogicalRaster(
        canvas.design.height,
        a.pixelRatio,
        canvas.screenshot.height,
        b.pixelRatio,
      ))
  ) {
    differences.push("pixelRatio");
  }
  if ([design, screenshot].some(hasCaptureConflict)) {
    differences.push("captureDeclaration");
  }
  const status =
    differences.length > 0
      ? "mismatch"
      : design.unverified.length + screenshot.unverified.length > 0
        ? "unverified"
        : "compatible";
  const message =
    status === "mismatch"
      ? "表示領域・倍率・座標原点の申告、または撮影記録・書き出し要求と申告が一致しません。書き出し要求は実測値ではありません。位置差をCSSで修正する前に、撮影時の表示領域・倍率・共通原点を確認して揃えてください。申告値による画像の移動・切り抜きは行っていません。"
      : status === "unverified"
        ? "表示領域・倍率・座標原点には未確認の項目があります。画像の外寸はキャンバス寸法です。位置差を修正する前にcomparison_conditionsで両画像の撮影条件を確認してください。"
        : "表示領域と原点の申告値は一致しています。実測による確認ではありません。倍率は各画像の物理pxを論理pxへ換算する申告値で、画像の自動変換には使いません。";
  return { status, design, screenshot, differences, message };
};

// 論理座標に丸め誤差があるだけで、別条件の撮影と断定しない。
const equalCoordinate = (a: number, b: number): boolean =>
  Math.abs(a - b) <= 0.000001 * Math.max(1, Math.abs(a), Math.abs(b));

// 小数DPRで生じるラスター化の丸めは、物理画素1個まで許容する。
const equalLogicalRaster = (a: number, ratioA: number, b: number, ratioB: number): boolean =>
  Math.abs(a / ratioA - b / ratioB) <= 1 / Math.min(ratioA, ratioB);
const equalRaster = (a: number, b: number): boolean => Math.abs(a - b) <= 1;

const hasCaptureConflict = (side: z.infer<typeof SideReportSchema>): boolean => {
  const { declared, observed, requested } = side;
  if (!declared) return false;
  if (
    declared.pixelRatio &&
    requested &&
    !equalCoordinate(declared.pixelRatio, requested.pixelRatio)
  )
    return true;
  if (!declared.viewport || !declared.pixelRatio || !observed) return false;
  return (
    !equalRaster(declared.viewport.width * declared.pixelRatio, observed.viewportPixels.width) ||
    !equalRaster(declared.viewport.height * declared.pixelRatio, observed.viewportPixels.height)
  );
};

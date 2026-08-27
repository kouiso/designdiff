import { z } from "zod";

import { getVerifiedSystemBarTopInset } from "./confidence/system-bar-ignore-regions.js";

export const SystemUiFixtureMetadataSchema = z
  .object({
    captureDevice: z.enum(["android", "ios-sim", "ios-device"]).optional(),
    viewportWidth: z.number().int().positive().optional(),
    viewportHeight: z.number().int().positive().optional(),
    imageWidth: z.number().int().positive().optional(),
    imageHeight: z.number().int().positive().optional(),
    verifiedSystemUiTopInset: z.number().int().positive().optional(),
  })
  .superRefine((value, context) => {
    const entries = [
      ["captureDevice", value.captureDevice],
      ["viewportWidth", value.viewportWidth],
      ["viewportHeight", value.viewportHeight],
      ["imageWidth", value.imageWidth],
      ["imageHeight", value.imageHeight],
      ["verifiedSystemUiTopInset", value.verifiedSystemUiTopInset],
    ] as const;
    if (entries.every(([, field]) => field === undefined)) return;

    for (const [field, fieldValue] of entries) {
      if (fieldValue === undefined) {
        context.addIssue({
          code: "custom",
          path: [field],
          message:
            "captureDevice, viewportWidth, viewportHeight, imageWidth, imageHeight, and verifiedSystemUiTopInset must be specified together",
        });
      }
    }
  });

export type SystemUiFixtureMetadata = z.infer<typeof SystemUiFixtureMetadataSchema>;

export function resolveFixtureVerifiedSystemUiTopInset(
  metadata: SystemUiFixtureMetadata,
  imageDimensions: { width: number; height: number },
): number | undefined {
  const parsed = SystemUiFixtureMetadataSchema.parse(metadata);
  if (!parsed.captureDevice) return undefined;

  if (
    imageDimensions.width !== parsed.imageWidth ||
    imageDimensions.height !== parsed.imageHeight
  ) {
    throw new Error(
      `fixture image ${imageDimensions.width}x${imageDimensions.height} does not match declared image ${parsed.imageWidth}x${parsed.imageHeight}`,
    );
  }
  if (
    parsed.imageWidth !== parsed.viewportWidth ||
    (parsed.imageHeight ?? 0) < (parsed.viewportHeight ?? 0)
  ) {
    throw new Error(
      `declared image ${parsed.imageWidth}x${parsed.imageHeight} is incompatible with viewport ${parsed.viewportWidth}x${parsed.viewportHeight}`,
    );
  }

  const verifiedInset = getVerifiedSystemBarTopInset(
    parsed.viewportWidth ?? 0,
    parsed.viewportHeight ?? 0,
    parsed.captureDevice,
  );
  if (verifiedInset === undefined || verifiedInset !== parsed.verifiedSystemUiTopInset) {
    throw new Error(
      `fixture inset ${parsed.verifiedSystemUiTopInset} is not a production preset for ${parsed.viewportWidth}x${parsed.viewportHeight}`,
    );
  }
  return verifiedInset;
}

import sharp from "sharp";

export const MAX_ANTIALIAS_BLUR_SIGMA = 4.5;
export const CRITICAL_RAW_REGION_MIN_AREA_RATE = 0.005;
export const CRITICAL_RAW_REGION_MIN_DENSITY = 0.5;

export function parseAntialiasBlurSigma(value) {
  if (value === undefined || value === "") {
    return 0;
  }
  const sigma = Number(value);
  if (!Number.isFinite(sigma) || sigma < 0 || sigma > MAX_ANTIALIAS_BLUR_SIGMA) {
    throw new Error(
      `FIGDIFF_ANTIALIAS_BLUR_SIGMA must be between 0 and ${MAX_ANTIALIAS_BLUR_SIGMA}`,
    );
  }
  return sigma;
}

export async function normalizeAntialiasPair(designBuffer, screenshotBuffer, sigma) {
  if (sigma === 0) {
    return { designBuffer, screenshotBuffer };
  }
  const [normalizedDesign, normalizedScreenshot] = await Promise.all([
    sharp(designBuffer).blur(sigma).png().toBuffer(),
    sharp(screenshotBuffer).blur(sigma).png().toBuffer(),
  ]);
  return {
    designBuffer: normalizedDesign,
    screenshotBuffer: normalizedScreenshot,
  };
}

export function findCriticalRawDiffRegions(result) {
  const totalPixels = result.totalPixelCount;
  if (!Number.isFinite(totalPixels) || totalPixels <= 0) {
    return [];
  }
  return (result.diffRegions ?? [])
    .map((region) => {
      const area = region.bounds.width * region.bounds.height;
      return {
        bounds: region.bounds,
        diffPixelCount: region.diffPixelCount,
        areaRate: area / totalPixels,
        density: area > 0 ? region.diffPixelCount / area : 0,
      };
    })
    .filter(
      (region) =>
        region.areaRate >= CRITICAL_RAW_REGION_MIN_AREA_RATE &&
        region.density >= CRITICAL_RAW_REGION_MIN_DENSITY,
    );
}

export function resolveCrossRendererVerdict({
  aggregateVerdict,
  hasViewportMismatch,
  rawGuardPassed,
}) {
  if (hasViewportMismatch || !rawGuardPassed) {
    return "fail";
  }
  return aggregateVerdict;
}

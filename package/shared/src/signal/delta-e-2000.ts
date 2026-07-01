// sRGB 8-bit (0-255) -> linear light (0-1)
function srgbToLinear(c: number): number {
  const n = c / 255;
  return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
}

// Linear sRGB -> CIE XYZ (D65 illuminant, sRGB primaries)
function linearRgbToXyz(r: number, g: number, b: number): [number, number, number] {
  return [
    r * 0.4124564 + g * 0.3575761 + b * 0.1804375,
    r * 0.2126729 + g * 0.7151522 + b * 0.072175,
    r * 0.0193339 + g * 0.119192 + b * 0.9503041,
  ];
}

// CIE XYZ (D65) -> L*a*b*
const D65_X = 0.95047;
const D65_Y = 1.0;
const D65_Z = 1.08883;
const LAB_EPSILON = 0.008856;
const LAB_KAPPA = 903.3;

function xyzToLab(x: number, y: number, z: number): [number, number, number] {
  const fx = x / D65_X > LAB_EPSILON ? Math.cbrt(x / D65_X) : (LAB_KAPPA * (x / D65_X) + 16) / 116;
  const fy = y / D65_Y > LAB_EPSILON ? Math.cbrt(y / D65_Y) : (LAB_KAPPA * (y / D65_Y) + 16) / 116;
  const fz = z / D65_Z > LAB_EPSILON ? Math.cbrt(z / D65_Z) : (LAB_KAPPA * (z / D65_Z) + 16) / 116;

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function srgbToLab(r: number, g: number, b: number): [number, number, number] {
  const [x, y, z] = linearRgbToXyz(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b));
  return xyzToLab(x, y, z);
}

const DEG = Math.PI / 180;

export function deltaE2000(lab1: [number, number, number], lab2: [number, number, number]): number {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;

  const C1 = Math.sqrt(a1 * a1 + b1 * b1);
  const C2 = Math.sqrt(a2 * a2 + b2 * b2);
  const Cbar = (C1 + C2) / 2;
  const Cbar7 = Cbar ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + 6103515625))); // 25^7 = 6103515625

  const a1p = a1 * (1 + G);
  const a2p = a2 * (1 + G);
  const C1p = Math.sqrt(a1p * a1p + b1 * b1);
  const C2p = Math.sqrt(a2p * a2p + b2 * b2);

  const h1p = (Math.atan2(b1, a1p) / DEG + 360) % 360;
  const h2p = (Math.atan2(b2, a2p) / DEG + 360) % 360;

  const dLp = L2 - L1;
  const dCp = C2p - C1p;

  const dhp = (() => {
    if (C1p * C2p === 0) return 0;
    const diff = h2p - h1p;
    if (Math.abs(diff) <= 180) return diff;
    return diff > 180 ? diff - 360 : diff + 360;
  })();
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * DEG);

  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;

  const Hbarp = (() => {
    if (C1p * C2p === 0) return h1p + h2p;
    if (Math.abs(h1p - h2p) <= 180) return (h1p + h2p) / 2;
    return h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  })();

  const T =
    1 -
    0.17 * Math.cos((Hbarp - 30) * DEG) +
    0.24 * Math.cos(2 * Hbarp * DEG) +
    0.32 * Math.cos((3 * Hbarp + 6) * DEG) -
    0.2 * Math.cos((4 * Hbarp - 63) * DEG);

  const SL = 1 + (0.015 * (Lbarp - 50) ** 2) / Math.sqrt(20 + (Lbarp - 50) ** 2);
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;

  const Cbarp7 = Cbarp ** 7;
  const RC = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + 6103515625));
  const dTheta = 30 * Math.exp(-(((Hbarp - 275) / 25) ** 2));
  const RT = -Math.sin(2 * dTheta * DEG) * RC;

  return Math.sqrt(
    (dLp / SL) ** 2 + (dCp / SC) ** 2 + (dHp / SH) ** 2 + RT * (dCp / SC) * (dHp / SH),
  );
}

// deltaE2000 involves several trig calls per pixel pair; on whole-frame regions
// without a figmaRootNode (up to MAX_COMPARE_PIXELS = 24,000,000 px in
// image-compare-service.ts) a dense per-pixel scan is measurably slow. Above
// this many candidate pixels, sample on a stride instead — the mean color
// difference is stable under sampling, and clusterDiffPixels/pixelmatch
// already carry the pixel-exact diff signal.
const MAX_DENSE_SAMPLE_PIXELS = 1_000_000;

/**
 * Compute mean CIEDE2000 color difference over a rectangular region of two RGBA pixel arrays.
 * Transparent pixels (alpha = 0 in both) are skipped.
 */
export function computeMeanDeltaE2000(
  pixels1: Uint8ClampedArray,
  pixels2: Uint8ClampedArray,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  width: number,
): number {
  const height = Math.min(pixels1.length / 4 / width || 0, pixels2.length / 4 / width || 0);
  const clampedStartX = Math.max(0, Math.min(width, Math.floor(startX)));
  const clampedStartY = Math.max(0, Math.min(height, Math.floor(startY)));
  const clampedEndX = Math.max(clampedStartX, Math.min(width, Math.ceil(endX)));
  const clampedEndY = Math.max(clampedStartY, Math.min(height, Math.ceil(endY)));

  const regionWidth = clampedEndX - clampedStartX;
  const regionHeight = clampedEndY - clampedStartY;
  const regionArea = regionWidth * regionHeight;
  const stride =
    regionArea > MAX_DENSE_SAMPLE_PIXELS
      ? Math.ceil(Math.sqrt(regionArea / MAX_DENSE_SAMPLE_PIXELS))
      : 1;

  let total = 0;
  let count = 0;

  // A fixed rectangular lattice (same x-phase on every sampled row) can miss
  // a periodic narrow feature entirely — e.g. a 1px vertical rule that falls
  // exactly between sampled columns is invisible on every row. Stagger the
  // x-phase by row index (a diagonal lattice) so consecutive sampled rows
  // land on different columns, at the same total sample count/cost.
  let rowIndex = 0;
  for (let y = clampedStartY; y < clampedEndY; y += stride, rowIndex++) {
    const xPhase = clampedStartX + (rowIndex % stride);
    for (let x = xPhase; x < clampedEndX; x += stride) {
      const i = (y * width + x) * 4;
      if (pixels1[i + 3] === 0 && pixels2[i + 3] === 0) continue;
      total += deltaE2000(
        srgbToLab(pixels1[i], pixels1[i + 1], pixels1[i + 2]),
        srgbToLab(pixels2[i], pixels2[i + 1], pixels2[i + 2]),
      );
      count++;
    }
  }

  return count === 0 ? 0 : total / count;
}

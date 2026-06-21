import type { CropRegion, IgnoreRegion } from "../type.js";

export type MobileSystemBarPlatform = "android" | "ios-sim" | "ios-device";

interface SystemChromeInsets {
  top: number;
  bottom: number;
}

const DEVICE_INSET_PRESETS: Array<{
  platform: "android" | "ios";
  portraitWidth: number;
  portraitHeight: number;
  insets: SystemChromeInsets;
}> = [
  { platform: "ios", portraitWidth: 1179, portraitHeight: 2556, insets: { top: 162, bottom: 102 } },
  { platform: "ios", portraitWidth: 750, portraitHeight: 1334, insets: { top: 40, bottom: 0 } },
  {
    platform: "android",
    portraitWidth: 1080,
    portraitHeight: 2400,
    insets: { top: 72, bottom: 72 },
  },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getPlatformFamily(platform: MobileSystemBarPlatform): "android" | "ios" {
  return platform === "android" ? "android" : "ios";
}

function isLandscape(width: number, height: number): boolean {
  return width > height;
}

function getLandscapeInsetCap(
  width: number,
  height: number,
  platform: MobileSystemBarPlatform,
): number {
  const dpr = estimateDevicePixelRatio(Math.min(width, height), platform);
  if (platform === "android") {
    return clamp(Math.round(24 * dpr), 32, 96);
  }
  return clamp(Math.round(32 * dpr), 44, 96);
}

function getPresetInsets(
  width: number,
  height: number,
  platform: MobileSystemBarPlatform,
): SystemChromeInsets | undefined {
  const portraitWidth = Math.min(width, height);
  const portraitHeight = Math.max(width, height);
  const family = getPlatformFamily(platform);
  return DEVICE_INSET_PRESETS.find(
    (preset) =>
      preset.platform === family &&
      preset.portraitWidth === portraitWidth &&
      preset.portraitHeight === portraitHeight,
  )?.insets;
}

function estimateDevicePixelRatio(width: number, platform: MobileSystemBarPlatform): number {
  if (platform === "android") {
    if (width >= 1440) return 3.5;
    if (width >= 1080) return 3;
    if (width >= 720) return 2;
    return 1;
  }

  if (width >= 1170) return 3;
  if (width >= 750) return 2;
  return 1;
}

function getFallbackInsets(
  width: number,
  height: number,
  platform: MobileSystemBarPlatform,
): SystemChromeInsets {
  const portraitWidth = Math.min(width, height);
  const dpr = estimateDevicePixelRatio(portraitWidth, platform);

  if (platform === "android") {
    return {
      top: clamp(Math.round(24 * dpr), 48, 96),
      bottom: clamp(Math.round(24 * dpr), 32, 84),
    };
  }

  const looksLikeNotchedIphone = portraitHeightHasNotch(Math.max(width, height), dpr);
  return {
    top: looksLikeNotchedIphone
      ? clamp(Math.round(54 * dpr), 88, 180)
      : clamp(Math.round(20 * dpr), 20, 60),
    bottom: looksLikeNotchedIphone ? clamp(Math.round(34 * dpr), 34, 112) : 0,
  };
}

function portraitHeightHasNotch(portraitHeight: number, dpr: number): boolean {
  return portraitHeight / dpr >= 780;
}

function getSystemChromeInsets(
  width: number,
  height: number,
  platform: MobileSystemBarPlatform,
): SystemChromeInsets {
  const preset = getPresetInsets(width, height, platform);
  if (preset) return preset;
  return getFallbackInsets(width, height, platform);
}

function intersectSystemRegionWithCrop(
  region: IgnoreRegion,
  cropRegion: CropRegion,
): IgnoreRegion | undefined {
  const cropRight = cropRegion.x + cropRegion.width;
  const cropBottom = cropRegion.y + cropRegion.height;
  const regionRight = region.x + region.width;
  const regionBottom = region.y + region.height;

  const left = Math.max(region.x, cropRegion.x);
  const top = Math.max(region.y, cropRegion.y);
  const right = Math.min(regionRight, cropRight);
  const bottom = Math.min(regionBottom, cropBottom);

  if (right <= left || bottom <= top) {
    return undefined;
  }

  return {
    x: left - cropRegion.x,
    y: top - cropRegion.y,
    width: right - left,
    height: bottom - top,
    label: region.label,
  };
}

export function buildSystemBarIgnoreRegions(
  screenshotWidth: number,
  screenshotHeight: number,
  platform: MobileSystemBarPlatform,
  cropRegion?: CropRegion,
): IgnoreRegion[] {
  if (screenshotWidth <= 0 || screenshotHeight <= 0) {
    return [];
  }

  const insets = getSystemChromeInsets(screenshotWidth, screenshotHeight, platform);
  const landscapeInsetCap = getLandscapeInsetCap(screenshotWidth, screenshotHeight, platform);
  const statusBarHeight = isLandscape(screenshotWidth, screenshotHeight)
    ? Math.min(insets.top, landscapeInsetCap)
    : insets.top;
  const navBarHeight = isLandscape(screenshotWidth, screenshotHeight)
    ? Math.min(insets.bottom, landscapeInsetCap)
    : insets.bottom;

  const fullScreenshotRegions: IgnoreRegion[] = [];
  if (statusBarHeight > 0) {
    fullScreenshotRegions.push({
      x: 0,
      y: 0,
      width: screenshotWidth,
      height: statusBarHeight,
      label: "system:status-bar",
    });
  }
  if (navBarHeight > 0) {
    fullScreenshotRegions.push({
      x: 0,
      y: Math.max(0, screenshotHeight - navBarHeight),
      width: screenshotWidth,
      height: navBarHeight,
      label: "system:navigation-bar",
    });
  }

  if (!cropRegion) {
    return fullScreenshotRegions;
  }

  return fullScreenshotRegions.flatMap((region) => {
    const croppedRegion = intersectSystemRegionWithCrop(region, cropRegion);
    return croppedRegion ? [croppedRegion] : [];
  });
}

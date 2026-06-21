import type { CropRegion, IgnoreRegion } from "../type.js";

export type MobileSystemBarPlatform = "android" | "ios-sim" | "ios-device";

const ANDROID_STATUS_BAR_RATIO = 0.035;
const ANDROID_NAV_BAR_RATIO = 0.025;
const IOS_STATUS_BAR_RATIO = 0.04;
const IOS_HOME_INDICATOR_RATIO = 0.02;

function getSystemBarRatios(platform: MobileSystemBarPlatform): {
  statusBarRatio: number;
  navBarRatio: number;
} {
  if (platform === "android") {
    return {
      // 実機Pixel系のステータスバーは画面高の3〜4%程度に収まるため。
      statusBarRatio: ANDROID_STATUS_BAR_RATIO,
      // 3ボタン/ジェスチャーナビの最小安全域として下端2〜3%を除外するため。
      navBarRatio: ANDROID_NAV_BAR_RATIO,
    };
  }

  return {
    // iOSはノッチ/時刻領域がAndroidよりやや高い端末があるため。
    statusBarRatio: IOS_STATUS_BAR_RATIO,
    // Home Indicatorは薄いがdiffで目立つため、過剰にならない下端安全域に留める。
    navBarRatio: IOS_HOME_INDICATOR_RATIO,
  };
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

  const { statusBarRatio, navBarRatio } = getSystemBarRatios(platform);
  const statusBarHeight = Math.max(1, Math.round(screenshotHeight * statusBarRatio));
  const navBarHeight = Math.max(1, Math.round(screenshotHeight * navBarRatio));

  const fullScreenshotRegions: IgnoreRegion[] = [
    {
      x: 0,
      y: 0,
      width: screenshotWidth,
      height: statusBarHeight,
      label: "system:status-bar",
    },
    {
      x: 0,
      y: Math.max(0, screenshotHeight - navBarHeight),
      width: screenshotWidth,
      height: navBarHeight,
      label: "system:navigation-bar",
    },
  ];

  if (!cropRegion) {
    return fullScreenshotRegions;
  }

  return fullScreenshotRegions.flatMap((region) => {
    const croppedRegion = intersectSystemRegionWithCrop(region, cropRegion);
    return croppedRegion ? [croppedRegion] : [];
  });
}

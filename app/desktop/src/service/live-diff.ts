import type { CompareDesignResult } from "@figdiff/shared";

import { compareImages } from "@/service/image-compare";

export interface ComputeLiveDiffOptions {
  designImageBase64: string;
  screenshotBase64: string;
}

const withPngDataUrl = (base64: string): string => {
  if (base64.startsWith("data:image/")) return base64;
  return `data:image/png;base64,${base64}`;
};

export async function computeLiveDiff(
  options: ComputeLiveDiffOptions,
): Promise<CompareDesignResult & { diffImageBase64?: string }> {
  return compareImages({
    designImage: withPngDataUrl(options.designImageBase64),
    screenshotImage: withPngDataUrl(options.screenshotBase64),
  });
}

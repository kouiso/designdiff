import sharp from "sharp";

import type { FigmaExportReport, FigmaNode, PreflightWarning } from "@figdiff/shared";

const FILLED_BOX_TYPES = new Set(["FRAME", "COMPONENT", "INSTANCE", "RECTANGLE"]);

export const inspectFigmaExport = async (
  base64: string,
  node: FigmaNode | undefined,
  conditions: FigmaExportReport["conditions"],
): Promise<FigmaExportReport> => {
  const { data, info } = await sharp(Buffer.from(base64, "base64"))
    .toColourspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width <= 0 || info.height <= 0 || info.channels !== 4) {
    throw new Error("Cannot inspect Figma export pixels");
  }
  const opaqueFillExpected =
    node !== undefined &&
    FILLED_BOX_TYPES.has(node.type) &&
    // 斜めの図形は外接矩形の中心領域にも透明部分が生じるため、塗りの欠落と断定できない。
    (node.rotation ?? 0) % 90 === 0 &&
    (node.opacity ?? 1) === 1 &&
    node.fills.some(
      (fill) =>
        fill.visible !== false &&
        fill.type === "SOLID" &&
        (fill.opacity ?? 1) === 1 &&
        fill.color?.a === 1,
    );
  // 角丸や効果の透明な端を背景欠落と誤認しないよう、中心だけを調べる。
  const left = Math.floor(info.width * 0.4);
  const top = Math.floor(info.height * 0.4);
  const right = Math.max(left + 1, Math.ceil(info.width * 0.6));
  const bottom = Math.max(top + 1, Math.ceil(info.height * 0.6));
  let transparent = 0;
  let uniformRaster = true;
  for (let offset = 0; offset < data.length; offset += 4) {
    for (let channel = 0; channel < 4; channel += 1) {
      if (Math.abs(data[offset + channel] - data[channel]) > 1) uniformRaster = false;
    }
    const pixel = offset / 4;
    const x = pixel % info.width;
    const y = Math.floor(pixel / info.width);
    if (x >= left && x < right && y >= top && y < bottom && data[offset + 3] < 250)
      transparent += 1;
  }
  const interiorTransparentRatio = transparent / ((right - left) * (bottom - top));
  const warnings: PreflightWarning[] = [];
  if (node?.visible === false && uniformRaster) {
    warnings.push({
      code: "figma_export_hidden_blank",
      severity: "critical",
      message:
        "非表示の Figma ノードから単色の画像が返されました。設計内容が書き出されていない可能性があります。",
      suggestedFix:
        "Figma の表示状態と対象ノードを確認してください。figma_use_absolute_bounds: false を明示して再取得できますが、取得画像に設計内容があるか確認する必要があります。",
    });
  } else if (opaqueFillExpected && interiorTransparentRatio > 0.1) {
    warnings.push({
      code: "figma_export_background_missing",
      severity: "critical",
      message:
        "Figma ノードの不透明な塗りに対し、書き出し画像の中心に透明な画素があります。背景の欠落を実装差分と区別する必要があります。",
      suggestedFix:
        "設計側の背景と書き出し画像を確認してください。周辺レイヤーを含める意図がある場合だけ figma_contents_only: false を指定してください。構造差分は引き続き確認してください。",
    });
  }
  return {
    conditions,
    nodeVisible: node?.visible,
    opaqueFillExpected,
    uniformRaster,
    interiorTransparentRatio,
    warnings,
  };
};

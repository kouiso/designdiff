import {
  compareFlatRegionColor,
  computeHausdorff,
  computeMeanDeltaE2000,
  computePerceptibleDiffRatio,
  computeSsimForRegion,
  resolveAlignment,
  UNIMPLEMENTED_LAYOUT_SCORE,
  selectScoringRegions,
  computeVerdict,
  detectHighTextureRegion,
  type CropRegion,
  type DiffBoundingBox,
  type DiffReport,
  type FigmaNode,
  type RegionScore,
} from "@figdiff/shared";

// contain-resize で生じた余白を表す矩形 (= 実コンテンツの占有範囲)。
// image-compare-service の PaddingMask と同じ意味。SSIM / 色差から
// 余白 (上下の透明帯) を除外するために content rect として受け取る。
interface PaddingMaskRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface BuildDiffReportOptions {
  designPixels: Uint8ClampedArray;
  screenshotPixels: Uint8ClampedArray;
  width: number;
  height: number;
  // 比較の対象外に置いた画素 (1 = 対象外)。矛盾判定の分母から外す。
  ignoreMask?: Uint8Array;
  // 見える差のあった画素を 1 で書き込む先。人間レビューへ回すときの証拠に使う。
  perceptibleMask?: Uint8Array;
  figmaRootNode?: FigmaNode;
  figmaFileKey?: string;
  figmaNodeId?: string;
  figmaPageName?: string;
  // set_crop_region 適用時の crop 矩形 (フル幅 resize 後のスクリーンショット座標)。
  // 与えられると node→region 写像で crop 原点を減算し、スケールをフルフレーム
  // 基準で算出する。未指定なら crop 無し扱い (従来挙動)。
  cropRegion?: CropRegion;
  // crop 適用前のフルフレームのスクリーンショット寸法。crop 時のスケール算出基準。
  // cropRegion はあるが fullFrame が無い場合は、crop 後の width/height + crop 原点で
  // フルフレーム寸法を再構成する。
  fullFrame?: { width: number; height: number };
  // contain-resize の余白矩形 (content rect)。与えられると whole-frame の
  // SSIM / 色差を余白 (透明帯) を除いた content rect 内だけで計算する。
  paddingMask?: PaddingMaskRect;
  // pixelmatch の差分クラスタ。Figma ノード木が無い比較 (PNG手渡し) では
  // 局所化の唯一の手がかりがこれになる。figmaRootNode 由来の子行が無い
  // ときだけ採点単位として使う (Issue #56)。diffPixelCount は上限超過時に
  // 疑わしい順で残すための重大度シグナル。
  diffRegions?: (DiffBoundingBox & { diffPixelCount?: number })[];
}

const MAX_REGION_SCORE_COUNT = 24;
const MIN_REGION_PIXEL_AREA = 64;
// shape (Hausdorff, 0-1 正規化済み) が実測でこの値を明確に上回る場合のみ
// エッジの空間ズレを「実在する」と判定する。純色/輝度シフトのみの領域は
// 実測で shape=0.0000 exact、実際の平行移動/リサイズは最小でも 0.013 台
// だったため、0.005 は両者の間の安全マージン。
const GEOMETRIC_SHAPE_EPSILON = 0.005;

// ─── Translation detection ────────────────────────────────────────────────────

const buildColorDifference = (
  designPixels: Uint8ClampedArray,
  screenshotPixels: Uint8ClampedArray,
  width: number,
  height: number,
  bbox?: DiffBoundingBox,
): number => {
  const startX = bbox ? Math.max(0, Math.floor(bbox.x)) : 0;
  const startY = bbox ? Math.max(0, Math.floor(bbox.y)) : 0;
  const endX = bbox ? Math.min(Math.ceil(bbox.x + bbox.w), width) : width;
  const endY = bbox ? Math.min(Math.ceil(bbox.y + bbox.h), height) : height;
  return computeMeanDeltaE2000(designPixels, screenshotPixels, startX, startY, endX, endY, width);
};

// ΔE2000 は知覚距離なのでトークン1段のズレ (例 #22AA88 vs #28AA88) が閾値 2 を
// 下回り critical に上がらない。ベタ面には縁のぼかしが無いので、両側がベタ面の
// ときだけ hex を完全一致で比べれば、文字や写真を巻き込まずに拾える (#269)。
const buildFlatColorMismatch = (
  designPixels: Uint8ClampedArray,
  screenshotPixels: Uint8ClampedArray,
  width: number,
  height: number,
  bbox?: DiffBoundingBox,
): RegionScore["flatColorMismatch"] => {
  const comparison = compareFlatRegionColor(designPixels, screenshotPixels, width, height, bbox);
  if (!comparison.mismatch || !comparison.design || !comparison.screenshot) return undefined;
  return {
    designHex: comparison.design.hex,
    screenshotHex: comparison.screenshot.hex,
    maxChannelDelta: comparison.maxChannelDelta ?? 0,
  };
};

function buildIssues(
  regionScores: RegionScore[],
  options: BuildDiffReportOptions,
): DiffReport["issues"] {
  const issues: DiffReport["issues"] = [];
  const evidenceProvenance = {
    figmaFileKey: options.figmaFileKey,
    figmaNodeId: options.figmaNodeId,
    figmaPageName: options.figmaPageName,
  };

  for (const regionScore of regionScores) {
    // ベタ面どうしの hex 不一致は「塗りのトークンが違う」という離散的な事実で、
    // ΔE の連続量では表現できない。critical に上げて computeVerdict の
    // hasCriticalIssue 経路へ乗せる。
    const flat = regionScore.flatColorMismatch;
    if (flat) {
      issues.push({
        regionId: regionScore.regionId,
        bbox: regionScore.bbox,
        kind: "color",
        severity: "critical",
        figmaNodeId: regionScore.figmaNodeId,
        evidence: {
          signal: "flat_region_color",
          value: flat.maxChannelDelta,
          threshold: 1,
          expected: flat.designHex,
          actual: flat.screenshotHex,
          ...evidenceProvenance,
        },
        suggestedCssFix: `ベタ面の塗りが ${flat.designHex} ではなく ${flat.screenshotHex} になっています。色トークンをデザイン基準に合わせてください。`,
      });
    }

    // color は唯一の severity="critical" kind で computeVerdict の
    // hasCriticalIssue 判定に直結するため、常に emit する（verdict の
    // 正しさが kind ラベルの精度より優先 — 条件付き抑制で verdict accuracy が
    // 100%→66.7%に崩れることを実測済み）。
    if (regionScore.color >= 2) {
      issues.push({
        regionId: regionScore.regionId,
        bbox: regionScore.bbox,
        kind: "color",
        severity: "critical",
        figmaNodeId: regionScore.figmaNodeId,
        evidence: {
          signal: "delta_e_2000",
          value: regionScore.color,
          threshold: 2,
          expected: "< 2",
          actual: regionScore.color,
          ...evidenceProvenance,
        },
        suggestedCssFix: "背景色や塗り色のトークン値をデザイン基準に合わせてください。",
      });
    }

    // position/size は structure (SSIM) が閾値を割った領域のうち、shape
    // (Sobel エッジの Hausdorff 距離、色に依存しない) が実際にエッジ位置の
    // ズレを示している場合のみ発火させる。SSIM の luminance 項は純色/輝度
    // シフトだけでも押し下げられるため、SSIM 単独では「色だけ変わった」領域を
    // 誤って position/size と分類してしまう（issue-kind precision 55%の
    // 根本原因）。shape はエッジ（局所的な輝度勾配が閾値を超える箇所）の
    // 空間位置を色に関わらず比較するため、エッジが動いていなければ 0 になる
    // ——純色シフトの実測: 0.0000。実際の平行移動/リサイズでは shape > 0
    // （実測: line-height-off 8pxシフト=0.052〜0.056、layout-off=0.141、
    // single-section-regression=0.087、font-size-off=0.013〜0.019）。
    const hasEdgeDisplacement = regionScore.shape > GEOMETRIC_SHAPE_EPSILON;

    if (regionScore.structure < 0.95 && hasEdgeDisplacement) {
      issues.push({
        regionId: regionScore.regionId,
        bbox: regionScore.bbox,
        kind: "position",
        severity: "major",
        figmaNodeId: regionScore.figmaNodeId,
        evidence: {
          signal: "ssim+hausdorff",
          value: regionScore.structure,
          threshold: 0.95,
          expected: ">= 0.95",
          actual: regionScore.structure,
          ...evidenceProvenance,
        },
        suggestedCssFix: "位置ずれが大きいため、主要要素の座標と余白を見直してください。",
      });
    }

    if (regionScore.structure < 0.9 && hasEdgeDisplacement) {
      issues.push({
        regionId: regionScore.regionId,
        bbox: regionScore.bbox,
        kind: "size",
        severity: "major",
        figmaNodeId: regionScore.figmaNodeId,
        evidence: {
          signal: "ssim+hausdorff",
          value: regionScore.structure,
          threshold: 0.9,
          expected: ">= 0.9",
          actual: regionScore.structure,
          ...evidenceProvenance,
        },
        suggestedCssFix: "要素サイズやコンテナ幅・高さがデザインと一致しているか確認してください。",
      });
    }
  }

  return issues;
}

function toWholeFrameRegion(width: number, height: number): DiffBoundingBox {
  return { x: 0, y: 0, w: width, h: height };
}

/**
 * whole-frame の SSIM / 色差を計算する対象矩形を返す。
 * contain-resize の余白 (上下の透明帯) は比較対象でないため、paddingMask が
 * あればその content rect を、無ければフレーム全体を返す。これにより letterbox
 * 余白や padding 由来の偽の構造差で whole-frame SSIM が不当に下がるのを防ぐ。
 */
function toContentRegion(
  width: number,
  height: number,
  paddingMask?: PaddingMaskRect,
): DiffBoundingBox {
  if (!paddingMask) {
    return toWholeFrameRegion(width, height);
  }
  return {
    x: Math.max(0, paddingMask.left),
    y: Math.max(0, paddingMask.top),
    w: Math.max(0, Math.min(width - paddingMask.left, paddingMask.width)),
    h: Math.max(0, Math.min(height - paddingMask.top, paddingMask.height)),
  };
}

/**
 * crop 適用前のフルフレーム寸法を解決する。
 * fullFrame があればそれを使い、無ければ crop 後寸法 + crop 原点から再構成する。
 */
function resolveFullFrame(
  width: number,
  height: number,
  cropRegion: CropRegion | undefined,
  fullFrame: { width: number; height: number } | undefined,
): { width: number; height: number } {
  if (fullFrame) {
    return fullFrame;
  }
  if (cropRegion) {
    // crop 後の width/height は crop 矩形の幅/高さに一致する想定。crop 原点を
    // 足し戻すことでフルフレームの「最低限」の寸法を推定する (右/下の余りは
    // 不明なため crop 矩形の右/下端までを採用する)。
    return {
      width: Math.max(width, cropRegion.x + cropRegion.width),
      height: Math.max(height, cropRegion.y + cropRegion.height),
    };
  }
  return { width, height };
}

function toScreenshotBbox(
  child: FigmaNode,
  root: FigmaNode,
  width: number,
  height: number,
  fullFrame: { width: number; height: number },
  cropRegion?: CropRegion,
): DiffBoundingBox | null {
  const childBox = child.absoluteBoundingBox;
  const rootBox = root.absoluteBoundingBox;
  if (!childBox || !rootBox || rootBox.width <= 0 || rootBox.height <= 0) {
    return null;
  }

  // crop 適用前のフルフレーム寸法でスケールを決める。crop 後の width/height を
  // 使うとスケールが変わって node 写像が縮尺ずれするため、フル寸法を基準にする。
  const scale = Math.min(fullFrame.width / rootBox.width, fullFrame.height / rootBox.height);
  const renderedWidth = rootBox.width * scale;
  const offsetX = (fullFrame.width - renderedWidth) / 2;
  const offsetY = 0;
  // crop 原点を減算して crop 後スクリーンショット座標に揃える。
  const cropX = cropRegion?.x ?? 0;
  const cropY = cropRegion?.y ?? 0;
  const x = offsetX + (childBox.x - rootBox.x) * scale - cropX;
  const y = offsetY + (childBox.y - rootBox.y) * scale - cropY;
  const w = childBox.width * scale;
  const h = childBox.height * scale;

  return {
    x: Math.max(0, Math.min(width, Math.round(x))),
    y: Math.max(0, Math.min(height, Math.round(y))),
    w: Math.max(
      0,
      Math.min(width, Math.round(x + w)) - Math.max(0, Math.min(width, Math.round(x))),
    ),
    h: Math.max(
      0,
      Math.min(height, Math.round(y + h)) - Math.max(0, Math.min(height, Math.round(y))),
    ),
  };
}

function buildRegionScores(options: BuildDiffReportOptions): RegionScore[] {
  const { designPixels, screenshotPixels, width, height, figmaRootNode, cropRegion, paddingMask } =
    options;
  const childRegions: RegionScore[] = [];
  const fullFrame = resolveFullFrame(width, height, cropRegion, options.fullFrame);

  const getTextureScore = (bbox: DiffBoundingBox): number => {
    try {
      return detectHighTextureRegion(screenshotPixels, width, height, bbox).textureScore;
    } catch {
      return 0;
    }
  };

  if (figmaRootNode) {
    const scoreableChildren = figmaRootNode.children
      // 非表示のバリアントは画面に出ないので、評価対象にすると
      // 実装が正しくても差分として残り続ける。
      .filter((child: FigmaNode) => child.visible !== false)
      .map((child: FigmaNode) => {
        const bbox = toScreenshotBbox(child, figmaRootNode, width, height, fullFrame, cropRegion);
        if (!bbox || bbox.w === 0 || bbox.h === 0) {
          return null;
        }

        return { child, bbox };
      })
      .filter((section): section is { child: FigmaNode; bbox: DiffBoundingBox } => section !== null)
      .filter((section) => section.bbox.w * section.bbox.h >= MIN_REGION_PIXEL_AREA);

    // 同じ位置・同じ大きさの子が複数あると、同じ範囲の領域が重複して並ぶ。
    // 受け取る側には、直す場所がその数だけあるように見える。1件へまとめる。
    const allSectionAnchors = mergeEqualBoxSiblings(scoreableChildren).sort((a, b) => {
      if (a.bbox.y !== b.bbox.y) {
        return a.bbox.y - b.bbox.y;
      }

      return b.bbox.w * b.bbox.h - a.bbox.w * a.bbox.h;
    });

    const sectionAnchors = selectAnchorsForScoring(allSectionAnchors);

    for (const [index, section] of sectionAnchors.entries()) {
      const nextSection = sectionAnchors[index + 1];
      const bbox: DiffBoundingBox = {
        x: section.bbox.x,
        y: section.bbox.y,
        w: section.bbox.w,
        h: Math.max(
          section.bbox.h,
          nextSection ? nextSection.bbox.y - section.bbox.y : height - section.bbox.y,
        ),
      };

      if (bbox.w === 0 || bbox.h === 0) {
        continue;
      }

      childRegions.push({
        regionId: section.child.id,
        bbox,
        figmaNodeId: section.child.id,
        overlappingNodeIds: section.overlappingNodeIds,
        structure: computeSsimForRegion(designPixels, screenshotPixels, width, height, bbox),
        color: buildColorDifference(designPixels, screenshotPixels, width, height, bbox),
        flatColorMismatch: buildFlatColorMismatch(
          designPixels,
          screenshotPixels,
          width,
          height,
          bbox,
        ),
        shape: computeHausdorff(designPixels, screenshotPixels, width, height, bbox),
        layout: UNIMPLEMENTED_LAYOUT_SCORE,
        textureScore: getTextureScore(bbox),
      });
    }
  }

  // Figma ノード木が無い比較では childRegions が作れず、面積重み付き平均が
  // whole-frame 1行だけになる。局所差分が面積比で薄まって合否を通り抜ける
  // (Issue #56)。pixelmatch の差分クラスタは局所化を既に正しく行えているため、
  // これを採点単位に転用する。figmaRootNode 側の挙動 (childRegions がある場合)
  // は変えない。
  const diffClusterRegions: RegionScore[] = [];
  if (childRegions.length === 0 && options.diffRegions && options.diffRegions.length > 0) {
    // pixelmatch のクラスタリング (clusterDiffPixels 系) が既に自前の連結画素数
    // 閾値でノイズを除いている。子ノード用の MIN_REGION_PIXEL_AREA (64px^2) を
    // ここでも適用すると、1x40 の細い欠落のような正当な小面積差分まで捨てて
    // whole-frame 平均へフォールバックし、#56 と同じ薄まりが再発する。
    const scoreableClusters = options.diffRegions.filter((bbox) => bbox.w > 0 && bbox.h > 0);
    // 上限超過時は先頭から均等間引きせず、diffPixelCount が大きい (=疑わしい)
    // 順に残す。均等間引きだと本命のクラスタがたまたま非採用インデックスに
    // 落ちて丸ごと見逃され、他の採用クラスタのせいで whole-frame fallback も
    // 効かなくなり、誤 PASS が再発する。
    const selectedClusters = [...scoreableClusters]
      .sort((a, b) => (b.diffPixelCount ?? 0) - (a.diffPixelCount ?? 0))
      .slice(0, MAX_REGION_SCORE_COUNT);

    for (const [index, bbox] of selectedClusters.entries()) {
      diffClusterRegions.push({
        regionId: `diff-cluster-${index}`,
        bbox,
        structure: computeSsimForRegion(designPixels, screenshotPixels, width, height, bbox),
        color: buildColorDifference(designPixels, screenshotPixels, width, height, bbox),
        flatColorMismatch: buildFlatColorMismatch(
          designPixels,
          screenshotPixels,
          width,
          height,
          bbox,
        ),
        shape: computeHausdorff(designPixels, screenshotPixels, width, height, bbox),
        layout: UNIMPLEMENTED_LAYOUT_SCORE,
        textureScore: getTextureScore(bbox),
      });
    }
  }

  const wholeFrameBbox = toWholeFrameRegion(width, height);
  // letterbox 余白を含めると SSIM / 色差が不当に悪化するため、content rect 内で評価する。
  const contentBbox = toContentRegion(width, height, paddingMask);

  // 比較対象そのものの行。子の行があっても必ず1件持たせる。
  // 単一ノードを比べたとき、子の行しか無いと「対象ノードが見つからない」で
  // verify_fix が落ち、局所的な修正を自分で確かめられなくなる。
  // 集計では scope: "root" を外すので、重み付けと見出しの値は変わらない。
  //
  // 遅延で作る。子が無い経路では下の fallback が同じ計算をやり直すため、
  // 先に作ると画素を舐める処理が丸ごと二重になる。
  const buildRootRegion = (): RegionScore => ({
    regionId: "whole-frame",
    scope: "root",
    bbox: wholeFrameBbox,
    structure: computeSsimForRegion(designPixels, screenshotPixels, width, height, contentBbox),
    color: buildColorDifference(
      designPixels,
      screenshotPixels,
      width,
      height,
      paddingMask ? contentBbox : undefined,
    ),
    flatColorMismatch: buildFlatColorMismatch(
      designPixels,
      screenshotPixels,
      width,
      height,
      contentBbox,
    ),
    shape: computeHausdorff(designPixels, screenshotPixels, width, height, contentBbox),
    layout: UNIMPLEMENTED_LAYOUT_SCORE,
    textureScore: getTextureScore(wholeFrameBbox),
    // 比較元のノードIDが解決できない検体でも、この行を名前で引けるようにする。
    // 引けないと、対象そのものを指定した検証がその経路だけ通らない。
    figmaNodeId: options.figmaNodeId ?? figmaRootNode?.id,
  });

  if (childRegions.length > 0) {
    return [...childRegions, buildRootRegion()];
  }

  if (diffClusterRegions.length > 0) {
    return [...diffClusterRegions, buildRootRegion()];
  }

  return [buildRootRegion()];
}

interface SectionAnchor {
  child: FigmaNode;
  bbox: DiffBoundingBox;
  overlappingNodeIds?: string[];
}

const boxKey = (bbox: DiffBoundingBox): string => `${bbox.x},${bbox.y},${bbox.w},${bbox.h}`;

/**
 * 同じ矩形の兄弟を1件へまとめ、隠れた側のIDを手前の1件へ集める。
 *
 * 一度だけ全体を走って矩形ごとの並びを作り、そこから引き当てる。走査のたびに
 * 配列を頭から探すと子の数の2乗に比例し、層が数千ある画面で比較が目に見えて遅くなる。
 */
function mergeEqualBoxSiblings(
  sections: readonly { child: FigmaNode; bbox: DiffBoundingBox }[],
): SectionAnchor[] {
  const membersByBox = new Map<string, { child: FigmaNode; bbox: DiffBoundingBox }[]>();
  for (const section of sections) {
    const key = boxKey(section.bbox);
    const members = membersByBox.get(key);
    if (members) {
      members.push(section);
    } else {
      membersByBox.set(key, [section]);
    }
  }

  const merged: SectionAnchor[] = [];
  for (const members of membersByBox.values()) {
    // Figma は後に並ぶ子ほど手前に描くので、いちばん手前は最後の1枚。
    // ただし半透明や部分的な塗りだと下の層も見えているので、IDは残す。
    const front = members[members.length - 1];
    merged.push(
      members.length === 1
        ? front
        : {
            ...front,
            overlappingNodeIds: members.slice(0, -1).map((member) => member.child.id),
          },
    );
  }

  return merged;
}

function selectAnchorsForScoring<T>(anchors: readonly T[]): T[] {
  if (anchors.length <= MAX_REGION_SCORE_COUNT) {
    return [...anchors];
  }

  console.info(
    `[diff-report] regionScores capped from ${anchors.length} to ${MAX_REGION_SCORE_COUNT}`,
  );

  return Array.from({ length: MAX_REGION_SCORE_COUNT }, (_, index) => {
    const sourceIndex = Math.round((index * (anchors.length - 1)) / (MAX_REGION_SCORE_COUNT - 1));
    return anchors[sourceIndex];
  });
}

// Sub-pixel/anti-aliasing tolerance for the global-shift visibility issue below.
const GLOBAL_SHIFT_ISSUE_THRESHOLD_PX = 2;
// A shift at or above this magnitude is implausible as mere rendering/DPR
// noise between a Figma export and a real screenshot (that noise lives in
// the 0-2px range this alignment correction exists to absorb — see the
// ae45d66 commit this feature originated from). Codex correctly flagged
// that a "major" issue alone never blocks PASS (computeVerdict only checks
// severity==="critical"); below this size we keep the shift as a visible,
// non-blocking note (preserves the original false-"全面ズレ" fix for
// capture-scale noise). At or above it, treat as a real position defect —
// escalate to "critical" so it fails through the same path "color" already
// uses, without touching computeVerdict itself.
const GLOBAL_SHIFT_CRITICAL_THRESHOLD_PX = 10;

export function buildDiffReport(options: BuildDiffReportOptions): DiffReport {
  const { designPixels, screenshotPixels, width, height, paddingMask } = options;

  const expectedLength = width * height * 4;
  if (designPixels.length < expectedLength || screenshotPixels.length < expectedLength) {
    throw new Error(
      `Pixel buffer too small for ${width}x${height}: design=${designPixels.length}, screenshot=${screenshotPixels.length}, expected>=${expectedLength}`,
    );
  }

  const {
    alignment,
    alignedDesignPixels,
    applied: alignmentApplied,
  } = resolveAlignment(designPixels, screenshotPixels, width, height);
  const { x: dx, y: dy } = alignment.translation;

  // diffRegions は補正前 (resolveAlignment 前) の pixelmatch 座標系。補正が
  // 適用されると、alignedDesignPixels は境界からのはみ出し分を透明/RGB0で
  // 埋めるため (shiftPixels)、境界付近の元クラスタがその塗り分を拾って
  // 「許容していたはずの小さなずれ」が誤って critical 差分に化ける。補正が
  // かかった回は diffRegions 由来の採点を使わず、既存の whole-frame 採点に
  // 留める (安全側)。座標系を揃えて再クラスタ化する対応は別途追跡する。
  const alignedOptions = {
    ...options,
    designPixels: alignedDesignPixels,
    diffRegions: alignmentApplied ? undefined : options.diffRegions,
  };
  const regionScores = buildRegionScores(alignedOptions);

  // 比較対象そのものの行は子と範囲が重なる。合否を決める不具合をここから作ると、
  // 子が全部合格でも背景の色差だけで不合格へ倒れる。集計と同じ行だけを使う。
  const issues = buildIssues(selectScoringRegions(regionScores), options);

  // An accepted global alignment correction can hide a real regression: e.g.
  // a page that scrolled/shifted is itself often the bug under test, not a
  // capture artifact to silently correct away. A shift >= the critical
  // threshold is escalated to severity="critical" so it fails through the
  // same hasCriticalIssue path "color" already uses (computeVerdict itself
  // is untouched); a smaller accepted shift stays a visible, non-blocking
  // note — preserving the original false-"全面ズレ" fix this alignment
  // correction exists for.
  const shiftMagnitude = Math.sqrt(dx * dx + dy * dy);
  if (alignmentApplied && shiftMagnitude >= GLOBAL_SHIFT_ISSUE_THRESHOLD_PX) {
    const isCriticalShift = shiftMagnitude >= GLOBAL_SHIFT_CRITICAL_THRESHOLD_PX;
    issues.push({
      regionId: "whole-frame",
      bbox: { x: 0, y: 0, w: width, h: height },
      kind: "position",
      severity: isCriticalShift ? "critical" : "major",
      figmaNodeId: options.figmaNodeId,
      evidence: {
        signal: "translation_offset",
        value: shiftMagnitude,
        threshold: isCriticalShift
          ? GLOBAL_SHIFT_CRITICAL_THRESHOLD_PX
          : GLOBAL_SHIFT_ISSUE_THRESHOLD_PX,
        expected: `< ${GLOBAL_SHIFT_ISSUE_THRESHOLD_PX}px`,
        actual: `dx=${dx}, dy=${dy}`,
        figmaFileKey: options.figmaFileKey,
        figmaNodeId: options.figmaNodeId,
        figmaPageName: options.figmaPageName,
      },
      suggestedCssFix:
        "画面全体が平行移動しています。意図したスクロール/マージン変更か、レイアウト回帰かを確認してください。",
    });
  }

  const verdict = computeVerdict({ alignment, regionScores, issues });

  // 判定と独立した証拠。ただし矛盾を疑うのは「判定が pass」のときだけなので、
  // それ以外では走査そのものを行わない。全画素が違う比較 (= fail になる比較) で
  // 最も高くつく計算を、使わないまま回さないため。
  let perceptibleDiffRatio: number | undefined;
  if (verdict.verdict === "pass") {
    // letterbox の余白は評価から外す。
    const evaluated = toContentRegion(width, height, paddingMask);
    perceptibleDiffRatio = computePerceptibleDiffRatio(
      alignedDesignPixels,
      screenshotPixels,
      evaluated.x,
      evaluated.y,
      evaluated.x + evaluated.w,
      evaluated.y + evaluated.h,
      width,
      { ignoreMask: options.ignoreMask, outMask: options.perceptibleMask },
    );
  }

  return {
    alignment,
    regionScores,
    issues,
    weightedAggregate: verdict.weightedAggregate,
    aggregateVerdict: verdict.verdict,
    rationale: verdict.rationale,
    perceptibleDiffRatio,
  };
}

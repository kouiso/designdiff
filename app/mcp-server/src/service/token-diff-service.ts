// 色と文字を、画素ではなく値そのもので突き合わせる経路。
//
// 画素を数える経路は、文字の縁のぼかし (アンチエイリアス) の影響を必ず受ける。
// 「#FCFCFC のはずが #FFFFFF になっている」ような差は、ぼかしの揺らぎに埋もれて
// 安定して言い当てられない。実装が実際に使っている値を読めるなら、そちらを直接
// 比べるほうが正確で、しかも「どのノードの何が違うか」まで言える。
//
// ただし対応付けは万能ではない。Figma の座標と DOM の矩形は、スクロール・変形・
// 擬似要素でずれる。対応付けできなかった割合を必ず数え、閾値を超えたら
// 「この経路では判定できない」と表明して画素経路へ戻す。黙って劣化させない。

import {
  figmaColorToHex,
  type DomElementStyle,
  type FigmaNode,
  type TokenDiffReport,
  type TokenMismatch,
} from "@figdiff/shared";

/** 対応付けに要求する重なりの下限 (Intersection over Union)。 */
export const MIN_OVERLAP_RATIO = 0.3;

/**
 * 未照合がこの割合を超えたら、この経路の判定は使わない。
 *
 * 半分以上のノードが対応付けできない状態は、座標系そのものがずれている疑いが強い。
 * その状態で残り半分の一致だけを根拠に合否を出すと、見えている範囲だけで
 * 「問題なし」と言うことになる。
 */
export const MAX_UNMATCHED_RATIO = 0.5;

/**
 * 判定に使うための最低ノード数。
 *
 * 1〜2件では、たまたま当たっただけなのか実際に一致しているのか区別できない。
 */
export const MIN_COMPARABLE_NODES = 3;

/**
 * 対応付けできたノードのうち、この割合を超えて食い違ったら判定に使わない。
 *
 * 半分以上のノードで色や文字が違うのは、実装が半分間違っているより
 * 「別のフレームと比べている / 座標がずれて違う要素と対応付いた」ほうが起こりやすい。
 * その状態で FAIL を出すと、正しい実装を間違った値へ書き換えさせることになる。
 * 食い違いの一覧は出したまま、合否だけ画素経路へ返す。
 */
export const MAX_BLOCKING_MISMATCH_RATIO = 0.5;

/** フォントサイズの許容差 (px)。丸めと単位変換のぶれを吸収する。 */
export const FONT_SIZE_TOLERANCE_PX = 0.5;
/** 行の高さの許容差 (px)。ブラウザの行送り計算はブラウザごとに端数が出る。 */
export const LINE_HEIGHT_TOLERANCE_PX = 1;
/** 字間の許容差 (px)。 */
export const LETTER_SPACING_TOLERANCE_PX = 0.1;

export interface TokenDiffInput {
  figmaRootNode: FigmaNode;
  domStyles: readonly DomElementStyle[];
  /** スクリーンショットの幅。Figma フレーム幅との比を倍率として使う。 */
  screenshotWidth: number;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ComparableNode {
  id: string;
  name: string;
  rect: Rect;
  kind: "text" | "fill";
  color?: string;
  fontSize?: number;
  fontWeight?: number;
  fontFamily?: string;
  lineHeight?: number;
  letterSpacing?: number;
  backgroundColor?: string;
}

/**
 * CSS の色表記を `#RRGGBB` / `#RRGGBBAA` へ揃える。
 * 揃えないと `rgb(34, 170, 136)` と `#22AA88` が別物として数えられてしまう。
 * 解釈できない表記 (グラデーション・色名・color() 記法) は undefined を返し、
 * 比較対象から外す。推測で色を作ると、存在しない不一致を報告することになる。
 */
export function normalizeCssColor(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;

  const hex = /^#([0-9a-f]{3,8})$/i.exec(trimmed);
  if (hex) {
    const digits = hex[1];
    if (digits.length === 3 || digits.length === 4) {
      const expanded = [...digits].map((d) => `${d}${d}`).join("");
      return `#${expanded}`.toUpperCase();
    }
    if (digits.length === 6 || digits.length === 8) return `#${digits}`.toUpperCase();
    return undefined;
  }

  const rgb = /^rgba?\(([^)]+)\)$/i.exec(trimmed);
  if (!rgb) return undefined;
  const parts = rgb[1]
    .split(/[,/\s]+/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (parts.length < 3) return undefined;
  const channels: number[] = [];
  for (let i = 0; i < 3; i++) {
    const channel = parts[i].endsWith("%")
      ? (Number.parseFloat(parts[i]) / 100) * 255
      : Number.parseFloat(parts[i]);
    if (!Number.isFinite(channel)) return undefined;
    channels.push(Math.round(Math.min(255, Math.max(0, channel))));
  }
  let alpha = 1;
  if (parts.length >= 4) {
    const raw = parts[3].endsWith("%")
      ? Number.parseFloat(parts[3]) / 100
      : Number.parseFloat(parts[3]);
    if (!Number.isFinite(raw)) return undefined;
    alpha = Math.min(1, Math.max(0, raw));
  }
  const body = channels.map((c) => c.toString(16).padStart(2, "0")).join("");
  if (Math.abs(alpha - 1) < 0.002) return `#${body}`.toUpperCase();
  return `#${body}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0")}`.toUpperCase();
}

/**
 * フォント指定の先頭ファミリだけを取り出して揃える。
 * CSS は候補を並べて書くので、丸ごと比べると常に不一致になる。
 */
export function normalizeFontFamily(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const first = value
    .split(",")[0]
    ?.trim()
    .replace(/^["']|["']$/g, "");
  if (first === undefined || first === "") return undefined;
  return first.toLowerCase();
}

function solidFillHex(node: FigmaNode): string | undefined {
  const fill = node.fills?.find((paint) => paint.visible !== false && paint.type === "SOLID");
  if (!fill?.color) return undefined;
  return figmaColorToHex(
    fill.color.r,
    fill.color.g,
    fill.color.b,
    fill.color.a * (fill.opacity ?? 1),
  );
}

/** Figma の絶対座標を、スクリーンショット上の座標へ移す。 */
function toScreenshotRect(
  box: { x: number; y: number; width: number; height: number },
  origin: { x: number; y: number },
  scale: number,
): Rect {
  return {
    x: (box.x - origin.x) * scale,
    y: (box.y - origin.y) * scale,
    width: box.width * scale,
    height: box.height * scale,
  };
}

/**
 * ページ全体を覆う塗りは対応付けの対象にしない。
 * ルートのフレームや全面の背景は、どの DOM 要素とも重なりが小さくなるため、
 * 常に未照合として数えられて未照合率を無意味に押し上げる。
 */
const WHOLE_FRAME_AREA_RATIO = 0.95;

function collectComparableNodes(
  node: FigmaNode,
  origin: { x: number; y: number },
  scale: number,
  frameArea: number,
  out: ComparableNode[],
): void {
  if (node.visible === false) return;
  const box = node.absoluteBoundingBox;
  if (box && box.width > 0 && box.height > 0) {
    const rect = toScreenshotRect(box, origin, scale);
    if (node.type === "TEXT" && node.style) {
      out.push({
        id: node.id,
        name: node.name,
        rect,
        kind: "text",
        color: solidFillHex(node),
        fontSize: node.style.fontSize,
        fontWeight: node.style.fontWeight,
        fontFamily: node.style.fontFamily,
        lineHeight: node.style.lineHeightPx,
        letterSpacing: node.style.letterSpacing,
      });
    } else if (node.type !== "TEXT") {
      const background = solidFillHex(node);
      const coversWholeFrame =
        frameArea > 0 && rect.width * rect.height >= frameArea * WHOLE_FRAME_AREA_RATIO;
      if (background !== undefined && !coversWholeFrame) {
        out.push({ id: node.id, name: node.name, rect, kind: "fill", backgroundColor: background });
      }
    }
  }
  for (const child of node.children ?? [])
    collectComparableNodes(child, origin, scale, frameArea, out);
}

/** 2つの矩形の重なり具合 (0〜1)。1 は完全一致。 */
export function overlapRatio(a: Rect, b: Rect): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= left || bottom <= top) return 0;
  const intersection = (right - left) * (bottom - top);
  const union = a.width * a.height + b.width * b.height - intersection;
  if (union <= 0) return 0;
  return intersection / union;
}

function findBestMatch(
  node: ComparableNode,
  candidates: readonly DomElementStyle[],
): DomElementStyle | undefined {
  let best: DomElementStyle | undefined;
  let bestRatio = MIN_OVERLAP_RATIO;
  for (const candidate of candidates) {
    const ratio = overlapRatio(node.rect, candidate);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = candidate;
    }
  }
  return best;
}

function pushMismatch(
  mismatches: TokenMismatch[],
  node: ComparableNode,
  property: string,
  designValue: string,
  implValue: string,
  severity: TokenMismatch["severity"],
  match: DomElementStyle,
): void {
  mismatches.push({
    property,
    nodeId: node.id,
    nodeName: node.name,
    designValue,
    implValue,
    severity,
    region: {
      x: Math.round(match.x),
      y: Math.round(match.y),
      w: Math.round(match.width),
      h: Math.round(match.height),
    },
  });
}

interface CompareOutcome {
  checkedProperties: number;
}

function compareTextNode(
  node: ComparableNode,
  match: DomElementStyle,
  mismatches: TokenMismatch[],
): CompareOutcome {
  let checkedProperties = 0;

  const designColor = normalizeCssColor(node.color);
  const implColor = normalizeCssColor(match.color);
  if (designColor !== undefined && implColor !== undefined) {
    checkedProperties++;
    if (designColor !== implColor) {
      pushMismatch(mismatches, node, "color", designColor, implColor, "critical", match);
    }
  }

  if (node.fontSize !== undefined && match.fontSize !== undefined) {
    checkedProperties++;
    if (Math.abs(node.fontSize - match.fontSize) > FONT_SIZE_TOLERANCE_PX) {
      pushMismatch(
        mismatches,
        node,
        "fontSize",
        `${node.fontSize}px`,
        `${match.fontSize}px`,
        "critical",
        match,
      );
    }
  }

  if (node.fontWeight !== undefined && match.fontWeight !== undefined) {
    checkedProperties++;
    if (node.fontWeight !== match.fontWeight) {
      pushMismatch(
        mismatches,
        node,
        "fontWeight",
        String(node.fontWeight),
        String(match.fontWeight),
        "critical",
        match,
      );
    }
  }

  const designFamily = normalizeFontFamily(node.fontFamily);
  const implFamily = normalizeFontFamily(match.fontFamily);
  if (designFamily !== undefined && implFamily !== undefined) {
    checkedProperties++;
    if (designFamily !== implFamily) {
      // 実際に描画されたフォントは、指定の先頭が入っていなければ後続へ落ちる。
      // 指定が違う事実は伝えるが、これだけで落とすと候補指定が常に不一致になる。
      pushMismatch(mismatches, node, "fontFamily", designFamily, implFamily, "major", match);
    }
  }

  if (node.lineHeight !== undefined && match.lineHeight !== undefined) {
    checkedProperties++;
    if (Math.abs(node.lineHeight - match.lineHeight) > LINE_HEIGHT_TOLERANCE_PX) {
      pushMismatch(
        mismatches,
        node,
        "lineHeight",
        `${node.lineHeight}px`,
        `${match.lineHeight}px`,
        "minor",
        match,
      );
    }
  }

  if (node.letterSpacing !== undefined && match.letterSpacing !== undefined) {
    checkedProperties++;
    if (Math.abs(node.letterSpacing - match.letterSpacing) > LETTER_SPACING_TOLERANCE_PX) {
      pushMismatch(
        mismatches,
        node,
        "letterSpacing",
        `${node.letterSpacing}px`,
        `${match.letterSpacing}px`,
        "minor",
        match,
      );
    }
  }

  return { checkedProperties };
}

function compareFillNode(
  node: ComparableNode,
  match: DomElementStyle,
  mismatches: TokenMismatch[],
): CompareOutcome {
  const designColor = normalizeCssColor(node.backgroundColor);
  const implColor = normalizeCssColor(match.backgroundColor);
  if (designColor === undefined || implColor === undefined) return { checkedProperties: 0 };
  if (designColor !== implColor) {
    pushMismatch(mismatches, node, "backgroundColor", designColor, implColor, "critical", match);
  }
  return { checkedProperties: 1 };
}

/**
 * Figma のノードと実装の DOM を突き合わせ、色と文字の違いを列挙する。
 * 対応付けの当たり具合も一緒に返すので、呼び出し側は「この結果を信じてよいか」を
 * 自分で判断できる。
 */
export function runTokenDiff(input: TokenDiffInput): TokenDiffReport {
  const frameBox = input.figmaRootNode.absoluteBoundingBox;
  if (!frameBox || frameBox.width <= 0) {
    return {
      comparedNodeCount: 0,
      matchedNodeCount: 0,
      unmatchedNodeCount: 0,
      unmatchedRatio: 0,
      checkedPropertyCount: 0,
      mismatches: [],
      reliable: false,
      demotionReason: "Figma フレームの寸法が取れなかったため、座標を突き合わせられませんでした。",
    };
  }

  const scale = input.screenshotWidth / frameBox.width;
  const frameArea = frameBox.width * scale * (frameBox.height * scale);
  const nodes: ComparableNode[] = [];
  collectComparableNodes(input.figmaRootNode, frameBox, scale, frameArea, nodes);

  const textCandidates = input.domStyles.filter((entry) => entry.text !== undefined);
  const fillCandidates = input.domStyles.filter((entry) => entry.backgroundColor !== undefined);

  const mismatches: TokenMismatch[] = [];
  let matchedNodeCount = 0;
  let checkedPropertyCount = 0;

  for (const node of nodes) {
    const match = findBestMatch(node, node.kind === "text" ? textCandidates : fillCandidates);
    if (match === undefined) continue;
    const outcome =
      node.kind === "text"
        ? compareTextNode(node, match, mismatches)
        : compareFillNode(node, match, mismatches);
    if (outcome.checkedProperties === 0) continue;
    matchedNodeCount++;
    checkedPropertyCount += outcome.checkedProperties;
  }

  const comparedNodeCount = nodes.length;
  const unmatchedNodeCount = comparedNodeCount - matchedNodeCount;
  const unmatchedRatio = comparedNodeCount === 0 ? 1 : unmatchedNodeCount / comparedNodeCount;

  let demotionReason: string | undefined;
  if (comparedNodeCount === 0) {
    demotionReason = "Figma 側に色や文字を持つノードが見つかりませんでした。";
  } else if (matchedNodeCount < MIN_COMPARABLE_NODES) {
    demotionReason = `対応付けできたノードが ${matchedNodeCount} 件しかなく、判断材料として足りません (最低 ${MIN_COMPARABLE_NODES} 件)。`;
  } else if (unmatchedRatio > MAX_UNMATCHED_RATIO) {
    demotionReason = `${comparedNodeCount} 件中 ${unmatchedNodeCount} 件が対応付けできませんでした (${Math.round(
      unmatchedRatio * 100,
    )}%)。座標系がずれている可能性が高いため、この経路の判定は使いません。`;
  } else {
    const criticalNodeIds = new Set(
      mismatches.filter((mismatch) => mismatch.severity === "critical").map((m) => m.nodeId),
    );
    if (criticalNodeIds.size > matchedNodeCount * MAX_BLOCKING_MISMATCH_RATIO) {
      demotionReason = `対応付けできた ${matchedNodeCount} 件のうち ${criticalNodeIds.size} 件で色や文字が食い違っています。実装が半分間違っているより、別のフレームと比べている可能性のほうが高いので、合否には使いません。下の一覧は参考として残します。`;
    }
  }

  return {
    comparedNodeCount,
    matchedNodeCount,
    unmatchedNodeCount,
    unmatchedRatio,
    checkedPropertyCount,
    mismatches,
    reliable: demotionReason === undefined,
    demotionReason,
  };
}

/** 合否を落とすべき不一致だけを返す。色と文字の大きさ・太さは値の事実なので落とす。 */
export function blockingMismatches(report: TokenDiffReport): TokenMismatch[] {
  if (!report.reliable) return [];
  return report.mismatches.filter((mismatch) => mismatch.severity === "critical");
}

// 寸法と余白を、画素ではなく値そのもので突き合わせる経路。
//
// 画素を数える経路は 15px と 16px の文字をほとんど区別できない。縁のぼかしに
// 埋もれて、一致率が高いまま数十件のズレを1件も指摘できないことがある。
// 実装が実際に使っている値を読めるなら、そちらを直接比べるほうが正確で、
// しかも「どの要素の何が何px違うか」まで言える。
//
// 対応付けは万能ではない。名前で1対1に当てにいくと外れるので、親から順に
// 「親の対応先の子孫の中だけ」で当てる。こうすると、親と子を取り違える
// (外枠と中身のような) 事故が構造として起きない。
// 当てられなかったノードは件数で丸めず、1件ずつ名前を出す。

import type {
  DomLayoutBox,
  FigmaNode,
  MeasureDiffReport,
  MeasureMismatch,
  StackCheck,
  UnmatchedDesignNode,
} from "@figdiff/shared";

/**
 * 親の外まで探しに行く時に要求する重なりの下限。
 *
 * 小さいほうの矩形が、どれだけ相手に覆われているかで見る。IoU で見ると、
 * Figma のテキスト枠が幅いっぱいで実装が文字幅ぴったり、という「どちらも正しい」
 * 差だけで落ちてしまう。
 */
export const MIN_OVERLAP_RATIO = 0.3;

/** 未照合がこの割合を超えたら、座標系ごとずれている疑いが強いので判定に使わない。 */
export const MAX_UNMATCHED_RATIO = 0.5;

/** 判定に使うための最低ノード数。1〜2件では偶然と区別できない。 */
export const MIN_COMPARABLE_NODES = 3;

/** 寸法・余白の許容差 (px)。丸めと端数のぶれを吸収する。 */
export const SIZE_TOLERANCE_PX = 0.5;

/** 行の高さの許容差 (px)。行送りの計算はブラウザごとに端数が出る。 */
export const LINE_HEIGHT_TOLERANCE_PX = 1;

/**
 * 文字列が一致した時に、位置のずれをどこまで許すか (px)。
 * 同じ文字列が画面内に複数ある時、遠いほうへ当たるのを防ぐ。
 */
export const TEXT_MATCH_MAX_CENTER_DISTANCE_PX = 12;

/**
 * 倍率が 1 からこれ以上離れたら、文字の大きさは比較しない。
 * 寸法は倍率で伸縮するが、CSS の font-size は伸縮しない。同じ倍率を掛けると
 * 存在しない不一致を作ることになる。
 */
export const SCALE_TOLERANCE = 0.01;

/** 積み上げの検算で許す残差 (px)。 */
export const STACK_RESIDUAL_TOLERANCE_PX = 1;

/** 重大度の境目 (px)。並べ替えて大きいものから直せるようにするための区分。 */
export const CRITICAL_DELTA_PX = 4;
export const MAJOR_DELTA_PX = 1.5;

export interface MeasureDiffInput {
  figmaRootNode: FigmaNode;
  domBoxes: readonly DomLayoutBox[];
  /** スクリーンショットの幅。Figma フレーム幅との比を倍率として使う。 */
  screenshotWidth: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesignNode {
  id: string;
  name: string;
  type: string;
  node: FigmaNode;
  rect: Rect;
  children: DesignNode[];
  /**
   * アイコン部品の中身。実装側は1つの svg / 疑似要素になるので、中の文字や
   * 図形に対応する要素は構造として存在しない。突き合わせの対象から外す。
   * 外さないと、未照合率がアイコンの内部で水増しされて信頼度の判定が壊れる。
   */
  notCompared: boolean;
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

/** 小さいほうの矩形が相手にどれだけ覆われているか (0〜1)。 */
export function coverageRatio(a: Rect, b: { x: number; y: number; width: number; height: number }): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= left || bottom <= top) return 0;
  const intersection = (right - left) * (bottom - top);
  const smaller = Math.min(a.width * a.height, b.width * b.height);
  if (smaller <= 0) return 0;
  return intersection / smaller;
}

/**
 * 突き合わせ用に文字を揃える。空白と大文字小文字の違いだけで別物にすると、
 * 折り返しや整形の差で当たらなくなる。
 */
export function normalizeText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.replace(/\s+/g, "").toLowerCase();
  return normalized === "" ? undefined : normalized;
}

function visibleChildren(node: FigmaNode): FigmaNode[] {
  return (node.children ?? []).filter((child) => child.visible !== false);
}

function buildDesignTree(
  node: FigmaNode,
  origin: { x: number; y: number },
  scale: number,
  notCompared = false,
): DesignNode | undefined {
  if (node.visible === false) return undefined;
  const box = node.absoluteBoundingBox;
  if (!box || box.width <= 0 || box.height <= 0) return undefined;
  const childrenNotCompared = notCompared || node.type === "INSTANCE";
  const children: DesignNode[] = [];
  for (const child of visibleChildren(node)) {
    const built = buildDesignTree(child, origin, scale, childrenNotCompared);
    if (built) children.push(built);
  }
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    node,
    rect: {
      x: (box.x - origin.x) * scale,
      y: (box.y - origin.y) * scale,
      width: box.width * scale,
      height: box.height * scale,
    },
    children,
    notCompared,
  };
}

/** 親どうしの対応。子は親からの相対位置で突き合わせる。 */
export interface ParentPair {
  design: Rect;
  impl: { x: number; y: number; width: number; height: number };
}

/**
 * 親からの相対位置のずれ (px)。
 *
 * 絶対座標で比べると、上のほうで余白が 8px ずれただけで、その下の要素が
 * 全部ずれた扱いになる。実際に見たいのは「親の中でどこに置かれているか」
 * なので、親の左上を基準に取り直す。
 */
function relativeOffset(node: DesignNode, box: DomLayoutBox, parent: ParentPair): number {
  const designDx = node.rect.x - parent.design.x;
  const designDy = node.rect.y - parent.design.y;
  const implDx = box.x - parent.impl.x;
  const implDy = box.y - parent.impl.y;
  return Math.abs(designDx - implDx) + Math.abs(designDy - implDy);
}

/** 文字の突き合わせで許す相対位置のずれ (px)。同じ文字列が複数ある画面で遠くへ当たるのを防ぐ。 */
export const TEXT_MATCH_MAX_RELATIVE_OFFSET_PX = 80;

/** 文字以外の突き合わせで、これを下回る点数の組は候補にしない。 */
export const MIN_PAIR_SCORE = 0.9;

/**
 * 縦横それぞれで要求する大きさの比の下限。
 *
 * 位置の点は「親の中で同じ場所にある」だけで満点になるので、大きさを合計差で
 * 見ていると、1px の箱でも足切りを通り抜ける。軸ごとに比を取って門前払いする。
 */
export const MIN_AXIS_RATIO = 0.55;

/** 2つの長さの比 (0〜1)。1 は同じ長さ。 */
function axisRatio(a: number, b: number): number {
  const longer = Math.max(a, b);
  if (longer <= 0) return 1;
  return Math.max(0, Math.min(a, b)) / longer;
}

/**
 * 1組の当てはまり具合を返す。0 は候補外。
 *
 * 文字は「枠の大きさ」で比べてはいけない。Figma のテキスト枠は幅いっぱいに
 * 引かれることが多く、実装側は文字の幅ぴったりになる。同じ文字なのに
 * 重なりが小さくなって当たらない、という取りこぼしがこれで起きる。
 */
export function pairScore(node: DesignNode, box: DomLayoutBox, parent: ParentPair): number {
  const offset = relativeOffset(node, box, parent);

  if (node.type === "TEXT") {
    const designText = normalizeText(node.node.characters);
    const implText = normalizeText(box.text);
    if (designText === undefined || implText === undefined) return 0;
    let base = 0;
    if (designText === implText) base = 3;
    else if (designText.includes(implText) || implText.includes(designText)) base = 1.5;
    if (base === 0) return 0;
    if (offset > TEXT_MATCH_MAX_RELATIVE_OFFSET_PX) return 0;
    return base - Math.min(base * 0.9, offset / 40);
  }

  if (box.text !== undefined && node.children.length === 0) {
    // デザイン側が図形なのに実装側が文字を持つ要素、という組は取り違えの元。
    // ただし入れ物どうしの対応 (中に文字を含む箱) は正当なので、葉だけを弾く。
    return 0;
  }

  // 大きさは縦横それぞれで見る。合計の差で見ると、幅が合っていれば高さが
  // 何分の一でも通ってしまう。同じ左上に置かれた飾り帯が、その上に載る本体の
  // 枠として当たる事故がこれで起きる。
  const widthRatio = axisRatio(node.rect.width, box.width);
  const heightRatio = axisRatio(node.rect.height, box.height);
  if (widthRatio < MIN_AXIS_RATIO || heightRatio < MIN_AXIS_RATIO) return 0;
  const sizeTerm = (widthRatio + heightRatio) / 2;
  const positionTerm =
    1 - Math.min(1, offset / Math.max(24, (parent.design.width + parent.design.height) / 4));
  const score = sizeTerm + positionTerm;
  if (score < MIN_PAIR_SCORE) return 0;
  // 同じ点数なら外側を採る。余白と間隔は入れ物側に載っているため。
  return score - box.depth * 0.0001;
}

interface BoxIndex {
  byRef: Map<number, DomLayoutBox>;
  childrenOf: Map<number, DomLayoutBox[]>;
  roots: DomLayoutBox[];
}

function indexBoxes(boxes: readonly DomLayoutBox[]): BoxIndex {
  const byRef = new Map<number, DomLayoutBox>();
  const childrenOf = new Map<number, DomLayoutBox[]>();
  const roots: DomLayoutBox[] = [];
  for (const box of boxes) byRef.set(box.ref, box);
  for (const box of boxes) {
    if (box.parentRef === undefined || !byRef.has(box.parentRef)) {
      roots.push(box);
      continue;
    }
    const siblings = childrenOf.get(box.parentRef);
    if (siblings) siblings.push(box);
    else childrenOf.set(box.parentRef, [box]);
  }
  return { byRef, childrenOf, roots };
}

function descendantsOf(index: BoxIndex, ref: number): DomLayoutBox[] {
  const out: DomLayoutBox[] = [];
  const stack = [...(index.childrenOf.get(ref) ?? [])];
  while (stack.length > 0) {
    const box = stack.pop();
    if (!box) break;
    out.push(box);
    const children = index.childrenOf.get(box.ref);
    if (children) stack.push(...children);
  }
  return out;
}

interface Assignment {
  matched: Map<string, DomLayoutBox>;
  unmatched: UnmatchedDesignNode[];
}

function toUnmatched(
  node: DesignNode,
  reason: string,
  category: UnmatchedDesignNode["category"],
): UnmatchedDesignNode {
  return {
    nodeId: node.id,
    nodeName: node.name,
    nodeType: node.type,
    rect: {
      x: Math.round(node.rect.x),
      y: Math.round(node.rect.y),
      w: Math.round(node.rect.width),
      h: Math.round(node.rect.height),
    },
    reason,
    category,
  };
}

/**
 * 並び順を壊した対応を捨てる。
 *
 * デザインで上から A→B→C の順に並んでいるものが、実装側で A→C→B の順に
 * 対応づいたなら、少なくとも1つは取り違えている。点数の高い並びだけを残す
 * (最長増加部分列) ことで、残ったものは順序として矛盾しない。
 */
function keepMonotonic(
  pairs: { node: DesignNode; box: DomLayoutBox; score: number }[],
  vertical: boolean,
): { node: DesignNode; box: DomLayoutBox; score: number }[] {
  if (pairs.length <= 1) return pairs;
  const coordinate = (box: DomLayoutBox): number => (vertical ? box.y : box.x);
  const bestLength: number[] = [];
  const bestScore: number[] = [];
  const previous: number[] = [];
  for (let i = 0; i < pairs.length; i++) {
    bestLength[i] = 1;
    bestScore[i] = pairs[i].score;
    previous[i] = -1;
    for (let j = 0; j < i; j++) {
      if (coordinate(pairs[j].box) > coordinate(pairs[i].box)) continue;
      const length = bestLength[j] + 1;
      const score = bestScore[j] + pairs[i].score;
      if (length > bestLength[i] || (length === bestLength[i] && score > bestScore[i])) {
        bestLength[i] = length;
        bestScore[i] = score;
        previous[i] = j;
      }
    }
  }
  let tail = 0;
  for (let i = 1; i < pairs.length; i++) {
    if (
      bestLength[i] > bestLength[tail] ||
      (bestLength[i] === bestLength[tail] && bestScore[i] > bestScore[tail])
    ) {
      tail = i;
    }
  }
  const kept: typeof pairs = [];
  for (let i = tail; i >= 0; i = previous[i]) {
    kept.push(pairs[i]);
    if (previous[i] === -1) break;
  }
  return kept.reverse();
}

/**
 * 親から順に、親の対応先の子孫の中だけで当てる。
 * 兄弟はまとめて当て、点数の高い組から順に1対1で取っていく。先頭から順に
 * 取ると、後ろの兄弟のものを先頭が持って行ってしまう。
 */
function assignTree(
  roots: DesignNode[],
  index: BoxIndex,
  allBoxes: readonly DomLayoutBox[],
): Assignment {
  const matched = new Map<string, DomLayoutBox>();
  const unmatched: UnmatchedDesignNode[] = [];
  const usedRefs = new Set<number>();

  const markNotCompared = (node: DesignNode): void => {
    unmatched.push(
      toUnmatched(
        node,
        "アイコン部品の中身のため、実装側に対応する要素が構造として存在しません。",
        "not-compared",
      ),
    );
    for (const child of node.children) markNotCompared(child);
  };

  interface Pair {
    node: DesignNode;
    box: DomLayoutBox;
    score: number;
  }

  const collectPairs = (
    nodes: readonly DesignNode[],
    scope: readonly DomLayoutBox[],
    parent: ParentPair,
  ): Pair[] => {
    const pairs: Pair[] = [];
    for (const node of nodes) {
      for (const box of scope) {
        if (usedRefs.has(box.ref)) continue;
        const score = pairScore(node, box, parent);
        if (score > 0) pairs.push({ node, box, score });
      }
    }
    return pairs.sort((a, b) => b.score - a.score);
  };

  const takeGreedy = (pairs: readonly Pair[], into: Pair[], taken: Set<string>): void => {
    for (const pair of pairs) {
      if (taken.has(pair.node.id) || usedRefs.has(pair.box.ref)) continue;
      taken.add(pair.node.id);
      usedRefs.add(pair.box.ref);
      into.push(pair);
    }
  };

  /** 兄弟をまとめて当て、順序として矛盾しない組だけを残す。 */
  const resolveGroup = (
    comparable: readonly DesignNode[],
    scope: readonly DomLayoutBox[],
    parent: ParentPair,
    vertical: boolean,
  ): void => {
    const takenNodes = new Set<string>();
    const accepted: Pair[] = [];
    // まずは親の対応先の中だけで探す。入れ物の対応が正しいなら、これで当たる。
    takeGreedy(collectPairs(comparable, scope, parent), accepted, takenNodes);

    // 見つからなかったものは画面全体から探し直す。Figma で入れ物の中に描かれている
    // ものが、実装では最上位に置かれていることがある (画面に覆いかぶさるシート等)。
    // 階層の一致を絶対条件にすると、そこから下が丸ごと落ちる。
    const leftover = comparable.filter((node) => !takenNodes.has(node.id));
    if (leftover.length > 0 && allBoxes.length > scope.length) {
      // 逃げ道ではあるが、画面のどこからでも拾えるわけではない。絶対座標で
      // 実際に重なっている相手だけを候補にする。重なりを見ないと、遠くにある
      // 同じ大きさの箱へ当たって、位置のズレが消えたまま通ってしまう。
      for (const node of leftover) {
        const reachable = allBoxes.filter(
          (candidate) => coverageRatio(node.rect, candidate) >= MIN_OVERLAP_RATIO,
        );
        if (reachable.length === 0) continue;
        takeGreedy(collectPairs([node], reachable, parent), accepted, takenNodes);
      }
    }

    // 並びの向きに沿った位置で並べ直してから、順序として矛盾しない組だけを残す。
    // 書類上の並び順で見ると、同じ行に横並びで置かれた要素が順序違反に見える。
    accepted.sort((a, b) =>
      vertical ? a.node.rect.y - b.node.rect.y : a.node.rect.x - b.node.rect.x,
    );
    const kept = keepMonotonic(accepted, vertical);
    const keptIds = new Set(kept.map((pair) => pair.node.id));
    for (const pair of accepted) {
      if (!keptIds.has(pair.node.id)) usedRefs.delete(pair.box.ref);
    }
    for (const pair of kept) matched.set(pair.node.id, pair.box);
  };

  const assignGroup = (
    nodes: DesignNode[],
    scope: readonly DomLayoutBox[],
    parent: ParentPair,
    vertical: boolean,
  ): void => {
    const comparable: DesignNode[] = [];
    for (const node of nodes) {
      if (node.notCompared) markNotCompared(node);
      else comparable.push(node);
    }

    resolveGroup(comparable, scope, parent, vertical);

    for (const node of comparable) {
      const box = matched.get(node.id);
      if (box === undefined) {
        unmatched.push(
          toUnmatched(
            node,
            scope.length === 0
              ? "親の対応先に子要素が無く、突き合わせる相手がいませんでした。"
              : "位置・大きさ・文字のどれでも対応する実装側の要素が見つかりませんでした。",
            "unmatched",
          ),
        );
        // 当てられなかった枠の子は、親の範囲をそのまま受け継いで当てにいく。
        // Figma だけにある入れ物のせいで、その中身まで諦めるのは損。
        if (node.children.length > 0) assignGroup(node.children, scope, parent, vertical);
        continue;
      }
      if (node.children.length === 0) continue;
      assignGroup(
        node.children,
        descendantsOf(index, box.ref),
        { design: node.rect, impl: box },
        node.node.layoutMode !== "HORIZONTAL",
      );
    }
  };

  // 最上位のフレームだけは、実装側のどこに当たるか分からないので全体から探す。
  for (const root of roots) {
    let best: DomLayoutBox | undefined;
    let bestRatio = 0;
    for (const box of allBoxes) {
      const ratio = overlapRatio(root.rect, box);
      if (ratio > bestRatio) {
        bestRatio = ratio;
        best = box;
      }
    }
    if (best === undefined) {
      unmatched.push(toUnmatched(root, "実装側に重なる要素がありませんでした。", "unmatched"));
      continue;
    }
    usedRefs.add(best.ref);
    matched.set(root.id, best);
    if (root.children.length > 0) {
      assignGroup(
        root.children,
        descendantsOf(index, best.ref),
        { design: root.rect, impl: best },
        root.node.layoutMode !== "HORIZONTAL",
      );
    }
  }
  // デザイン側にだけ余っている繰り返しを、実装のズレから切り離す。
  //
  // モックは投稿行を8つ並べていても、測った画面には1件しか入っていないことが
  // ある。これは実装のズレではなく中身の件数の差で、未照合率の分子に入れると
  // 画面ごと「座標系がずれている」と誤って切り捨ててしまう。
  //
  // 条件は2つ。(1) 同じ名前・種類・大きさのノードが、どこかで対応付けできている
  // こと。(2) その位置に、同じくらいの大きさの実装側の要素が1つも無いこと。
  // ただの描き忘れは (1) を満たさないし、ズレて描かれているものは (2) を
  // 満たさないので、どちらも未照合のまま残る。
  const repeatKey = (node: DesignNode): string =>
    `${node.name}|${node.type}|${Math.round(node.rect.width)}x${Math.round(node.rect.height)}`;
  const everyNode: DesignNode[] = [];
  const walk = (node: DesignNode): void => {
    everyNode.push(node);
    for (const child of node.children) walk(child);
  };
  for (const root of roots) walk(root);
  const matchedKeys = new Set<string>();
  for (const node of everyNode) {
    if (matched.has(node.id)) matchedKeys.add(repeatKey(node));
  }
  const byId = new Map(everyNode.map((node) => [node.id, node]));
  for (const entry of unmatched) {
    if (entry.category !== "unmatched") continue;
    const node = byId.get(entry.nodeId);
    if (node === undefined || !matchedKeys.has(repeatKey(node))) continue;
    const occupied = allBoxes.some((box) => overlapRatio(node.rect, box) >= MIN_OVERLAP_RATIO);
    if (occupied) continue;
    entry.category = "surplus-design";
    entry.reason =
      "同じものが別の場所で対応付けできていて、この位置には実装側の要素がありません。デザイン側の繰り返しの数が多いだけなので、判定には使いません。";
  }

  return { matched, unmatched };
}

/** 同じ見た目の箱と見なす寸法差 (px)。 */
export const SAME_RECT_TOLERANCE_PX = 1;

/** 角丸・影の宣言先として辿る子孫の、親に対する面積の下限。 */
export const COVERING_AREA_RATIO = 0.8;

/**
 * その箱の見た目を作っている入れ子の並び。
 *
 * ひとつの見た目の箱が、実装では div > div > button のように何枚にも分かれる。
 * 余白・角丸・影がどの枚に載っているかは実装の自由なので、外側だけを見て
 * 「角丸0」と報告すると、実際には内側に付いている値を見落とす。
 *
 * 「同じ矩形の子」だけを辿ると、外枠が中身より数 px 高いだけで辿れなくなる。
 * 中に収まっていて面積の大半を占める子孫まで広げる。飾りの細帯は面積で落ちる。
 */
function coveringChain(index: BoxIndex, box: DomLayoutBox): DomLayoutBox[] {
  const area = box.width * box.height;
  if (area <= 0) return [box];
  const chain = [box];
  const queue = [...(index.childrenOf.get(box.ref) ?? [])];
  while (queue.length > 0) {
    const child = queue.shift();
    if (!child) break;
    const contained =
      child.x >= box.x - SAME_RECT_TOLERANCE_PX &&
      child.y >= box.y - SAME_RECT_TOLERANCE_PX &&
      child.x + child.width <= box.x + box.width + SAME_RECT_TOLERANCE_PX &&
      child.y + child.height <= box.y + box.height + SAME_RECT_TOLERANCE_PX;
    if (!contained) continue;
    if ((child.width * child.height) / area < COVERING_AREA_RATIO) continue;
    chain.push(child);
    queue.push(...(index.childrenOf.get(child.ref) ?? []));
  }
  return chain;
}

function resolveRadius(chain: readonly DomLayoutBox[]): number | undefined {
  let firstDefined: number | undefined;
  for (const box of chain) {
    if (box.borderRadius === undefined) continue;
    if (firstDefined === undefined) firstDefined = box.borderRadius;
    if (box.borderRadius > 0) return box.borderRadius;
  }
  return firstDefined;
}

function hasOuterShadow(chain: readonly DomLayoutBox[]): boolean {
  return chain.some((box) => box.outerShadow !== undefined);
}

function severityOf(deltaPx: number): MeasureMismatch["severity"] {
  const magnitude = Math.abs(deltaPx);
  if (magnitude >= CRITICAL_DELTA_PX) return "critical";
  if (magnitude >= MAJOR_DELTA_PX) return "major";
  return "minor";
}

function pushMismatch(
  out: MeasureMismatch[],
  node: DesignNode,
  box: DomLayoutBox,
  property: string,
  designPx: number,
  implPx: number,
): void {
  out.push({
    property,
    nodeId: node.id,
    nodeName: node.name,
    nodeType: node.type,
    designPx: Math.round(designPx * 100) / 100,
    implPx: Math.round(implPx * 100) / 100,
    deltaPx: Math.round((implPx - designPx) * 100) / 100,
    severity: severityOf(implPx - designPx),
    implRef: box.ref,
    implTag: box.tag,
    implRect: {
      x: Math.round(box.x),
      y: Math.round(box.y),
      w: Math.round(box.width),
      h: Math.round(box.height),
    },
  });
}

function hasVisibleDropShadow(node: FigmaNode): boolean {
  return (node.effects ?? []).some(
    (effect) => effect.visible !== false && effect.type === "DROP_SHADOW",
  );
}

interface CompareContext {
  index: BoxIndex;
  scale: number;
  compareTypography: boolean;
  mismatches: MeasureMismatch[];
  skipped: Set<string>;
}

function compareNumeric(
  context: CompareContext,
  node: DesignNode,
  box: DomLayoutBox,
  property: string,
  designPx: number,
  implPx: number,
  tolerance: number,
): void {
  if (Math.abs(designPx - implPx) > tolerance) {
    pushMismatch(context.mismatches, node, box, property, designPx, implPx);
  }
}

/** 1組を比べて、比較できた項目数を返す。 */
function comparePair(context: CompareContext, node: DesignNode, box: DomLayoutBox): number {
  const { scale } = context;
  let checked = 0;

  if (node.type === "TEXT") {
    // 文字の枠は、宣言した高さと実際に描かれた行の高さが揃わない。ここを寸法として
    // 比べると、実装が正しい時まで不一致が出る。文字は値そのものだけを比べる。
    context.skipped.add(
      "TEXT ノードの width / height は比較しない (宣言値と実描画が構造的にずれるため)",
    );
    if (!context.compareTypography) {
      context.skipped.add(
        "倍率が 1 から離れているため font-size / line-height は比較しない (CSS px は倍率で伸縮しない)",
      );
      return 0;
    }
    const style = node.node.style;
    if (style?.fontSize !== undefined && box.fontSize !== undefined) {
      checked++;
      compareNumeric(
        context,
        node,
        box,
        "fontSize",
        style.fontSize,
        box.fontSize,
        SIZE_TOLERANCE_PX,
      );
    }
    if (style?.lineHeightPx !== undefined && box.lineHeight !== undefined) {
      checked++;
      compareNumeric(
        context,
        node,
        box,
        "lineHeight",
        style.lineHeightPx,
        box.lineHeight,
        LINE_HEIGHT_TOLERANCE_PX,
      );
    }
    if (style?.fontWeight !== undefined && box.fontWeight !== undefined) {
      checked++;
      compareNumeric(context, node, box, "fontWeight", style.fontWeight, box.fontWeight, 0);
    }
    return checked;
  }

  // 寸法は葉だけを比べる。入れ物の寸法は中身と余白から決まるので、そこがズレて
  // いれば padding / gap / 積み上げの検算のほうに出る。入れ物まで比べると、
  // Figma では幅いっぱいに引いてある枠が実装では中身の幅になる、という
  // 「どちらも正しい」差が大量に混じって読めなくなる。
  if (node.children.length === 0) {
    checked += 2;
    compareNumeric(context, node, box, "width", node.rect.width, box.width, SIZE_TOLERANCE_PX);
    compareNumeric(context, node, box, "height", node.rect.height, box.height, SIZE_TOLERANCE_PX);
  } else {
    context.skipped.add(
      "子を持つノードの width / height は比較しない (中身と余白から決まるため。padding / gap / 積み上げの検算で見る)",
    );
  }

  const figma = node.node;
  const chain = coveringChain(context.index, box);

  const implRadius = resolveRadius(chain);
  if (figma.cornerRadius !== undefined && implRadius !== undefined) {
    checked++;
    compareNumeric(
      context,
      node,
      box,
      "borderRadius",
      figma.cornerRadius * scale,
      implRadius,
      SIZE_TOLERANCE_PX,
    );
  }

  // 影は値まで揃えるのが難しいので、あるか無いかだけを見る。縁として描かれた
  // 内側の影は採取の時点で切り分けてあるので、ここには来ない。
  const designHasShadow = hasVisibleDropShadow(figma);
  const implHasShadow = hasOuterShadow(chain);
  if (designHasShadow !== implHasShadow) {
    checked++;
    pushMismatch(
      context.mismatches,
      node,
      box,
      "boxShadowPresence",
      designHasShadow ? 1 : 0,
      implHasShadow ? 1 : 0,
    );
  } else if (designHasShadow) {
    checked++;
  }

  return checked;
}

/**
 * 実際に空いている間隔を比べる。
 *
 * Figma の padding / itemSpacing と CSS の padding / gap を直接比べてはいけない。
 * 実装は同じ見た目を margin でも絶対配置でも作れるので、宣言した値が違っても
 * 目に見える間隔は合っていることがある。逆も起きる。目で見て分かる差だけを
 * 出したいので、両側とも「矩形から計算した実際の間隔」に直してから比べる。
 */
function compareLayout(
  context: CompareContext,
  node: DesignNode,
  box: DomLayoutBox,
  matched: ReadonlyMap<string, DomLayoutBox>,
): number {
  const pairs: { node: DesignNode; box: DomLayoutBox }[] = [];
  for (const child of node.children) {
    const childBox = matched.get(child.id);
    if (childBox !== undefined) pairs.push({ node: child, box: childBox });
  }
  if (pairs.length === 0) return 0;

  const vertical =
    node.node.layoutMode === "HORIZONTAL"
      ? false
      : node.node.layoutMode === "VERTICAL"
        ? true
        : inferVertical(pairs.map((pair) => pair.node.rect));

  const designStart = (rect: Rect): number => (vertical ? rect.y : rect.x);
  const designSize = (rect: Rect): number => (vertical ? rect.height : rect.width);
  const implStart = (target: DomLayoutBox): number => (vertical ? target.y : target.x);
  const implSize = (target: DomLayoutBox): number => (vertical ? target.height : target.width);
  const crossDesignStart = (rect: Rect): number => (vertical ? rect.x : rect.y);
  const crossDesignSize = (rect: Rect): number => (vertical ? rect.width : rect.height);
  const crossImplStart = (target: DomLayoutBox): number => (vertical ? target.x : target.y);
  const crossImplSize = (target: DomLayoutBox): number => (vertical ? target.width : target.height);

  const ordered = [...pairs].sort((a, b) => designStart(a.node.rect) - designStart(b.node.rect));

  // 寸法が実装側と違う要素は、その先の間隔を比べる基準にならない。文字は内容の幅に
  // なるし、入れ物も中身の分だけ伸びる。基準が違うまま比べると、どちらも正しいのに
  // 間隔がずれた扱いになる。
  const axisSizeDiffers = (pair: { node: DesignNode; box: DomLayoutBox }): boolean =>
    Math.abs(designSize(pair.node.rect) - implSize(pair.box)) > SIZE_TOLERANCE_PX;
  const crossSizeDiffers = (pair: { node: DesignNode; box: DomLayoutBox }): boolean =>
    Math.abs(crossDesignSize(pair.node.rect) - crossImplSize(pair.box)) > SIZE_TOLERANCE_PX;

  let checked = 0;

  const first = ordered[0];
  checked++;
  compareNumeric(
    context,
    node,
    box,
    "insetStart",
    designStart(first.node.rect) - designStart(node.rect),
    implStart(first.box) - implStart(box),
    SIZE_TOLERANCE_PX,
  );

  // 閉じ側の余白は、入れ物の寸法が揃っている時にだけ意味を持つ。実装のページは
  // 中身の分だけ伸びるので、デザインの決まった高さと比べると必ず食い違う。
  const sizeComparable = Math.abs(designSize(node.rect) - implSize(box)) <= SIZE_TOLERANCE_PX;
  const crossSizeComparable =
    Math.abs(crossDesignSize(node.rect) - crossImplSize(box)) <= SIZE_TOLERANCE_PX;
  if (!sizeComparable) {
    context.skipped.add(
      "入れ物の寸法が実装側と違う場合、閉じ側の余白は比較しない (比べる基準が揃わないため)",
    );
  }
  const last = ordered[ordered.length - 1];
  if (sizeComparable && !axisSizeDiffers(last)) {
    checked++;
    compareNumeric(
      context,
      node,
      box,
      "insetEnd",
      designStart(node.rect) +
        designSize(node.rect) -
        (designStart(last.node.rect) + designSize(last.node.rect)),
      implStart(box) + implSize(box) - (implStart(last.box) + implSize(last.box)),
      SIZE_TOLERANCE_PX,
    );
  }

  for (let i = 1; i < ordered.length; i++) {
    const previous = ordered[i - 1];
    const current = ordered[i];
    if (axisSizeDiffers(previous)) {
      context.skipped.add(
        "手前の要素の寸法が実装側と違う場合、その次との間隔は比較しない (基準が揃わないため)",
      );
      continue;
    }
    const designGap =
      designStart(current.node.rect) -
      (designStart(previous.node.rect) + designSize(previous.node.rect));
    if (designGap < 0) {
      // デザイン側で要素が重なっている (図形を重ねた作り)。積み上げの考え方が成り立たない。
      context.skipped.add("デザイン側で要素が重なっている箇所の間隔は比較しない");
      continue;
    }
    checked++;
    compareNumeric(
      context,
      current.node,
      current.box,
      "gapBefore",
      designStart(current.node.rect) -
        (designStart(previous.node.rect) + designSize(previous.node.rect)),
      implStart(current.box) - (implStart(previous.box) + implSize(previous.box)),
      SIZE_TOLERANCE_PX,
    );
  }

  checked += compareCrossInsets(context, node, box, ordered, {
    crossDesignStart,
    crossDesignSize,
    crossImplStart,
    crossImplSize,
    crossSizeComparable,
    crossSizeDiffers,
  });

  return checked;
}

interface CrossAxisAccess {
  crossDesignStart: (rect: Rect) => number;
  crossDesignSize: (rect: Rect) => number;
  crossImplStart: (target: DomLayoutBox) => number;
  crossImplSize: (target: DomLayoutBox) => number;
  crossSizeComparable: boolean;
  crossSizeDiffers: (pair: { node: DesignNode; box: DomLayoutBox }) => boolean;
}

/**
 * 並びと直交する向きの内側余白を比べる。
 * 行が何本あっても原因は1つなので、同じ値の食い違いは1件に畳む。
 */
function compareCrossInsets(
  context: CompareContext,
  node: DesignNode,
  box: DomLayoutBox,
  ordered: readonly { node: DesignNode; box: DomLayoutBox }[],
  access: CrossAxisAccess,
): number {
  const { crossDesignStart, crossDesignSize, crossImplStart, crossImplSize } = access;
  let checked = 0;
  const seen = new Set<string>();
  for (const pair of ordered) {
    const entries: [string, number, number][] = [
      [
        "insetLeading",
        crossDesignStart(pair.node.rect) - crossDesignStart(node.rect),
        crossImplStart(pair.box) - crossImplStart(box),
      ],
      [
        "insetTrailing",
        crossDesignStart(node.rect) +
          crossDesignSize(node.rect) -
          (crossDesignStart(pair.node.rect) + crossDesignSize(pair.node.rect)),
        crossImplStart(box) +
          crossImplSize(box) -
          (crossImplStart(pair.box) + crossImplSize(pair.box)),
      ],
    ];
    for (const [property, designPx, implPx] of entries) {
      // 文字の右端は内容の幅で決まる。デザインの枠は幅いっぱいに引かれていることが
      // 多いので、閉じ側の余白を比べると必ず食い違う。
      if (
        property === "insetTrailing" &&
        (!access.crossSizeComparable || access.crossSizeDiffers(pair))
      ) {
        context.skipped.add(
          "寸法が実装側と違う要素の閉じ側の余白は比較しない (開き側と両方が合うことはないため)",
        );
        continue;
      }
      checked++;
      if (Math.abs(designPx - implPx) <= SIZE_TOLERANCE_PX) continue;
      const key = `${property}:${Math.round(designPx)}:${Math.round(implPx)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pushMismatch(context.mismatches, pair.node, pair.box, property, designPx, implPx);
    }
  }

  return checked;
}

/** 並びの向きを子の矩形から推し量る。縦に重なりが無ければ縦積みと見る。 */
function inferVertical(rects: readonly Rect[]): boolean {
  if (rects.length < 2) return true;
  let verticalSeparated = 0;
  let horizontalSeparated = 0;
  for (let i = 1; i < rects.length; i++) {
    const a = rects[i - 1];
    const b = rects[i];
    if (b.y >= a.y + a.height - 1 || a.y >= b.y + b.height - 1) verticalSeparated++;
    if (b.x >= a.x + a.width - 1 || a.x >= b.x + b.width - 1) horizontalSeparated++;
  }
  return verticalSeparated >= horizontalSeparated;
}

/**
 * 積み上げの検算。
 *
 * デザイン側は「宣言した余白と間隔」で親の寸法が閉じるかを見る。閉じないなら、
 * その親の中に勘定へ入っていない要素 (非表示・絶対配置) があり、デザイン側の
 * 読み取り自体が当てにならない。
 *
 * 実装側は参考値として同じ計算を CSS の値で行う。閉じない場合は margin や
 * 絶対配置で組んであるという意味で、それ自体は誤りではない。
 */
function buildStackCheck(
  node: DesignNode,
  box: DomLayoutBox,
  index: BoxIndex,
  matched: ReadonlyMap<string, DomLayoutBox>,
): StackCheck | undefined {
  const figma = node.node;
  if (figma.layoutMode !== "VERTICAL" && figma.layoutMode !== "HORIZONTAL") return undefined;
  if (node.children.length === 0) return undefined;
  const vertical = figma.layoutMode === "VERTICAL";

  const designChildren = node.children;
  const designSize = vertical
    ? (figma.absoluteBoundingBox?.height ?? 0)
    : (figma.absoluteBoundingBox?.width ?? 0);
  const designStart = (vertical ? figma.paddingTop : figma.paddingLeft) ?? 0;
  const designEnd = (vertical ? figma.paddingBottom : figma.paddingRight) ?? 0;
  const designGap = (figma.itemSpacing ?? 0) * Math.max(0, designChildren.length - 1);
  const designChildSum = designChildren.reduce((sum, child) => {
    const childBox = child.node.absoluteBoundingBox;
    return sum + (vertical ? (childBox?.height ?? 0) : (childBox?.width ?? 0));
  }, 0);
  const designResidual = designSize - designStart - designEnd - designGap - designChildSum;

  const implChildren = index.childrenOf.get(box.ref) ?? [];
  const implStart = vertical ? box.paddingTop : box.paddingLeft;
  const implEnd = vertical ? box.paddingBottom : box.paddingRight;
  const implGapUnit = (vertical ? box.rowGap : box.columnGap) ?? 0;
  const implGap = implGapUnit * Math.max(0, implChildren.length - 1);
  const implChildSum = implChildren.reduce((sum, child) => {
    const size = vertical ? child.height : child.width;
    const outer = vertical
      ? child.marginTop + child.marginBottom
      : child.marginLeft + child.marginRight;
    return sum + size + outer;
  }, 0);
  const implSize = vertical ? box.height : box.width;
  const implResidual = implSize - implStart - implEnd - implGap - implChildSum;

  const matchedChildCount = designChildren.filter((child) => matched.has(child.id)).length;
  const allChildrenMatched = matchedChildCount === designChildren.length;
  const designCloses = Math.abs(designResidual) <= STACK_RESIDUAL_TOLERANCE_PX;
  const verified = designCloses && allChildrenMatched;

  let note: string | undefined;
  if (!designCloses) {
    note = `デザイン側の勘定が ${Math.round(designResidual)}px 合いません。この親の中に、宣言した余白と間隔では説明できない要素があります。`;
  } else if (!allChildrenMatched) {
    note = `子 ${designChildren.length} 件のうち ${designChildren.length - matchedChildCount} 件が実装側と対応づいていません。`;
  }

  return {
    nodeId: node.id,
    nodeName: node.name,
    axis: vertical ? "vertical" : "horizontal",
    designChildCount: designChildren.length,
    implChildCount: implChildren.length,
    designResidualPx: Math.round(designResidual * 100) / 100,
    implResidualPx: Math.round(implResidual * 100) / 100,
    verified,
    note,
  };
}

function flatten(node: DesignNode, out: DesignNode[]): void {
  out.push(node);
  for (const child of node.children) flatten(child, out);
}

/**
 * Figma のノードと実装の DOM を突き合わせ、寸法・余白・文字の大きさの違いを列挙する。
 * 対応付けの当たり具合も一緒に返すので、呼び出し側は「この結果を信じてよいか」を
 * 自分で判断できる。
 */
export function runMeasureDiff(input: MeasureDiffInput): MeasureDiffReport {
  const frameBox = input.figmaRootNode.absoluteBoundingBox;
  if (!frameBox || frameBox.width <= 0) {
    return {
      designNodeCount: 0,
      matchedNodeCount: 0,
      unmatchedNodeCount: 0,
      notComparedNodeCount: 0,
      unmatchedRatio: 0,
      checkedPropertyCount: 0,
      scale: 1,
      mismatches: [],
      unmatchedDesignNodes: [],
      stackChecks: [],
      reliable: false,
      demotionReason: "Figma フレームの寸法が取れなかったため、座標を突き合わせられませんでした。",
      skipped: [],
    };
  }

  const scale = input.screenshotWidth / frameBox.width;
  const root = buildDesignTree(input.figmaRootNode, frameBox, scale);
  if (!root) {
    return {
      designNodeCount: 0,
      matchedNodeCount: 0,
      unmatchedNodeCount: 0,
      notComparedNodeCount: 0,
      unmatchedRatio: 0,
      checkedPropertyCount: 0,
      scale,
      mismatches: [],
      unmatchedDesignNodes: [],
      stackChecks: [],
      reliable: false,
      demotionReason: "デザイン側に表示されているノードが見つかりませんでした。",
      skipped: [],
    };
  }

  const index = indexBoxes(input.domBoxes);
  const { matched, unmatched } = assignTree([root], index, input.domBoxes);

  const all: DesignNode[] = [];
  flatten(root, all);

  const context: CompareContext = {
    index,
    scale,
    compareTypography: Math.abs(scale - 1) <= SCALE_TOLERANCE,
    mismatches: [],
    skipped: new Set<string>([
      "margin は Figma に対応する概念が無いため単独では比較しない (積み上げの検算にのみ使う)",
    ]),
  };

  let matchedNodeCount = 0;
  let checkedPropertyCount = 0;
  const stackChecks: StackCheck[] = [];

  for (const node of all) {
    const box = matched.get(node.id);
    if (box === undefined) continue;
    const checked = comparePair(context, node, box) + compareLayout(context, node, box, matched);
    if (checked > 0) {
      matchedNodeCount++;
      checkedPropertyCount += checked;
    }
    const stack = buildStackCheck(node, box, index, matched);
    if (stack) stackChecks.push(stack);
  }

  const notComparedNodeCount = unmatched.filter(
    (entry) => entry.category !== "unmatched",
  ).length;
  const unmatchedNodeCount = unmatched.length - notComparedNodeCount;
  // 分母は「突き合わせる相手が構造として存在するノード」だけ。アイコンの中身を
  // 混ぜると、実装が正しくても未照合率が上がって判定が壊れる。
  const designNodeCount = all.length - notComparedNodeCount;
  const unmatchedRatio = designNodeCount === 0 ? 1 : unmatchedNodeCount / designNodeCount;

  let demotionReason: string | undefined;
  if (designNodeCount === 0) {
    demotionReason = "デザイン側に比較できるノードがありませんでした。";
  } else if (matchedNodeCount < MIN_COMPARABLE_NODES) {
    demotionReason = `対応付けできたノードが ${matchedNodeCount} 件しかなく、判断材料として足りません (最低 ${MIN_COMPARABLE_NODES} 件)。`;
  } else if (unmatchedRatio > MAX_UNMATCHED_RATIO) {
    demotionReason = `${designNodeCount} 件中 ${unmatchedNodeCount} 件が対応付けできませんでした (${Math.round(
      unmatchedRatio * 100,
    )}%)。座標系がずれている可能性が高いため、この結果は判定に使いません。`;
  }

  const mismatches = [...context.mismatches].sort(
    (a, b) => Math.abs(b.deltaPx) - Math.abs(a.deltaPx),
  );

  return {
    designNodeCount,
    matchedNodeCount,
    unmatchedNodeCount,
    notComparedNodeCount,
    unmatchedRatio,
    checkedPropertyCount,
    scale,
    mismatches,
    unmatchedDesignNodes: unmatched,
    stackChecks,
    reliable: demotionReason === undefined,
    demotionReason,
    skipped: [...context.skipped],
  };
}

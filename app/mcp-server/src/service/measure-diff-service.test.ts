// 合否の根拠は「自分でズレを仕込んだ合成データ」で取る。
//
// 手で書いた別の突合スクリプトと答え合わせをすると、採点する側と採点される側が
// 同じ見落としを共有していても合格になる。仕込んだ件数と中身が分かっている
// データなら、見逃しと誤検知の両方を数えられる。
//
// 「今までに踏んだ誤検知」の節は、実画面で実際に出た誤りをそのまま形にしている。
// 合成データが本番の複雑さに届いていなかった、という失敗の記録でもある。

import { describe, expect, it } from "vitest";

import type { DomElementStyle, DomLayoutBox, FigmaNode } from "@figdiff/shared";

import type { DesignNode, ParentPair } from "./measure-diff-service.js";
import { pairScore, runMeasureDiff } from "./measure-diff-service.js";
import { runTokenDiff } from "./token-diff-service.js";

const FRAME_WIDTH = 375;
const FRAME_HEIGHT = 116;

function node(partial: Partial<FigmaNode> & Pick<FigmaNode, "id" | "name" | "type">): FigmaNode {
  return { children: [], fills: [], strokes: [], effects: [], ...partial };
}

function box(
  partial: Partial<DomLayoutBox> & Pick<DomLayoutBox, "ref" | "depth" | "tag">,
): DomLayoutBox {
  return {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    marginTop: 0,
    marginRight: 0,
    marginBottom: 0,
    marginLeft: 0,
    ...partial,
  };
}

/**
 * デザイン側。縦積み・上下左右の余白16・間隔12。
 * 116 = 16 + 文字24 + 間隔12 + 箱48 + 16 で、積み上げが閉じている。
 */
function designFrame(overrides?: {
  textHeight?: number;
  cardShadow?: boolean;
  orphan?: boolean;
  iconInstance?: boolean;
}): FigmaNode {
  const children: FigmaNode[] = [
    node({
      id: "2:1",
      name: "見出し",
      type: "TEXT",
      characters: "サンプル見出し",
      absoluteBoundingBox: { x: 16, y: 16, width: 343, height: overrides?.textHeight ?? 24 },
      style: { fontSize: 16, lineHeightPx: 24, fontWeight: 700 },
    }),
    node({
      id: "2:2",
      name: "カード",
      type: "RECTANGLE",
      absoluteBoundingBox: { x: 16, y: 52, width: 343, height: 48 },
      cornerRadius: 8,
      effects:
        overrides?.cardShadow === true ? [{ type: "DROP_SHADOW", visible: true, radius: 8 }] : [],
    }),
  ];
  if (overrides?.orphan === true) {
    children.push(
      node({
        id: "2:9",
        name: "実装に存在しない飾り",
        type: "RECTANGLE",
        absoluteBoundingBox: { x: 16, y: 200, width: 100, height: 20 },
      }),
    );
  }
  if (overrides?.iconInstance === true) {
    children.push(
      node({
        id: "3:1",
        name: "Icon",
        type: "INSTANCE",
        absoluteBoundingBox: { x: 331, y: 16, width: 28, height: 28 },
        children: [
          node({
            id: "3:2",
            name: "Text",
            type: "TEXT",
            characters: "bookmark",
            absoluteBoundingBox: { x: 337, y: 20, width: 16, height: 20 },
            style: { fontSize: 16, lineHeightPx: 20, fontWeight: 400 },
          }),
        ],
      }),
    );
  }
  return node({
    id: "1:1",
    name: "フレーム",
    type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width: FRAME_WIDTH, height: FRAME_HEIGHT },
    layoutMode: "VERTICAL",
    paddingTop: 16,
    paddingBottom: 16,
    paddingLeft: 16,
    paddingRight: 16,
    itemSpacing: 12,
    children,
  });
}

type ImplOverrides = Partial<{
  rootHeight: number;
  textY: number;
  textHeight: number;
  textWidth: number;
  textFontSize: number;
  textLineHeight: number;
  cardY: number;
  cardHeight: number;
  cardBorderRadius: number | undefined;
  cardOuterShadow: string;
  cardRingShadow: string;
  cardInnerRadius: number;
  iconSvg: boolean;
}>;

/** 実装側。既定はデザインと完全に一致した状態。 */
function implBoxes(overrides?: ImplOverrides): DomLayoutBox[] {
  const o = overrides ?? {};
  const boxes: DomLayoutBox[] = [
    box({
      ref: 0,
      depth: 0,
      tag: "div",
      x: 0,
      y: 0,
      width: FRAME_WIDTH,
      height: o.rootHeight ?? FRAME_HEIGHT,
      display: "flex",
      flexDirection: "column",
    }),
    box({
      ref: 1,
      parentRef: 0,
      depth: 1,
      tag: "h2",
      x: 16,
      y: o.textY ?? 16,
      width: o.textWidth ?? 343,
      height: o.textHeight ?? 24,
      text: "サンプル見出し",
      fontSize: o.textFontSize ?? 16,
      lineHeight: o.textLineHeight ?? 24,
      fontWeight: 700,
      color: "rgb(20, 23, 28)",
    }),
    box({
      ref: 2,
      parentRef: 0,
      depth: 1,
      tag: "div",
      x: 16,
      y: o.cardY ?? 52,
      width: 343,
      height: o.cardHeight ?? 48,
      borderRadius: "cardBorderRadius" in o ? o.cardBorderRadius : 8,
      backgroundColor: "rgb(255, 255, 255)",
      outerShadow: o.cardOuterShadow,
      ringShadow: o.cardRingShadow,
    }),
  ];
  if (o.cardInnerRadius !== undefined) {
    boxes.push(
      box({
        ref: 3,
        parentRef: 2,
        depth: 2,
        tag: "div",
        x: 16,
        y: o.cardY ?? 52,
        width: 343,
        height: o.cardHeight ?? 48,
        borderRadius: o.cardInnerRadius,
      }),
    );
  }
  if (o.iconSvg === true) {
    boxes.push(
      box({ ref: 4, parentRef: 0, depth: 1, tag: "svg", x: 331, y: 16, width: 28, height: 28 }),
    );
  }
  return boxes;
}

function keys(report: ReturnType<typeof runMeasureDiff>): string[] {
  return report.mismatches.map((mismatch) => `${mismatch.nodeId}:${mismatch.property}`).sort();
}

const run = (design: FigmaNode, boxes: DomLayoutBox[]): ReturnType<typeof runMeasureDiff> =>
  runMeasureDiff({ figmaRootNode: design, domBoxes: boxes, screenshotWidth: FRAME_WIDTH });

describe("runMeasureDiff — 一致しているデータでは1件も出さない", () => {
  it("誤検知が0件で、積み上げの検算も両側で閉じる", () => {
    const report = run(designFrame(), implBoxes());

    expect(report.mismatches).toEqual([]);
    expect(report.unmatchedDesignNodes).toEqual([]);
    expect(report.reliable).toBe(true);

    const rootStack = report.stackChecks.find((check) => check.nodeId === "1:1");
    expect(rootStack?.verified).toBe(true);
    expect(rootStack?.designResidualPx).toBe(0);
  });
});

describe("runMeasureDiff — 仕込んだ件数をちょうど出す", () => {
  // 仕込みは7件。見逃し0・誤検知0でなければ不合格。
  const PLANTED = [
    "1:1:insetEnd",
    "1:1:insetStart",
    "2:1:fontSize",
    "2:1:lineHeight",
    "2:2:borderRadius",
    "2:2:boxShadowPresence",
    "2:2:gapBefore",
  ];

  const report = run(
    designFrame(),
    implBoxes({
      textY: 24,
      textFontSize: 15,
      textLineHeight: 21,
      cardY: 64,
      cardBorderRadius: 4,
      cardOuterShadow: "rgba(0, 0, 0, 0.2) 0px 2px 8px",
    }),
  );

  it("仕込んだ7件と完全に一致する", () => {
    expect(keys(report)).toEqual([...PLANTED].sort());
  });

  it("値は「デザイン → 実装」で読める形で入る", () => {
    const insetStart = report.mismatches.find((m) => m.property === "insetStart");
    expect(insetStart?.designPx).toBe(16);
    expect(insetStart?.implPx).toBe(24);
    expect(insetStart?.deltaPx).toBe(8);

    const gap = report.mismatches.find((m) => m.property === "gapBefore");
    expect(gap?.designPx).toBe(12);
    expect(gap?.implPx).toBe(16);
  });

  it("差の大きい順に並ぶ", () => {
    const deltas = report.mismatches.map((m) => Math.abs(m.deltaPx));
    expect([...deltas].sort((a, b) => b - a)).toEqual(deltas);
  });
});

describe("runMeasureDiff — 実画面で踏んだ誤検知を出さない", () => {
  it("縁として描かれた内側の影を、影ありとして数えない", () => {
    const report = run(
      designFrame(),
      implBoxes({ cardRingShadow: "rgb(255, 255, 255) 0px 0px 0px 2px inset" }),
    );
    expect(keys(report)).toEqual([]);
  });

  it("文字の枠の高さの食い違いを、寸法のズレとして数えない", () => {
    // 宣言した文字枠 24px に対し、実際に描かれた行の箱は 21px。
    // これは実装の誤りではなく、両者が別の量を表しているだけ。
    const report = run(designFrame(), implBoxes({ textHeight: 21, cardY: 49, rootHeight: 113 }));
    expect(keys(report)).toEqual([]);
  });

  it("実装側で文字幅が内容ぴったりになっても、対応付けを外さない", () => {
    // Figma のテキスト枠は幅いっぱい (343px)、実装は内容の幅 (120px)。
    // 重なりだけで突き合わせると、同じ文字なのに当たらない。
    const report = run(designFrame(), implBoxes({ textWidth: 120 }));
    expect(keys(report)).toEqual([]);
    expect(report.unmatchedDesignNodes).toEqual([]);
  });

  it("余白の宣言先が入れ子の内側でも、角丸を見落とさない", () => {
    // 実装は外側 div の角丸を 0 にして、同じ矩形の内側 div に 8px を載せている。
    // 外側だけを見ると「角丸が無い」と誤って報告する。
    const report = run(designFrame(), implBoxes({ cardBorderRadius: 0, cardInnerRadius: 8 }));
    expect(keys(report)).toEqual([]);
  });

  it("px へ直せない角丸 (割合指定) は比較しない", () => {
    const report = run(designFrame(), implBoxes({ cardBorderRadius: undefined }));
    expect(keys(report)).toEqual([]);
  });

  it("デザイン側に影があり実装側に無い場合は、ちゃんと1件出す", () => {
    const report = run(designFrame({ cardShadow: true }), implBoxes());
    expect(keys(report)).toEqual(["2:2:boxShadowPresence"]);
  });
});

describe("runMeasureDiff — 寸法のズレは1件に閉じる", () => {
  it("葉の高さが違う時、その先の余白まで巻き込んで報告しない", () => {
    // 高さが違えば閉じ側の余白も必ずずれる。原因は1つなので、報告も1つ。
    const report = run(designFrame(), implBoxes({ cardHeight: 44, rootHeight: 112 }));
    expect(keys(report)).toEqual(["2:2:height"]);
  });
});

describe("runMeasureDiff — ずれが1箇所なら報告も1箇所", () => {
  it("上の余白が8px狭いだけなら、下の要素まで巻き込んで報告しない", () => {
    // 実装の上余白が 16→8。以降の要素は全部 8px 上へずれる。絶対座標で比べると
    // 全要素がズレ扱いになるが、原因は1箇所。
    const report = run(designFrame(), implBoxes({ textY: 8, cardY: 44, rootHeight: 108 }));
    expect(keys(report)).toEqual(["1:1:insetStart"]);
  });
});

describe("runMeasureDiff — 対応がつかないノードの扱い", () => {
  it("実装に無いノードは名前つきで1件ずつ出す", () => {
    const report = run(designFrame({ orphan: true }), implBoxes());

    const unmatched = report.unmatchedDesignNodes.filter((u) => u.category === "unmatched");
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0].nodeName).toBe("実装に存在しない飾り");
    expect(unmatched[0].reason).not.toBe("");
    expect(report.reliable).toBe(true);
  });

  it("アイコン部品の中身は未照合率の分母に入れない", () => {
    // Figma のアイコンは中に文字ノードを持つが、実装側は svg 1枚。
    // これを未照合として数えると、実装が正しくても信頼度が落ちる。
    const report = run(designFrame({ iconInstance: true }), implBoxes({ iconSvg: true }));

    const notCompared = report.unmatchedDesignNodes.filter((u) => u.category === "not-compared");
    expect(notCompared.map((u) => u.nodeId)).toEqual(["3:2"]);
    expect(report.notComparedNodeCount).toBe(1);
    expect(report.unmatchedNodeCount).toBe(0);
    expect(report.unmatchedRatio).toBe(0);
    expect(report.reliable).toBe(true);
  });
});

describe("runMeasureDiff — 階層が実装と違っていても追える", () => {
  it("デザインでは入れ物の中、実装では最上位に置かれたシートを取りこぼさない", () => {
    const design = node({
      id: "1:1",
      name: "画面",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: FRAME_WIDTH, height: 800 },
      children: [
        node({
          id: "2:1",
          name: "Overlay",
          type: "FRAME",
          absoluteBoundingBox: { x: 0, y: 0, width: FRAME_WIDTH, height: 800 },
          children: [
            node({
              id: "3:1",
              name: "Bottom Drawer",
              type: "FRAME",
              absoluteBoundingBox: { x: 0, y: 574, width: FRAME_WIDTH, height: 226 },
              children: [
                node({
                  id: "4:1",
                  name: "タイトル",
                  type: "TEXT",
                  characters: "シートの見出し",
                  absoluteBoundingBox: { x: 16, y: 610, width: 343, height: 24 },
                  style: { fontSize: 16, lineHeightPx: 24, fontWeight: 700 },
                }),
              ],
            }),
          ],
        }),
      ],
    });

    // 実装ではシートが本文の兄弟として最上位に置かれている。
    const boxes: DomLayoutBox[] = [
      box({ ref: 0, depth: 0, tag: "body", x: 0, y: 0, width: FRAME_WIDTH, height: 812 }),
      box({
        ref: 1,
        parentRef: 0,
        depth: 1,
        tag: "div",
        x: 0,
        y: 0,
        width: FRAME_WIDTH,
        height: 759,
      }),
      box({
        ref: 2,
        parentRef: 0,
        depth: 1,
        tag: "div",
        x: 0,
        y: 574,
        width: FRAME_WIDTH,
        height: 226,
      }),
      box({
        ref: 3,
        parentRef: 2,
        depth: 2,
        tag: "h2",
        x: 16,
        y: 610,
        width: 120,
        height: 24,
        text: "シートの見出し",
        fontSize: 16,
        lineHeight: 24,
        fontWeight: 700,
      }),
    ];

    const report = runMeasureDiff({
      figmaRootNode: design,
      domBoxes: boxes,
      screenshotWidth: FRAME_WIDTH,
    });
    expect(report.unmatchedDesignNodes.filter((u) => u.category === "unmatched")).toEqual([]);
    expect(keys(report)).toEqual([]);
  });
});

describe("既存の値経路が見ていなかった範囲", () => {
  // 何が足りなかったのかを、道具そのもので固定しておく。
  // 「直したつもりが元から出ていた」を後から切り分けられるようにするため。
  it("色と文字の経路は、間隔・余白・寸法・角丸のズレを1件も出さない", () => {
    const planted = implBoxes({ textY: 24, cardY: 64, cardHeight: 44, cardBorderRadius: 4 });
    const domStyles: DomElementStyle[] = planted.map((entry) => ({
      tag: entry.tag,
      text: entry.text,
      x: entry.x,
      y: entry.y,
      width: entry.width,
      height: entry.height,
      color: entry.color,
      backgroundColor: entry.backgroundColor,
      fontSize: entry.fontSize,
      fontWeight: entry.fontWeight,
      lineHeight: entry.lineHeight,
    }));

    const tokenReport = runTokenDiff({
      figmaRootNode: designFrame(),
      domStyles,
      screenshotWidth: FRAME_WIDTH,
    });
    const spatial = tokenReport.mismatches.filter((mismatch) =>
      ["gapBefore", "insetStart", "insetEnd", "height", "width", "borderRadius"].includes(
        mismatch.property,
      ),
    );
    expect(spatial).toEqual([]);
  });
});

/** pairScore を直接叩くための最小の DesignNode。 */
function designNode(
  id: string,
  name: string,
  rect: { x: number; y: number; width: number; height: number },
  children: DesignNode[] = [],
): DesignNode {
  return {
    id,
    name,
    type: "FRAME",
    node: node({ id, name, type: "FRAME" }),
    rect,
    children,
    notCompared: false,
  };
}

describe("pairScore — 位置が合っているだけでは通さない", () => {
  const parent: ParentPair = {
    design: { x: 0, y: 0, width: 375, height: 84 },
    impl: { x: 0, y: 0, width: 375, height: 84 },
  };

  // dev-f のプレイリスト行で実際に踏んだ組み合わせ。
  // 80x84 のサムネ枠に対して、同じ左上に居る 72x12 の飾り帯が当たっていた。
  const table: { label: string; design: [number, number]; impl: [number, number]; offset: number; pass: boolean }[] =
    [
      { label: "枠84に対して飾り帯12", design: [80, 84], impl: [72, 12], offset: 0, pass: false },
      { label: "枠84に対して本体80", design: [80, 84], impl: [80, 80], offset: 0, pass: true },
      { label: "1px の箱", design: [80, 84], impl: [1, 1], offset: 0, pass: false },
      { label: "同じ大きさで少しずれる", design: [80, 84], impl: [80, 84], offset: 8, pass: true },
    ];

  for (const entry of table) {
    it(`${entry.label} は ${entry.pass ? "候補になる" : "候補にしない"}`, () => {
      const design = designNode("2:1", "サムネ", {
        x: 0,
        y: 0,
        width: entry.design[0],
        height: entry.design[1],
      });
      const score = pairScore(
        design,
        box({
          ref: 1,
          parentRef: 0,
          depth: 1,
          tag: "div",
          x: entry.offset,
          y: 0,
          width: entry.impl[0],
          height: entry.impl[1],
        }),
        parent,
      );
      if (entry.pass) expect(score).toBeGreaterThan(0);
      else expect(score).toBe(0);
    });
  }
});

describe("runMeasureDiff — dev-f のプレイリスト行で踏んだ誤検知を出さない", () => {
  // デザイン: 80x84 のサムネ枠 (角丸8)。
  // 実装: 枠 80x84 > 飾り帯 72x12 (上だけ角丸) + 本体 80x80 (角丸8)。
  const design = node({
    id: "1:1",
    name: "行",
    type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width: FRAME_WIDTH, height: 84 },
    children: [
      node({
        id: "2:1",
        name: "image 6",
        type: "RECTANGLE",
        cornerRadius: 8,
        absoluteBoundingBox: { x: 16, y: 0, width: 80, height: 84 },
      }),
    ],
  });

  const boxes: DomLayoutBox[] = [
    box({ ref: 0, depth: 0, tag: "body", x: 0, y: 0, width: FRAME_WIDTH, height: 84 }),
    box({ ref: 1, parentRef: 0, depth: 1, tag: "div", x: 16, y: 0, width: 80, height: 84 }),
    box({ ref: 2, parentRef: 1, depth: 2, tag: "div", x: 20, y: 0, width: 72, height: 12 }),
    box({
      ref: 3,
      parentRef: 1,
      depth: 2,
      tag: "div",
      x: 16,
      y: 4,
      width: 80,
      height: 80,
      borderRadius: 8,
    }),
  ];

  it("飾り帯をサムネ枠に当てず、高さも角丸も1件も出さない", () => {
    const report = run(design, boxes);
    expect(keys(report)).toEqual([]);
  });
});

describe("runMeasureDiff — デザイン側にだけ余る繰り返し", () => {
  const rows = (count: number) =>
    node({
      id: "1:1",
      name: "一覧",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: FRAME_WIDTH, height: 100 * count },
      children: Array.from({ length: count }, (_, index) =>
        node({
          id: `2:${index + 1}`,
          name: "投稿行",
          type: "FRAME",
          absoluteBoundingBox: { x: 0, y: 100 * index, width: FRAME_WIDTH, height: 100 },
          children: [
            node({
              id: `3:${index + 1}`,
              name: "サムネ",
              type: "RECTANGLE",
              absoluteBoundingBox: { x: 16, y: 100 * index + 10, width: 80, height: 80 },
            }),
          ],
        }),
      ),
    });

  it("実装に1行しか無くても、未照合率の分子には入れない", () => {
    const boxes: DomLayoutBox[] = [
      box({ ref: 0, depth: 0, tag: "body", x: 0, y: 0, width: FRAME_WIDTH, height: 800 }),
      box({ ref: 1, parentRef: 0, depth: 1, tag: "div", x: 0, y: 0, width: FRAME_WIDTH, height: 100 }),
      box({ ref: 2, parentRef: 1, depth: 2, tag: "div", x: 16, y: 10, width: 80, height: 80 }),
    ];
    const report = runMeasureDiff({
      figmaRootNode: rows(8),
      domBoxes: boxes,
      screenshotWidth: FRAME_WIDTH,
    });
    expect(report.unmatchedDesignNodes.filter((entry) => entry.category === "unmatched")).toEqual(
      [],
    );
    expect(
      report.unmatchedDesignNodes.filter((entry) => entry.category === "surplus-design").length,
    ).toBe(14);
    expect(report.unmatchedRatio).toBe(0);
  });
});

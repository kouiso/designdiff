import { describe, expect, it } from "vitest";

import {
  BOTTOM_CHANGED_ROW_RATIO,
  MAX_STITCHED_PIXELS,
  detectFixedBands,
  detectOverlap,
  imagesIdentical,
  imagesNearlyIdentical,
  MAX_FIXED_BAND_RATIO,
  stitchScrollFrames,
  type RawImage,
} from "./stitch.js";

const WIDTH = 8;

/** 行ごとの色番号から RGBA 画像を組み立てる。1行は同じ色で塗る。 */
function imageFromRows(rows: number[], width = WIDTH): RawImage {
  const data = new Uint8Array(width * rows.length * 4);
  rows.forEach((value, y) => {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      data[offset] = value & 0xff;
      data[offset + 1] = (value >> 8) & 0xff;
      data[offset + 2] = (value >> 16) & 0xff;
      data[offset + 3] = 0xff;
    }
  });
  return { width, height: rows.length, data };
}

/** 連番の行を作る。scroll した先の画面を組み立てるのに使う。 */
function sequence(start: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => start + index);
}

function rowsOf(image: RawImage): number[] {
  const rows: number[] = [];
  for (let y = 0; y < image.height; y++) {
    const offset = y * image.width * 4;
    rows.push(image.data[offset] | (image.data[offset + 1] << 8) | (image.data[offset + 2] << 16));
  }
  return rows;
}

describe("imagesIdentical", () => {
  it("returns true for byte-identical frames", () => {
    expect(imagesIdentical(imageFromRows([1, 2, 3]), imageFromRows([1, 2, 3]))).toBe(true);
  });

  it("returns false when a single row differs", () => {
    expect(imagesIdentical(imageFromRows([1, 2, 3]), imageFromRows([1, 2, 4]))).toBe(false);
  });

  it("returns false when the dimensions differ", () => {
    expect(imagesIdentical(imageFromRows([1, 2, 3]), imageFromRows([1, 2]))).toBe(false);
  });
});

describe("detectFixedBands", () => {
  it("finds a sticky header and footer that repeat in every frame", () => {
    const header = [900, 901];
    const footer = [800];
    const frames = [
      imageFromRows([...header, ...sequence(0, 7), ...footer]),
      imageFromRows([...header, ...sequence(4, 7), ...footer]),
      imageFromRows([...header, ...sequence(8, 7), ...footer]),
    ];

    const bands = detectFixedBands(frames);

    expect(bands.headerHeight).toBe(2);
    expect(bands.footerHeight).toBe(1);
    expect(bands.notes).toEqual([]);
  });

  it("reports zero bands when nothing is pinned", () => {
    const frames = [imageFromRows(sequence(0, 10)), imageFromRows(sequence(4, 10))];

    const bands = detectFixedBands(frames);

    expect(bands.headerHeight).toBe(0);
    expect(bands.footerHeight).toBe(0);
  });

  it("under-crops and notes ambiguity when the fixed band is implausibly tall", () => {
    // 画面の大半が固定に見える = スクロールしていない/一様な背景。切り取ると本文を失う。
    const shared = sequence(500, 9);
    const frames = [imageFromRows([...shared, 1]), imageFromRows([...shared, 2])];

    const bands = detectFixedBands(frames);

    expect(bands.headerHeight).toBe(0);
    expect(bands.notes.length).toBeGreaterThan(0);
    expect(bands.notes.join("")).toContain("ヘッダー");
  });

  it("keeps the band ratio guard aligned with the exported constant", () => {
    expect(MAX_FIXED_BAND_RATIO).toBeGreaterThan(0);
    expect(MAX_FIXED_BAND_RATIO).toBeLessThan(1);
  });

  it("rejects frames whose dimensions differ", () => {
    expect(() => detectFixedBands([imageFromRows([1, 2]), imageFromRows([1, 2, 3])])).toThrow(
      /dimension/i,
    );
  });

  it("returns no bands for an empty frame list", () => {
    expect(detectFixedBands([])).toEqual({ headerHeight: 0, footerHeight: 0, notes: [] });
  });

  it("under-crops an implausibly tall fixed footer", () => {
    const footer = sequence(700, 9);
    const frames = [imageFromRows([1, ...footer]), imageFromRows([2, ...footer])];

    const bands = detectFixedBands(frames);

    expect(bands.footerHeight).toBe(0);
    expect(bands.notes.join(" ")).toContain("フッター");
  });
});

describe("detectOverlap", () => {
  it("finds the exact overlap between consecutive frames", () => {
    const previous = imageFromRows(sequence(0, 10));
    const next = imageFromRows(sequence(6, 10));

    const result = detectOverlap(previous, next, { headerHeight: 0, footerHeight: 0 });

    expect(result.overlap).toBe(4);
    expect(result.method).toBe("exact");
  });

  it("ignores the fixed bands when measuring the overlap", () => {
    const header = [900, 901];
    const footer = [800];
    const previous = imageFromRows([...header, ...sequence(0, 7), ...footer]);
    const next = imageFromRows([...header, ...sequence(4, 7), ...footer]);

    const result = detectOverlap(previous, next, { headerHeight: 2, footerHeight: 1 });

    expect(result.overlap).toBe(3);
    expect(result.method).toBe("exact");
  });

  it("prefers the candidate closest to the expected overlap when a flat area matches several times", () => {
    // 一様な背景が続くと、行が完全一致する k が複数出る (ここでは 1..4)。
    // 命令したスクロール量が、どれが本物かを決める唯一の手掛かりになる。
    const previous = imageFromRows([5, 0, 0, 0, 0, 0]);
    const next = imageFromRows([0, 0, 0, 0, 7, 8]);

    expect(
      detectOverlap(previous, next, { headerHeight: 0, footerHeight: 0, expectedOverlap: 2 })
        .overlap,
    ).toBe(2);
    expect(
      detectOverlap(previous, next, { headerHeight: 0, footerHeight: 0, expectedOverlap: 4 })
        .overlap,
    ).toBe(4);
  });

  it("accepts an exact seam shallower than half the expected overlap (fling bound is a quarter)", () => {
    // 指令量の 1.3 倍前後の fling は実機で普通に起きる。重なり 9 は
    // expected 20 の半分を切るが正しい縫い目で、/2 の下限だと近似へ落ちる。
    // 近似側と同じ 1/4 の下限なら exact のまま採用できる。
    const previous = imageFromRows(sequence(0, 20));
    const next = imageFromRows(sequence(11, 20));

    const result = detectOverlap(previous, next, {
      headerHeight: 0,
      footerHeight: 0,
      expectedOverlap: 20,
    });

    expect(result.overlap).toBe(9);
    expect(result.method).toBe("exact");
  });

  it("rejects an exact seam below a quarter of the expected overlap", () => {
    // 同じ重なり 9 でも expected 40 (下限 10) では偶然一致として捨てる。
    const previous = imageFromRows(sequence(0, 20));
    const next = imageFromRows(sequence(11, 20));

    const result = detectOverlap(previous, next, {
      headerHeight: 0,
      footerHeight: 0,
      expectedOverlap: 40,
    });

    expect(result.method).toBe("best-effort");
  });

  it("falls back to a best-effort score when no row matches exactly", () => {
    const previous = imageFromRows(sequence(0, 10));
    const next = imageFromRows(sequence(100, 10));

    const result = detectOverlap(previous, next, { headerHeight: 0, footerHeight: 0 });

    expect(result.method).toBe("best-effort");
    expect(result.overlap).toBeGreaterThanOrEqual(0);
  });

  it("フレーム端に被った UI 帯で先頭の指紋窓が埋まっても、共有域の多数決で実送り量を拾う", () => {
    // 実機の scroll 末尾ではブラウザのツールバー等が現れて、次フレームの
    // 先頭が本文と無関係な一様帯になる。先頭の固定窓だけを指紋にすると、
    // この帯が全候補を同じ向きに引っ張って実送り量と無関係な繋ぎ目を選ぶ
    // (device legs で実測)。共有域の全行で採れば、本文の多数派が
    // UI を外れ値として捨てる。実送りは 20 行、真の重なりは 44 行。
    const body = 64;
    const uiRows = Array.from({ length: 8 }, () => 250);
    const previous = imageFromRows(sequence(0, body).map((v) => v * 3));
    const next = imageFromRows([...uiRows, ...sequence(28, body - 8).map((v) => v * 3)]);
    const result = detectOverlap(previous, next, {
      headerHeight: 0,
      footerHeight: 0,
      expectedOverlap: body - 20,
    });
    expect(result.method).toBe("best-effort");
    expect(result.overlap).toBe(44);
  });

  it("近似に落ちても、周期縞で並んだ最小スコアから見込みの重なりに近い候補を採る", () => {
    // 縞のような周期コンテンツでは、実送り 20 行の正解 (重なり 44) と同じ
    // 不一致数が周期 (10 行) ぶんずれた位置にも並ぶ。指令した送り量からの
    // 見込みが無いと最大の重なりを選び、フレームをまるごと落とす。
    // 各行 +3 だけずらして完全一致を潰し、近似経路を強制する。
    const period = 10;
    const phase = (index: number) => (index % period < 5 ? 200 : 20);
    const body = 64;
    const advance = 20;
    const previous = imageFromRows(Array.from({ length: body }, (_, i) => phase(i)));
    const next = imageFromRows(Array.from({ length: body }, (_, i) => phase(i + advance) + 3));
    const result = detectOverlap(previous, next, {
      headerHeight: 0,
      footerHeight: 0,
      expectedOverlap: body - advance,
    });
    expect(result.method).toBe("best-effort");
    expect(result.overlap).toBe(body - advance);
  });

  it("rejects fixed bands that leave no scrollable body", () => {
    const frame = imageFromRows([1, 2]);
    expect(() => detectOverlap(frame, frame, { headerHeight: 1, footerHeight: 1 })).toThrow(
      /leave no scrollable body/,
    );
  });
});

describe("stitchScrollFrames", () => {
  it("returns the single frame untouched", () => {
    const only = imageFromRows(sequence(0, 5));

    const stitched = stitchScrollFrames([only]);

    expect(stitched.image.height).toBe(5);
    expect(rowsOf(stitched.image)).toEqual(sequence(0, 5));
    expect(stitched.overlaps).toEqual([]);
  });

  it("stitches overlapping frames into one tall image without duplicating rows", () => {
    const frames = [
      imageFromRows(sequence(0, 10)),
      imageFromRows(sequence(6, 10)),
      imageFromRows(sequence(12, 10)),
    ];

    const stitched = stitchScrollFrames(frames);

    expect(rowsOf(stitched.image)).toEqual(sequence(0, 22));
    expect(stitched.image.width).toBe(WIDTH);
    expect(stitched.overlaps).toEqual([4, 4]);
  });

  it("includes a sticky header once from the first frame and a sticky footer once from the last", () => {
    const header = [900, 901];
    const footer = [800];
    const frames = [
      imageFromRows([...header, ...sequence(0, 7), ...footer]),
      imageFromRows([...header, ...sequence(4, 7), ...footer]),
      imageFromRows([...header, ...sequence(8, 7), ...footer]),
    ];

    const stitched = stitchScrollFrames(frames);

    expect(rowsOf(stitched.image)).toEqual([...header, ...sequence(0, 15), ...footer]);
    expect(stitched.headerHeight).toBe(2);
    expect(stitched.footerHeight).toBe(1);
  });

  it("rejects an empty frame list rather than emitting an empty image", () => {
    expect(() => stitchScrollFrames([])).toThrow(/at least one/i);
  });
});

describe("stitchScrollFrames 重なりが完全一致せんとき", () => {
  it("近似で繋いだことを注記に残す", () => {
    // 2枚に共通する行が1つも無い。完全一致は取れんので近似へ落ちる。
    const previous = imageFromRows(sequence(1, 10));
    const next = imageFromRows(sequence(101, 10));

    const result = stitchScrollFrames([previous, next]);

    expect(result.notes.join("")).toMatch(/近似/);
    // 共通の行が無いので、近似は「全部が重なり」と読む。落とす行は無いが、
    // 繋ぎ目が信用できんことは注記で分かる形にしてある。
    expect(result.image.height).toBe(previous.height);
  });
});

describe("imagesNearlyIdentical", () => {
  it("数行だけ変わっとる2枚は同じ画面と見なす", () => {
    const rows = sequence(0, 100);
    const changed = [...rows];
    changed[50] = 999;

    expect(imagesNearlyIdentical(imageFromRows(rows), imageFromRows(changed))).toBe(true);
  });

  it("しきい値を超えて変わっとれば別の画面と見なす", () => {
    const rows = sequence(0, 100);
    const changed = rows.map((value, index) => (index < 20 ? 999 : value));

    expect(imagesNearlyIdentical(imageFromRows(rows), imageFromRows(changed))).toBe(false);
  });

  it("寸法が違えば別の画面と見なす", () => {
    expect(imagesNearlyIdentical(imageFromRows([1, 2]), imageFromRows([1, 2, 3]))).toBe(false);
  });

  it("許す割合の指定が範囲外なら落とす", () => {
    const image = imageFromRows([1, 2]);
    expect(() => imagesNearlyIdentical(image, image, -0.1)).toThrow(/between 0 and 1/);
    expect(() => imagesNearlyIdentical(image, image, 1.5)).toThrow(/between 0 and 1/);
  });

  it("既定のしきい値は0より大きく1未満", () => {
    expect(BOTTOM_CHANGED_ROW_RATIO).toBeGreaterThan(0);
    expect(BOTTOM_CHANGED_ROW_RATIO).toBeLessThan(1);
  });
});

describe("stitchScrollFrames の大きさの上限", () => {
  it("繋いだ結果が上限を超えるなら、領域を確保する前に落とす", () => {
    // 幅を大きく取って、少ない枚数で上限を超えさせる。
    const width = Math.ceil(MAX_STITCHED_PIXELS / 30);
    const previous = imageFromRows(sequence(0, 20), width);
    const next = imageFromRows(sequence(10, 20), width);

    expect(() => stitchScrollFrames([previous, next])).toThrow(/ceiling/);
  });
});

// RGB のバイト和が全部 3 で、画素値だけが違う色。行の平均輝度が同じになるので、
// 近似探索のスコアを意図的に同値へ並べられる (#384 の縞ページの再現用)。
const SUM3_ROWS = [0x000003, 0x000300, 0x030000, 0x010101, 0x000201, 0x010200, 0x020001, 0x000102];

// 近似探索の帯は BEST_EFFORT_BAND_ROWS(32) 行なので、本文が 32 行以下だと
// ずらせる候補が1つしか無い。候補の選択を確かめる検体は 32 行より高く作る。
const APPROX_WINDOW = 64;

describe("detectOverlap の近似探索 (#384)", () => {
  it("最小スコアが同じ候補が並ぶとき、見込みの重なりに最も近いものを採る", () => {
    // 全行が同じ平均輝度 → 近似スコアが全オフセットで同値になる。
    // 画素は一致せんので exact は成立せず best-effort へ落ちる。
    // 旧実装は先に見つかった側(=重なり最大)を採り、結合画像が縮んでいた。
    const previous = imageFromRows(
      Array.from({ length: APPROX_WINDOW }, (_, index) => SUM3_ROWS[index % 2]),
    );
    const next = imageFromRows(new Array(APPROX_WINDOW).fill(SUM3_ROWS[2]));

    const result = detectOverlap(previous, next, {
      headerHeight: 0,
      footerHeight: 0,
      expectedOverlap: 40,
    });

    expect(result.method).toBe("best-effort");
    expect(result.overlap).toBe(40);
  });

  it("見込みの 1/4 を下回る偶然の完全一致は採用しない", () => {
    // 末尾1行だけが次の先頭と一致する。見込みの重なりが8と分かっとるのに
    // この1行を採ると、実際よりはるかに浅い重なりで繋いでしまう。
    // 棄却の下限は近似側と同じ fling 由来の 1/4 (=2行)。
    const previous = imageFromRows(sequence(0, 10));
    const next = imageFromRows([9, ...sequence(100, 9)]);

    const result = detectOverlap(previous, next, {
      headerHeight: 0,
      footerHeight: 0,
      expectedOverlap: 8,
    });

    expect(result.method).toBe("best-effort");
    expect(result.overlap).not.toBe(1);
  });
});

describe("stitchScrollFrames の近似結合の回帰試験 (#406)", () => {
  // #384/#405 で直した縮みの回帰検体。実機で観測した条件
  // (8色×800行の縞ページ・窓640・送り384・見込みの重なり256) をそのまま使う。
  // 修正前の近似探索は最小スコアで最初に見つかった側 (= 最大の重なり) を採るので、
  // 結合画像が 5088〜5792 行まで縮み、重なりに 608/640/616 が混ざっていた。
  const PAGE_HEIGHT = 6400;
  const WINDOW = 640;
  const FEED = 384;
  const STRIPE = 800;
  const EXPECTED = WINDOW - FEED; // 256
  const FRAME_COUNT = (PAGE_HEIGHT - WINDOW) / FEED + 1; // 16
  // 縞の8色は RGB のバイト和が近い色に揃えてある。行署名 (バイト平均) では
  // どの縞も同じに見えるので、近似探索には正解と同スコアの候補が大量に並ぶ。
  // 修正前コードが縮めたのはこの平たんさのせい。画素は別色なので
  // 完全一致の筋は残る。
  const STRIPE_COLORS = [
    0xff0000, 0x00ff00, 0x0000ff, 0x660000, 0x006600, 0x000066, 0x330000, 0x003300,
  ];
  const pageRows = Array.from(
    { length: PAGE_HEIGHT },
    (_, index) => STRIPE_COLORS[Math.floor(index / STRIPE)],
  );
  const offsets = Array.from({ length: FRAME_COUNT }, (_, index) => index * FEED);
  const capture = (offset: number) => imageFromRows(pageRows.slice(offset, offset + WINDOW));

  it("トースト帯が被って完全一致が取れん結合でも、見込みの重なりで繋いで高さを保つ", () => {
    // 実機では OS の通知・トーストがフレーム上端に被って、先頭数行が
    // 本文と無関係な別色になる。全ての完全一致候補が先頭行を比較に含むので、
    // ここを潰すとその繋ぎ目は必ず近似へ落ちる。
    const TOAST = 0xffffff;
    const frames = offsets.map((offset, index) =>
      index === 0
        ? capture(offset)
        : imageFromRows([
            ...new Array<number>(8).fill(TOAST),
            ...pageRows.slice(offset + 8, offset + WINDOW),
          ]),
    );

    const stitched = stitchScrollFrames(frames, { expectedOverlap: EXPECTED });

    expect(stitched.overlaps).toEqual(new Array(FRAME_COUNT - 1).fill(EXPECTED));
    expect(stitched.image.height).toBe(PAGE_HEIGHT);
    // トースト帯は捨てる重なりの内側にあるので、繋いだ内容はページどおり。
    expect(rowsOf(stitched.image)).toEqual(pageRows);
  });

  it("摂動が無ければ従来どおり完全一致で繋ぐ", () => {
    const frames = offsets.map(capture);

    const stitched = stitchScrollFrames(frames, { expectedOverlap: EXPECTED });

    expect(stitched.overlaps).toEqual(new Array(FRAME_COUNT - 1).fill(EXPECTED));
    expect(stitched.image.height).toBe(PAGE_HEIGHT);
    expect(rowsOf(stitched.image)).toEqual(pageRows);
    // 近似へ落ちると notes に注記が残るので、無いことで完全一致を確かめる。
    expect(stitched.notes.join("")).not.toContain("近似");
  });
});

describe("stitchScrollFrames の近似結合 (#384)", () => {
  it("完全一致が取れん繋ぎ目でも見込みの重なりで繋いで高さを保つ", () => {
    // 縞ページを一定量ずつ送って撮ったフレーム。1フレームの先頭行が
    // 画素だけ違う(トースト等)せいで完全一致が取れず近似へ落ちる。
    // 近似が見込みを無視して最大の重なりを採ると、結合画像が縮む。
    const STEP = 24;
    const FRAME_COUNT = 4;
    const pageRows = Array.from(
      { length: APPROX_WINDOW + STEP * (FRAME_COUNT - 1) },
      (_, index) => SUM3_ROWS[Math.floor(index / 6) % SUM3_ROWS.length],
    );
    const frames = Array.from({ length: FRAME_COUNT }, (_, index) =>
      imageFromRows(pageRows.slice(index * STEP, index * STEP + APPROX_WINDOW)),
    );
    // 2枚目の先頭行を、平均輝度が同じまま別の色へ差し替える。
    // 全候補の窓がこの行を含むので、exact の候補が0件になる。
    frames[1] = imageFromRows([SUM3_ROWS[3], ...pageRows.slice(STEP + 1, STEP + APPROX_WINDOW)]);

    const stitched = stitchScrollFrames(frames, { expectedOverlap: APPROX_WINDOW - STEP });

    expect(stitched.overlaps).toEqual([40, 40, 40]);
    expect(stitched.image.height).toBe(pageRows.length);
    // 差し替えた行は捨てる重なりの内側にあるので、繋いだ内容はページどおり。
    expect(rowsOf(stitched.image)).toEqual(pageRows);
  });
});

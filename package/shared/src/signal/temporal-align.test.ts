import { describe, expect, it } from "vitest";

import {
  DEFAULT_DRIFT_FAIL_MS,
  MAX_FRAMES,
  aggregateTemporalVerdict,
  alignFrame,
  detectOrderViolation,
  parseFrameTimestamps,
  selectCandidates,
} from "./temporal-align.js";

describe("parseFrameTimestamps", () => {
  it("小さい順に並んだ時刻をそのまま通す", () => {
    expect(parseFrameTimestamps([0, 100, 250])).toEqual([0, 100, 250]);
  });

  it("空の指定を拒む", () => {
    expect(() => parseFrameTimestamps([])).toThrow(/1つ以上/);
  });

  it("上限を超える枚数を拒む", () => {
    const tooMany = Array.from({ length: MAX_FRAMES + 1 }, (_, index) => index * 10);
    expect(() => parseFrameTimestamps(tooMany)).toThrow(/までです/);
  });

  it("同じ時刻の重複を拒む", () => {
    expect(() => parseFrameTimestamps([0, 100, 100])).toThrow(/小さい順/);
  });

  it("逆順を拒む", () => {
    expect(() => parseFrameTimestamps([200, 100])).toThrow(/小さい順/);
  });

  it("負の時刻と小数を拒む", () => {
    expect(() => parseFrameTimestamps([-1])).toThrow(/0以上の整数/);
    expect(() => parseFrameTimestamps([10.5])).toThrow(/0以上の整数/);
  });
});

describe("selectCandidates", () => {
  const frames = [
    { atMs: 0, mismatchRate: 0.4 },
    { atMs: 300, mismatchRate: 0.1 },
    { atMs: 900, mismatchRate: 0.2 },
  ];

  it("範囲の内側だけを残す", () => {
    expect(selectCandidates(300, frames, 400).map((frame) => frame.atMs)).toEqual([0, 300]);
  });

  it("範囲のちょうど境目は内側として扱う", () => {
    expect(selectCandidates(300, frames, 300).map((frame) => frame.atMs)).toEqual([0, 300]);
  });

  it("負の範囲を拒む", () => {
    expect(() => selectCandidates(0, frames, -1)).toThrow(/0以上/);
  });
});

describe("alignFrame", () => {
  it("いちばん違いの少ない1枚を選ぶ", () => {
    const alignment = alignFrame(300, [
      { atMs: 200, mismatchRate: 0.3 },
      { atMs: 400, mismatchRate: 0.05 },
    ]);
    expect(alignment.matchedAtMs).toBe(400);
    expect(alignment.driftMs).toBe(100);
  });

  it("違いが同点なら時刻の近いほうを選ぶ", () => {
    const alignment = alignFrame(300, [
      { atMs: 0, mismatchRate: 0.2 },
      { atMs: 320, mismatchRate: 0.2 },
      { atMs: 600, mismatchRate: 0.2 },
    ]);
    expect(alignment.matchedAtMs).toBe(320);
    expect(alignment.driftMs).toBe(20);
  });

  it("候補が無ければ理由を付けて対応づけない", () => {
    const alignment = alignFrame(300, []);
    expect(alignment.matchedAtMs).toBeNull();
    expect(alignment.driftMs).toBeNull();
    expect(alignment.reason).toMatch(/比べられる/);
  });
});

describe("detectOrderViolation", () => {
  it("順番どおりなら入れ替わりとみなさない", () => {
    expect(
      detectOrderViolation([
        { designAtMs: 0, matchedAtMs: 10, driftMs: 10, mismatchRate: 0 },
        { designAtMs: 100, matchedAtMs: 120, driftMs: 20, mismatchRate: 0 },
      ]),
    ).toBe(false);
  });

  it("時刻が戻る箇所があれば入れ替わりとみなす", () => {
    expect(
      detectOrderViolation([
        { designAtMs: 0, matchedAtMs: 200, driftMs: 200, mismatchRate: 0 },
        { designAtMs: 100, matchedAtMs: 50, driftMs: -50, mismatchRate: 0 },
      ]),
    ).toBe(true);
  });

  it("対応づかん時刻は順番の判断から外す", () => {
    expect(
      detectOrderViolation([
        { designAtMs: 0, matchedAtMs: 10, driftMs: 10, mismatchRate: 0 },
        { designAtMs: 100, matchedAtMs: null, driftMs: null, mismatchRate: null },
        { designAtMs: 200, matchedAtMs: 210, driftMs: 10, mismatchRate: 0 },
      ]),
    ).toBe(false);
  });
});

describe("aggregateTemporalVerdict", () => {
  const aligned = [
    { designAtMs: 0, matchedAtMs: 5, driftMs: 5, mismatchRate: 0 },
    { designAtMs: 100, matchedAtMs: 108, driftMs: 8, mismatchRate: 0 },
  ];

  it("見た目も時刻も合っていれば合格", () => {
    const verdict = aggregateTemporalVerdict(aligned, ["PASS", "PASS"]);
    expect(verdict.status).toBe("PASS");
    expect(verdict.maxAbsDriftMs).toBe(8);
  });

  it("1枚でも見た目が違えば不合格", () => {
    expect(aggregateTemporalVerdict(aligned, ["PASS", "FAIL"]).status).toBe("FAIL");
  });

  it("時刻のズレが許容を超えたら不合格", () => {
    const drifted = [
      {
        designAtMs: 0,
        matchedAtMs: DEFAULT_DRIFT_FAIL_MS + 1,
        driftMs: DEFAULT_DRIFT_FAIL_MS + 1,
        mismatchRate: 0,
      },
    ];
    const verdict = aggregateTemporalVerdict(drifted, ["PASS"]);
    expect(verdict.status).toBe("FAIL");
    expect(verdict.rationale).toMatch(/時刻のズレ/);
  });

  it("許容ちょうどのズレは不合格にしない", () => {
    const borderline = [
      {
        designAtMs: 0,
        matchedAtMs: DEFAULT_DRIFT_FAIL_MS,
        driftMs: DEFAULT_DRIFT_FAIL_MS,
        mismatchRate: 0,
      },
    ];
    expect(aggregateTemporalVerdict(borderline, ["PASS"]).status).toBe("PASS");
  });

  it("順番が入れ替わっとれば、ズレが小さくても不合格", () => {
    const swapped = [
      { designAtMs: 0, matchedAtMs: 60, driftMs: 60, mismatchRate: 0 },
      { designAtMs: 100, matchedAtMs: 40, driftMs: -60, mismatchRate: 0 },
    ];
    const verdict = aggregateTemporalVerdict(swapped, ["PASS", "PASS"]);
    expect(verdict.status).toBe("FAIL");
    expect(verdict.orderViolation).toBe(true);
  });

  it("対応づかん時刻が残るなら合格とは言わず人へ回す", () => {
    const partial = [
      { designAtMs: 0, matchedAtMs: 5, driftMs: 5, mismatchRate: 0 },
      { designAtMs: 100, matchedAtMs: null, driftMs: null, mismatchRate: null },
    ];
    expect(aggregateTemporalVerdict(partial, ["PASS", "PASS"]).status).toBe("UNCERTAIN");
  });

  it("判定できんフレームがあれば人へ回す", () => {
    expect(aggregateTemporalVerdict(aligned, ["PASS", "UNCERTAIN"]).status).toBe("UNCERTAIN");
  });

  it("比べたフレームが無ければ人へ回す", () => {
    const verdict = aggregateTemporalVerdict([], []);
    expect(verdict.status).toBe("UNCERTAIN");
    expect(verdict.maxAbsDriftMs).toBeNull();
  });
});

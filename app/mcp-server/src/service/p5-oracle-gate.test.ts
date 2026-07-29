import { describe, expect, it } from "vitest";

// しきい値ちょうど／超えの境界テストは、この定数から値を導出する。
// リテラル値を直接書くと、oracle-threshold.mjs 側でしきい値を動かした時に
// テストの境界がズレたまま気づかず残る（収束判定とCIの検査が別々の「正解」を
// 黙って持つ、という既知の危険）。
import { LIVE_RESIDUAL_FAIL_THRESHOLD } from "../../../../script/oracle-threshold.mjs";
// 収束の判定は FigDiff の外側にある。ここから FigDiff のコードを読み込むと、
// 外側で測る意味が無くなるので、判定の関数だけを直接呼ぶ。
import { evaluateOracleRun } from "../../../../verification/script/p5-oracle-gate.mjs";

const turn = (residual: number, extra: Record<string, unknown> = {}) => ({
  screenshotPath: `turn-${residual}.png`,
  residual,
  baselineResidual: residual,
  detectedOffset: null,
  widthMismatch: false,
  sizeMismatch: false,
  ...extra,
});

describe("evaluateOracleRun", () => {
  it("最後の回がしきい値以下で、最初より良くなっていれば合格", () => {
    const result = evaluateOracleRun({ turns: [turn(0.08), turn(0.02), turn(0.001)] });

    expect(result.pass).toBe(true);
  });

  it("しきい値ちょうどは合格にすること", () => {
    const result = evaluateOracleRun({
      turns: [turn(0.08), turn(LIVE_RESIDUAL_FAIL_THRESHOLD)],
    });

    expect(result.pass).toBe(true);
  });

  it("しきい値を超えたら不合格にすること", () => {
    const result = evaluateOracleRun({
      turns: [turn(0.08), turn(LIVE_RESIDUAL_FAIL_THRESHOLD + 0.0001)],
    });

    expect(result.pass).toBe(false);
    expect(result.reason).toContain("しきい値");
  });

  it("最初より良くなっていなければ不合格にすること", () => {
    // 偶然しきい値を下回っただけの回を「収束した」と言わせない。
    const result = evaluateOracleRun({ turns: [turn(0.001), turn(0.001)] });

    expect(result.pass).toBe(false);
    expect(result.reason).toContain("良くなっていない");
  });

  it("1回だけの測定でも、しきい値以下なら合格にすること", () => {
    const result = evaluateOracleRun({ turns: [turn(0.001)] });

    expect(result.pass).toBe(true);
  });

  it("測定が1つも無ければ不合格にすること", () => {
    expect(evaluateOracleRun({ turns: [] }).pass).toBe(false);
    expect(evaluateOracleRun({ turns: [] }).reason).toContain("1つも無い");
  });

  it("設計と撮影の幅が違えば不合格にすること", () => {
    // 幅が違うと、そもそも同じ画面を測っていない。
    const result = evaluateOracleRun({
      turns: [turn(0.08), turn(0.001, { widthMismatch: true })],
    });

    expect(result.pass).toBe(false);
    expect(result.reason).toContain("幅が違う");
  });

  it("残差を測れていなければ不合格にすること", () => {
    const result = evaluateOracleRun({
      turns: [turn(0.08), turn(Number.NaN)],
    });

    expect(result.pass).toBe(false);
    expect(result.reason).toContain("測れていない");
  });

  it("しきい値は呼ぶ側から差し替えられること", () => {
    // 校正の実測でしきい値を動かす必要が出たときに、判定の作りを変えずに済ませる。
    const turns = [turn(0.08), turn(0.02)];

    expect(evaluateOracleRun({ turns }).pass).toBe(false);
    expect(evaluateOracleRun({ turns, threshold: 0.03 }).pass).toBe(true);
  });
});

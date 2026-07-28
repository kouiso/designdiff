import { describe, expect, it } from "vitest";

import {
  buildBlendedDiffScript,
  buildDraggableScript,
  buildHideOverlayScript,
  buildInjectScript,
  buildRemoveScript,
  buildShowOverlayScript,
  buildSplitScreenScript,
  buildToggleStartScript,
  buildToggleStopScript,
  buildUpdateOpacityScript,
  buildUpdateScaleScript,
  buildUpdateSplitPositionScript,
} from "./overlay-script.js";

// 組み立てた文字列は、そのまま相手の画面で実行される。値の埋め込み方を間違えると
// 文字列の外へ飛び出して、画面側のコードを壊す形で動く。
const VALID_BASE64 = "aGVsbG8=";

describe("buildInjectScript", () => {
  it("base64 として成立しない文字列は弾くこと", () => {
    expect(() => buildInjectScript("not base64!", 0.5)).toThrow();
    expect(() => buildInjectScript("<script>", 0.5)).toThrow();
  });

  it("受け取った画像と濃さを埋め込むこと", () => {
    const script = buildInjectScript(VALID_BASE64, 0.5);

    expect(script).toContain(VALID_BASE64);
    expect(script).toContain("0.50");
  });

  it("濃さを 0〜1 の範囲へ収めること", () => {
    expect(buildInjectScript(VALID_BASE64, 5)).toContain("1.00");
    expect(buildInjectScript(VALID_BASE64, -3)).toContain("0.00");
  });
});

describe("buildUpdateOpacityScript", () => {
  it("濃さを 0〜1 の範囲へ収めること", () => {
    expect(buildUpdateOpacityScript(2)).toContain("1.00");
    expect(buildUpdateOpacityScript(-1)).toContain("0.00");
    expect(buildUpdateOpacityScript(0.25)).toContain("0.25");
  });
});

describe("buildUpdateScaleScript", () => {
  it("倍率を 0.25〜2 の範囲へ収めること", () => {
    expect(buildUpdateScaleScript(10, "fit_width")).toContain("2.00");
    expect(buildUpdateScaleScript(0.01, "fit_width")).toContain("0.25");
  });

  it("知らない表示の仕方は幅合わせへ倒すこと", () => {
    expect(buildUpdateScaleScript(1, "actual_size")).toContain("actual_size");
    expect(buildUpdateScaleScript(1, "fit_width")).toContain("fit_width");
  });
});

describe("buildSplitScreenScript", () => {
  it("base64 として成立しない文字列は弾くこと", () => {
    expect(() => buildSplitScreenScript("bad!", 50)).toThrow();
  });

  it("区切り位置を 0〜100 の範囲へ収めること", () => {
    expect(buildSplitScreenScript(VALID_BASE64, 500)).toContain("100");
    expect(buildSplitScreenScript(VALID_BASE64, -20)).toContain("0");
  });
});

describe("buildUpdateSplitPositionScript", () => {
  it("区切り位置を 0〜100 の範囲へ収めること", () => {
    expect(buildUpdateSplitPositionScript(999)).toContain("100");
    expect(buildUpdateSplitPositionScript(-5)).toContain("0");
  });
});

describe("buildBlendedDiffScript", () => {
  it("base64 として成立しない文字列は弾くこと", () => {
    expect(() => buildBlendedDiffScript("<img>")).toThrow();
  });

  it("受け取った画像を埋め込むこと", () => {
    expect(buildBlendedDiffScript(VALID_BASE64)).toContain(VALID_BASE64);
  });
});

describe("buildDraggableScript", () => {
  it("base64 として成立しない文字列は弾くこと", () => {
    expect(() => buildDraggableScript("'; alert(1); '", 0.5)).toThrow();
  });

  it("受け取った画像と濃さを埋め込むこと", () => {
    const script = buildDraggableScript(VALID_BASE64, 0.75);

    expect(script).toContain(VALID_BASE64);
    expect(script).toContain("0.75");
  });
});

describe("buildToggleStartScript", () => {
  it("切り替えの間隔を埋め込むこと", () => {
    expect(buildToggleStartScript(250)).toContain("250");
  });
});

describe("値を取らない組み立て", () => {
  it("いずれも実行できる形の文字列を返すこと", () => {
    for (const script of [
      buildRemoveScript(),
      buildHideOverlayScript(),
      buildShowOverlayScript(),
      buildToggleStopScript(),
    ]) {
      expect(script.length).toBeGreaterThan(0);
      expect(script).toContain("__figdiff_overlay_host__");
    }
  });
});

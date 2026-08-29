import { describe, expect, it } from "vitest";

import i18n from "./index";

// 英語は単複が語形に出る。回数をそのまま埋めると "1 runs ago" になって、
// 読んだ人が「1回前」やのうて「複数回前」と受け取る。
describe("convergence.campaignPast", () => {
  it("英語は1回前と複数回前を書き分ける", () => {
    expect(i18n.t("convergence.campaignPast", { lng: "en", count: 1, steps: "3 steps" })).toBe(
      "Previous run (3 steps)",
    );
    expect(i18n.t("convergence.campaignPast", { lng: "en", count: 2, steps: "3 steps" })).toBe(
      "2 runs ago (3 steps)",
    );
  });

  it("日本語は回数をそのまま出す", () => {
    expect(i18n.t("convergence.campaignPast", { lng: "ja", count: 1, steps: "3 反復" })).toBe(
      "1 回前 (3 反復)",
    );
  });
});

describe("convergence.stepCount", () => {
  it("英語は反復1回のときだけ単数にする", () => {
    expect(i18n.t("convergence.stepCount", { lng: "en", count: 1 })).toBe("1 step");
    expect(i18n.t("convergence.stepCount", { lng: "en", count: 2 })).toBe("2 steps");
  });
});

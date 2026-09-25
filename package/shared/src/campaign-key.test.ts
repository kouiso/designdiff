import { describe, expect, it } from "vitest";

import { parseComparisonCampaignKey, scopeComparisonCampaign } from "./campaign-key.js";

describe("comparison campaign keys", () => {
  it("省略時は既存キーを変えず、パス内のタグをキャンペーン扱いしない", () => {
    const sourceKey = 'local:/design/campaign:v1:["a","b"].png';
    expect(scopeComparisonCampaign(sourceKey)).toBe(sourceKey);
    expect(parseComparisonCampaignKey(sourceKey)).toEqual({ sourceKey });
  });

  it("同じキャンペーンでも対象が異なればキーが分かれる", () => {
    expect(scopeComparisonCampaign("figma:file:first", "branch")).not.toBe(
      scopeComparisonCampaign("figma:file:second", "branch"),
    );
  });

  it("区切り文字を含む対象とキャンペーンでも衝突しない", () => {
    const first = scopeComparisonCampaign('local:/design,a","b', "c");
    const second = scopeComparisonCampaign("local:/design,a", 'b","c');
    expect(first).not.toBe(second);
    expect(parseComparisonCampaignKey(first)).toEqual({
      sourceKey: 'local:/design,a","b',
      campaignId: "c",
    });
    expect(parseComparisonCampaignKey(second)).toEqual({
      sourceKey: "local:/design,a",
      campaignId: 'b","c',
    });
  });

  it("空の ID と過大な ID は既定履歴へ混ぜず拒否する", () => {
    expect(() => scopeComparisonCampaign("local:/design", " ")).toThrow();
    expect(() => scopeComparisonCampaign("local:/design", "a".repeat(129))).toThrow();
  });

  it("壊れた保存キーは内容をエラーへ出さず拒否する", () => {
    expect(() => parseComparisonCampaignKey("campaign:v1:private-path")).toThrow(
      "Invalid stored comparison campaign key",
    );
  });
});

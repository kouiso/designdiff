import { describe, expect, it } from "vitest";

import { formatFrameCandidates, rankFrameCandidates } from "./frame-guidance.js";

import type { Frame } from "../type.js";

// 実装の撮影幅。これに一致するフレームが正解候補という前提を表す。
const TARGET_WIDTH = 1082;
const TALL_PAGE_HEIGHT = 3931;

const frame = (overrides: Partial<Frame> & Pick<Frame, "id" | "name">): Frame => ({
  width: 1080,
  height: 2000,
  ...overrides,
});

describe("rankFrameCandidates", () => {
  it("撮影幅に一致するフレームを最上位にする", () => {
    const ranked = rankFrameCandidates(
      [
        frame({ id: "1:1", name: "Wide Board", width: 5000, height: 1200 }),
        frame({ id: "1:2", name: "Home", width: TARGET_WIDTH, height: TALL_PAGE_HEIGHT }),
        frame({ id: "1:3", name: "Misc", width: 1440, height: 2000 }),
      ],
      TARGET_WIDTH,
    );
    expect(ranked[0].id).toBe("1:2");
    expect(ranked[0].matchesWidth).toBe(true);
    expect(ranked[0].reason).toContain(`幅${TARGET_WIDTH}px一致`);
  });

  it("モバイル実機スクショでは幅だけでなく縦横比が近いアプリ画面を優先する", () => {
    const ranked = rankFrameCandidates(
      [
        frame({ id: "1:lp", name: "LP", width: 1082, height: 3931 }),
        frame({ id: "1:app", name: "app-form", width: 390, height: 844 }),
      ],
      1080,
      2340,
    );

    expect(ranked[0].id).toBe("1:app");
    expect(ranked[0].reason).toContain("縦横比が近い");
  });

  it("横長フレームは概観ボードとして降格させる", () => {
    const ranked = rankFrameCandidates([
      frame({ id: "1:1", name: "Overview", width: 6000, height: 1500 }),
      frame({ id: "1:2", name: "Page", width: 1080, height: 2400 }),
    ]);
    expect(ranked[0].id).toBe("1:2");
    const overview = ranked.find((r) => r.id === "1:1");
    expect(overview?.reason).toContain("概観ボードの可能性");
  });

  it("targetWidth 無しでも縦長ページを優先する", () => {
    const ranked = rankFrameCandidates([
      frame({ id: "1:1", name: "Banner", width: 2000, height: 400 }),
      frame({ id: "1:2", name: "Article", width: 1080, height: 5000 }),
    ]);
    expect(ranked[0].id).toBe("1:2");
  });

  it("同点は元の順序を保つ", () => {
    const ranked = rankFrameCandidates([
      frame({ id: "1:1", name: "A", width: 1080, height: 2000 }),
      frame({ id: "1:2", name: "B", width: 1080, height: 2000 }),
    ]);
    expect(ranked.map((r) => r.id)).toEqual(["1:1", "1:2"]);
  });
});

describe("formatFrameCandidates", () => {
  it("先頭候補に ★ を付けて撮影幅をヘッダに含める", () => {
    const text = formatFrameCandidates(
      rankFrameCandidates(
        [frame({ id: "1:2", name: "Home", width: TARGET_WIDTH, height: TALL_PAGE_HEIGHT })],
        TARGET_WIDTH,
      ),
      TARGET_WIDTH,
    );
    expect(text).toContain(`撮影幅 ${TARGET_WIDTH}px`);
    expect(text).toContain(`★ Home (1:2, ${TARGET_WIDTH}x${TALL_PAGE_HEIGHT})`);
  });

  it("フレームが無いときは明示メッセージを返す", () => {
    expect(formatFrameCandidates([])).toBe("利用可能なフレームがありません。");
  });
});

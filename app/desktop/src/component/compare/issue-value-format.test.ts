import { describe, expect, it } from "vitest";

import { formatIssueValue } from "./issue-value-format";

describe("formatIssueValue", () => {
  it("文字列はそのまま返す", () => {
    expect(formatIssueValue("#3B5BDB")).toBe("#3B5BDB");
  });

  it("有限の数値は小数3桁までにして末尾の0を落とす", () => {
    expect(formatIssueValue(700)).toBe("700");
    expect(formatIssueValue(6.8)).toBe("6.8");
    expect(formatIssueValue(1.23456)).toBe("1.235");
    expect(formatIssueValue(2.5)).toBe("2.5");
    expect(formatIssueValue(-0)).toBe("0");
  });

  it("有限でない数値は丸めずに文字列化する", () => {
    expect(formatIssueValue(Number.POSITIVE_INFINITY)).toBe("Infinity");
    expect(formatIssueValue(Number.NaN)).toBe("NaN");
  });

  it("{x,y} は 'x, y' に整える", () => {
    expect(formatIssueValue({ x: 0, y: 8 })).toBe("0, 8");
    expect(formatIssueValue({ x: 1.5, y: 2.12345 })).toBe("1.5, 2.123");
  });

  it("null と undefined は — にする", () => {
    expect(formatIssueValue(null)).toBe("—");
    expect(formatIssueValue(undefined)).toBe("—");
  });

  it("その他のオブジェクトは JSON にする", () => {
    expect(formatIssueValue({ w: 1, h: 2 })).toBe('{"w":1,"h":2}');
    expect(formatIssueValue([1, 2])).toBe("[1,2]");
    expect(formatIssueValue({ x: "a", y: 1 })).toBe('{"x":"a","y":1}');
  });

  it("JSON にできないオブジェクトでも落ちずに文字列を返す", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(formatIssueValue(circular)).toBe("[object Object]");
  });

  it("真偽値は文字列にする", () => {
    expect(formatIssueValue(true)).toBe("true");
  });
});

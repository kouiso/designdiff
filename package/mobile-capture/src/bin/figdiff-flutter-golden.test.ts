import { describe, expect, it } from "vitest";

import { parseArgs } from "./figdiff-flutter-golden.js";

describe("parseArgs", () => {
  it("3つの必須引数を読み取る", () => {
    expect(
      parseArgs([
        "--test",
        "test/golden_test.dart",
        "--project-dir",
        "/tmp/app",
        "--golden",
        "goldens/home.png",
      ]),
    ).toEqual({
      testTarget: "test/golden_test.dart",
      flutterProjectDir: "/tmp/app",
      goldenRelativePath: "goldens/home.png",
    });
  });

  it("順番が違っても読み取れる", () => {
    expect(
      parseArgs([
        "--golden",
        "goldens/home.png",
        "--test",
        "test/golden_test.dart",
        "--project-dir",
        "/tmp/app",
      ]).goldenRelativePath,
    ).toBe("goldens/home.png");
  });

  // 値を書き忘れたときに次のフラグを値として飲み込むと、
  // 意味の通らんパスで実行されて原因の分からん失敗になる。
  it("値の無いフラグは次のフラグを値にしない", () => {
    expect(() => parseArgs(["--test", "--project-dir", "/tmp/app"])).toThrow("Missing value");
  });

  it("末尾で値が切れていても弾く", () => {
    expect(() => parseArgs(["--test"])).toThrow("Missing value");
  });

  it("知らない引数は黙って捨てずに弾く", () => {
    expect(() => parseArgs(["--unknown", "x"])).toThrow("Unknown argument");
  });

  it("必須が欠けていれば使い方を示す", () => {
    expect(() => parseArgs(["--test", "test/golden_test.dart"])).toThrow("Usage:");
  });
});

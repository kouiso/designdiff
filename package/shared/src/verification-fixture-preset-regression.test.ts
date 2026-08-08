import { describe, expect, it, vi } from "vitest";

vi.mock("./confidence/system-bar-ignore-regions.js", () => ({
  getVerifiedSystemBarTopInset: vi.fn(() => 71),
}));

import { resolveFixtureVerifiedSystemUiTopInset } from "./verification-fixture.js";

describe("fixture production preset regression", () => {
  it("production preset resolverが壊れた場合は宣言insetを直注入せず失敗する", () => {
    expect(() =>
      resolveFixtureVerifiedSystemUiTopInset(
        {
          captureDevice: "android",
          viewportWidth: 1080,
          viewportHeight: 2400,
          imageWidth: 1080,
          imageHeight: 4800,
          verifiedSystemUiTopInset: 72,
        },
        { width: 1080, height: 4800 },
      ),
    ).toThrow("is not a production preset");
  });
});

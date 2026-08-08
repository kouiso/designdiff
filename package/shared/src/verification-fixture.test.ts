import { describe, expect, it } from "vitest";

import {
  resolveFixtureVerifiedSystemUiTopInset,
  SystemUiFixtureMetadataSchema,
} from "./verification-fixture.js";

describe("SystemUiFixtureMetadataSchema", () => {
  it("verified insetだけの直注入を拒否する", () => {
    expect(() => SystemUiFixtureMetadataSchema.parse({ verifiedSystemUiTopInset: 72 })).toThrow();
  });

  it("system UI metadataを6項目同時指定した場合だけ受理する", () => {
    expect(
      SystemUiFixtureMetadataSchema.parse({
        captureDevice: "android",
        viewportWidth: 1080,
        viewportHeight: 2400,
        imageWidth: 1080,
        imageHeight: 4800,
        verifiedSystemUiTopInset: 72,
      }),
    ).toEqual({
      captureDevice: "android",
      viewportWidth: 1080,
      viewportHeight: 2400,
      imageWidth: 1080,
      imageHeight: 4800,
      verifiedSystemUiTopInset: 72,
    });
  });
});

describe("resolveFixtureVerifiedSystemUiTopInset", () => {
  const pixel7 = {
    captureDevice: "android" as const,
    viewportWidth: 1080,
    viewportHeight: 2400,
    imageWidth: 1080,
    imageHeight: 4800,
    verifiedSystemUiTopInset: 72,
  };

  it("viewportより高いstitched画像でも本番presetを解決する", () => {
    expect(
      resolveFixtureVerifiedSystemUiTopInset(pixel7, {
        width: 1080,
        height: 4800,
      }),
    ).toBe(72);
  });

  it("preset resolverと一致しない直注入値を拒否する", () => {
    expect(() =>
      resolveFixtureVerifiedSystemUiTopInset(
        { ...pixel7, verifiedSystemUiTopInset: 71 },
        { width: 1080, height: 4800 },
      ),
    ).toThrow("is not a production preset");
  });

  it("実画像寸法と宣言寸法が一致しないfixtureを拒否する", () => {
    expect(() =>
      resolveFixtureVerifiedSystemUiTopInset(pixel7, {
        width: 360,
        height: 4800,
      }),
    ).toThrow("does not match declared image");
  });

  it("宣言画像幅とviewport幅が一致しないfixtureを拒否する", () => {
    expect(() =>
      resolveFixtureVerifiedSystemUiTopInset(
        { ...pixel7, imageWidth: 1440 },
        { width: 1440, height: 4800 },
      ),
    ).toThrow("is incompatible with viewport");
  });
});

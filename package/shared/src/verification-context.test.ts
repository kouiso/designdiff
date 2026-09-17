import { describe, expect, it } from "vitest";

import {
  canonicalizeVerificationContextPayload,
  type VerificationContextPayload,
} from "./verification-context.js";

const context = (): VerificationContextPayload => ({
  version: 1,
  design: {
    sourceIdentitySha256: "1".repeat(64),
    imageSha256: "a".repeat(64),
    background: "#FFFFFF",
    figmaExportConditions: null,
  },
  comparison: {
    effectiveThreshold: 0.1,
    profile: null,
    declaredConditions: {},
    geometry: {
      designNativeWidth: 10,
      designNativeHeight: 10,
      screenshotWidth: 10,
      cropApplied: false,
    },
  },
  mask: {
    status: "applied",
    coordinateContext: {
      canvas_width: 10,
      canvas_height: 10,
      design_original_width: 10,
      design_original_height: 10,
      screenshot_original_width: 10,
      screenshot_original_height: 10,
    },
    effectiveCanvas: { width: 10, height: 10 },
    effectiveRegions: [],
    maskedPixelCount: 100,
    maskSha256: "0".repeat(64),
    appliedIds: [],
    legacyIds: [],
  },
});

describe("verification context", () => {
  it("normalizes mask and id ordering without dropping coordinates", () => {
    const left = context();
    left.mask.effectiveRegions = [
      { x: 5, y: 0, width: 5, height: 10, label: "right" },
      { x: 0, y: 0, width: 5, height: 10, label: "left" },
    ];
    left.mask.appliedIds = ["b", "a"];
    const right = context();
    right.mask.effectiveRegions = [...left.mask.effectiveRegions].reverse();
    right.mask.appliedIds = ["a", "b"];

    expect(canonicalizeVerificationContextPayload(left)).toBe(
      canonicalizeVerificationContextPayload(right),
    );
    right.mask.effectiveRegions[0] = { x: 1, y: 0, width: 5, height: 10, label: "left" };
    expect(canonicalizeVerificationContextPayload(left)).not.toBe(
      canonicalizeVerificationContextPayload(right),
    );
  });
});

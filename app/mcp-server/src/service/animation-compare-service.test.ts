import { expect, it } from "vitest";

import { runAnimationCompare as sharedRunAnimationCompare } from "@figdiff/shared";

import { runAnimationCompare } from "./animation-compare-service.js";

it("keeps the existing MCP service export connected to the shared implementation", () => {
  expect(runAnimationCompare).toBe(sharedRunAnimationCompare);
});

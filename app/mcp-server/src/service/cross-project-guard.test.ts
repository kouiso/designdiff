import { expect, it } from "vitest";

import {
  PRODUCT_SELF_NAMES as sharedProductSelfNames,
  detectForeignProjectNames as sharedDetectForeignProjectNames,
} from "@figdiff/shared/node/public-issue-guard";

import { PRODUCT_SELF_NAMES, detectForeignProjectNames } from "./cross-project-guard.js";

it("preserves the MCP public issue guard exports", () => {
  expect(detectForeignProjectNames).toBe(sharedDetectForeignProjectNames);
  expect(PRODUCT_SELF_NAMES).toBe(sharedProductSelfNames);
});

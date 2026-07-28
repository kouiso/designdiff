import { describe, expect, it } from "vitest";

import {
  assertNoUnknownToolArguments,
  recordRawToolArguments,
  releaseRawToolArguments,
} from "./raw-tool-arguments.js";

const COMPARE_DESIGN_SHAPE_KEYS = [
  "design_source",
  "screenshot",
  "screenshot_url",
  "capture_device",
];

describe("raw tool arguments", () => {
  it("reports screenshot_path before the SDK strips it", () => {
    const requestId = "unknown-screenshot-path";
    recordRawToolArguments({
      jsonrpc: "2.0",
      id: requestId,
      method: "tools/call",
      params: {
        name: "compare_design",
        arguments: {
          design_source: "./design.png",
          screenshot_path: "./implementation.png",
        },
      },
    });

    expect(() =>
      assertNoUnknownToolArguments("compare_design", COMPARE_DESIGN_SHAPE_KEYS, { requestId }),
    ).toThrow(
      "screenshot が指定されていません。screenshot_path という引数は受け取っていません。画像のパスは screenshot に渡してください。",
    );
  });

  it("releases unconsumed arguments when the response is sent", () => {
    const requestId = "released-tool-call";
    recordRawToolArguments({
      jsonrpc: "2.0",
      id: requestId,
      method: "tools/call",
      params: {
        name: "compare_design",
        arguments: { screenshot_path: "./implementation.png" },
      },
    });
    releaseRawToolArguments({
      jsonrpc: "2.0",
      id: requestId,
      result: {},
    });

    expect(() =>
      assertNoUnknownToolArguments("compare_design", COMPARE_DESIGN_SHAPE_KEYS, { requestId }),
    ).not.toThrow();
  });
});

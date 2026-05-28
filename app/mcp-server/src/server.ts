/**
 * FigDiff MCP Server
 * Diff-driven design comparison tools for AI assistants
 *
 * Exposes 11 tools via MCP protocol:
 * - list_projects (Utility): List all FigDiff projects stored in ~/.figdiff/projects/
 * - compare_design (Primary): Pixel diff between Figma design and implementation
 * - inspect_node (Secondary): Dev Mode-like node detail inspection
 * - get_design_tokens (Secondary): Extract design tokens from a Figma frame
 * - list_figma_frames (Utility): List frames in a Figma file
 * - generate_diff_report (Utility): Generate diff report as Markdown
 * - get_crop_region (Utility): Get comparison crop region
 * - set_crop_region (Utility): Set comparison crop region
 * - get_ignore_regions (Utility): Get persisted ignore regions
 * - set_ignore_regions (Utility): Set persisted ignore regions
 * - verify_fix (Utility): Re-compare against a prior result and confirm the claimed fix
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerCompareDesign } from "./tool/compare-design.js";
import { registerGenerateReport } from "./tool/generate-report.js";
import { registerGetCropRegion } from "./tool/get-crop-region.js";
import { registerGetDesignTokens } from "./tool/get-design-tokens.js";
import { registerGetIgnoreRegions } from "./tool/get-ignore-regions.js";
import { registerInspectNode } from "./tool/inspect-node.js";
import { registerListFrames } from "./tool/list-frames.js";
import { registerListProjects } from "./tool/list-projects.js";
import { registerSetCropRegion } from "./tool/set-crop-region.js";
import { registerSetIgnoreRegions } from "./tool/set-ignore-regions.js";
import { registerVerifyFix } from "./tool/verify-fix.js";

export function createMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: "figdiff",
      version: "0.1.0",
    },
    {
      instructions: `FigDiff — Diff-driven design comparison server.

**Available tools:**
- list_projects: List all FigDiff projects stored in ~/.figdiff/projects/
- compare_design: Pixel-level diff between Figma design and implementation screenshot
- inspect_node: Dev Mode-like node detail inspection with CSS suggestions
- get_design_tokens: Extract design tokens (colors, spacing, typography) from Figma frames
- list_figma_frames: List all frames in a Figma file
- generate_diff_report: Generate a Markdown diff report from comparison results
- get_crop_region: Get saved crop region for a project/frame
- set_crop_region: Save crop region for focused comparison
- get_ignore_regions: Get persisted intentional-difference masks for a project/frame
- set_ignore_regions: Save persisted intentional-difference masks
- verify_fix: 前回比較との差分で対象ノードの改善と副作用を検証

**Workflow (follow this order):**
1. list_projects — Start here to find registered projects and their IDs.
2. compare_design — Detects pixel-level differences.
3. inspect_node — Drill into specific diff regions for CSS-level details.
4. Fix code based on css_suggestion values.
5. Re-run compare_design to verify fixes.
6. verify_fix で claimed fix の改善有無と副作用を確認する。
7. Repeat until match_rate reaches 100%.`,
      capabilities: {
        tools: {},
      },
    },
  );

  // Register all tools
  registerListProjects(server);
  registerCompareDesign(server);
  registerInspectNode(server);
  registerGetDesignTokens(server);
  registerListFrames(server);
  registerGenerateReport(server);
  registerGetCropRegion(server);
  registerSetCropRegion(server);
  registerGetIgnoreRegions(server);
  registerSetIgnoreRegions(server);
  registerVerifyFix(server);

  return server;
}

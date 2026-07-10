/**
 * FigDiff MCP Server
 * Diff-driven design comparison tools for AI assistants
 *
 * Exposes 15 tools via MCP protocol:
 * - list_projects (Utility): List all FigDiff projects stored in ~/.figdiff/projects/
 * - create_project (Utility): Create a new FigDiff project
 * - delete_project (Utility): Delete a FigDiff project
 * - compare_design (Primary): Pixel diff between Figma design and implementation
 * - inspect_node (Secondary): Dev Mode-like node detail inspection
 * - get_design_tokens (Secondary): Extract design tokens from a Figma frame
 * - list_figma_frames (Utility): List frames in a Figma file
 * - generate_diff_report (Utility): Generate diff report as Markdown
 * - get_crop_region (Utility): Get comparison crop region
 * - set_crop_region (Utility): Set comparison crop region
 * - get_ignore_regions (Utility): Get persisted ignore regions
 * - set_ignore_regions (Utility): Set persisted ignore regions
 * - delete_ignore_region (Utility): Delete a persisted ignore region
 * - verify_fix (Utility): Re-compare against a prior result and confirm the claimed fix
 * - set_figma_token (Utility): Set a Figma Personal Access Token in the shared credential store
 * - report_issue (Utility): Create a GitHub issue for usability feedback, bugs, or requests
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerCompareDesign } from "./tool/compare-design.js";
import { registerCreateProject } from "./tool/create-project.js";
import { registerDeleteIgnoreRegion } from "./tool/delete-ignore-region.js";
import { registerDeleteProject } from "./tool/delete-project.js";
import { registerGenerateReport } from "./tool/generate-report.js";
import { registerGetCropRegion } from "./tool/get-crop-region.js";
import { registerGetDesignTokens } from "./tool/get-design-tokens.js";
import { registerGetIgnoreRegions } from "./tool/get-ignore-regions.js";
import { registerInspectNode } from "./tool/inspect-node.js";
import { registerListFrames } from "./tool/list-frames.js";
import { registerListProjects } from "./tool/list-projects.js";
import { registerReportIssue } from "./tool/report-issue.js";
import { registerSetCropRegion } from "./tool/set-crop-region.js";
import { registerSetFigmaToken } from "./tool/set-figma-token.js";
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
- create_project: Create a new FigDiff project
- delete_project: Delete a FigDiff project and its saved settings
- compare_design: Pixel-level diff between Figma design and implementation screenshot
- inspect_node: Dev Mode-like node detail inspection with CSS suggestions
- get_design_tokens: Extract design tokens (colors, spacing, typography) from Figma frames
- list_figma_frames: List all frames in a Figma file
- generate_diff_report: Generate a Markdown diff report from comparison results
- get_crop_region: Get saved crop region for a project/frame
- set_crop_region: Save crop region for focused comparison
- get_ignore_regions: Get persisted intentional-difference masks for a project/frame
- set_ignore_regions: Save persisted intentional-difference masks
- delete_ignore_region: Delete a persisted intentional-difference mask by id
- verify_fix: 前回比較との差分で対象ノードの改善と副作用を検証
- set_figma_token: Set a Figma Personal Access Token in the shared credential store
- report_issue: 使いにくい点・バグ・改善要望に気づいたら即座に GitHub issue として起票できます

**Workflow (follow this order):**
1. list_projects — Start here to find registered projects and their IDs.
2. compare_design — Detects pixel-level differences. Output includes "マスク候補" section listing regions likely to be intentional diffs (photos, intentional color changes).
3. inspect_node — Drill into specific diff regions for CSS-level details.
4. Fix code based on css_suggestion values.
5. If issues persist after code fix, check "マスク候補" in compare_design output. For each candidate: confirm it is an intentional diff (photo area, theme color, etc.), then call set_ignore_regions to register it. Do NOT auto-mask without confirmation.
6. Re-run compare_design to verify fixes and masks.
7. verify_fix で claimed fix の改善有無と副作用を確認する。
8. Repeat until match_rate reaches 100% or all remaining issues are confirmed intentional diffs.
9. 使いにくさ・バグを発見したら report_issue で即起票してください。`,
      capabilities: {
        tools: {},
      },
    },
  );

  // Register all tools
  registerListProjects(server);
  registerCreateProject(server);
  registerDeleteProject(server);
  registerCompareDesign(server);
  registerInspectNode(server);
  registerGetDesignTokens(server);
  registerListFrames(server);
  registerGenerateReport(server);
  registerGetCropRegion(server);
  registerSetCropRegion(server);
  registerGetIgnoreRegions(server);
  registerSetIgnoreRegions(server);
  registerDeleteIgnoreRegion(server);
  registerVerifyFix(server);
  registerSetFigmaToken(server);
  registerReportIssue(server);

  return server;
}

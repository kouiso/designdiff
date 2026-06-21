/**
 * delete_project — MCP Tool
 * Delete a registered FigDiff project and its persisted settings.
 */

import { z } from "zod";

import {
  deleteProjectDir,
  PROJECT_ID_PATTERN,
  projectExists,
  readProject,
} from "../service/project-store.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const DESCRIPTION = `登録済み FigDiff プロジェクトを削除します。
project.json が存在する project_id のみ削除できます。crop/ignore regions も含むプロジェクトディレクトリ全体を削除します。`;

export function registerDeleteProject(server: McpServer): void {
  server.registerTool(
    "delete_project",
    {
      description: DESCRIPTION,
      inputSchema: {
        project_id: z.string().regex(PROJECT_ID_PATTERN).describe("削除するプロジェクトID"),
      },
    },
    async (args) => {
      try {
        if (!(await projectExists(args.project_id))) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: Project "${args.project_id}" not found. Use list_projects to see valid project IDs.`,
              },
            ],
            isError: true,
          };
        }

        const project = await readProject(args.project_id);
        await deleteProjectDir(args.project_id);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: true, deleted_project_id: args.project_id, project },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  );
}

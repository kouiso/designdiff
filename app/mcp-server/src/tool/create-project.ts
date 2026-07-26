/**
 * create_project — MCP Tool
 * Create a new FigDiff project in ~/.figdiff/projects/ so it is accessible
 * from compare_design, set_ignore_regions, and set_crop_region via project_id.
 */

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import { ProjectSchema } from "@figdiff/shared";

import { getFigdiffProjectsDir } from "../util/figdiff-paths.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const DESCRIPTION = `【使用タイミング】compare_design / set_ignore_regions を使う前にプロジェクトを登録するとき

FigDiff プロジェクトを新規作成し ~/.figdiff/projects/{id}/project.json に保存します。
作成した project_id を compare_design・set_ignore_regions・set_crop_region に渡すと
保存済みの ignore_regions / crop_region が自動ロードされます。

ワークフロー例:
1. create_project(name='sample-mobile-web', implementation_url='https://...')
2. set_ignore_regions(project_id=返ったid, ...) でマスク保存
3. compare_design(project_id=同id, ...) でマスク自動適用

【完了条件】project_id が返ったら完了。list_projects で確認可能。`;

const PROJECT_ID_PATTERN = /^[\w-]+$/;

const getProjectsDir = async (): Promise<string> => {
  const dir = getFigdiffProjectsDir();
  await mkdir(dir, { recursive: true });
  return dir;
};

export function registerCreateProject(server: McpServer): void {
  server.registerTool(
    "create_project",
    {
      description: DESCRIPTION,
      inputSchema: {
        name: z.string().min(1).describe("プロジェクト名"),
        implementation_url: z.string().url().describe("実装URL (例: https://example.com)"),
        id: z
          .string()
          .regex(
            /^[a-zA-Z0-9_-]+$/,
            "Project ID must contain only alphanumeric characters, hyphens, and underscores",
          )
          .optional()
          .describe("プロジェクトID。省略時は自動生成。既存IDと重複する場合はエラー。"),
      },
    },
    async (args) => {
      try {
        if (args.id !== undefined && !PROJECT_ID_PATTERN.test(args.id)) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: Invalid project id "${args.id}". Use only letters, digits, hyphens, and underscores.`,
              },
            ],
            isError: true,
          };
        }

        const projectsDir = await getProjectsDir();
        const projectId = args.id ?? `${Date.now()}-${randomBytes(4).toString("hex")}`;
        const projectDir = join(projectsDir, projectId);

        if (existsSync(projectDir)) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: Project with id "${projectId}" already exists. Use list_projects to check existing projects.`,
              },
            ],
            isError: true,
          };
        }

        await mkdir(projectDir, { recursive: true });

        const now = new Date().toISOString();
        const project = ProjectSchema.parse({
          id: projectId,
          name: args.name,
          implementationUrl: args.implementation_url,
          pages: [],
          createdAt: now,
          updatedAt: now,
        });

        await writeFile(join(projectDir, "project.json"), JSON.stringify(project, null, 2));

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  project_id: project.id,
                  name: project.name,
                  implementationUrl: project.implementationUrl,
                },
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

/**
 * list_projects — Utility MCP Tool
 * List all FigDiff projects stored in ~/.figdiff/projects/.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ProjectSchema } from "@figdiff/shared";

import { getFigdiffProjectsDir } from "../util/figdiff-paths.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const DESCRIPTION = `【使用タイミング】プロジェクト一覧が必要なとき（最初にセットアップ状況を確認するとき）

FigDiff に登録済みのプロジェクト一覧を返します。
各プロジェクトには実装URL・ページ数・最終更新日時が含まれます。
compare_design の project_id パラメータに使用するIDを確認できます。

【完了条件】このツール単体で完結。戻り値の projects 配列を参照して次のツールに進む。`;

const getProjectsDir = (): string => {
  const dir = getFigdiffProjectsDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
};

export interface ProjectSummary {
  id: string;
  name: string;
  implementationUrl: string;
  pageCount: number;
  updatedAt: string;
}

export const listProjects = (): ProjectSummary[] => {
  const projectsDir = getProjectsDir();
  const entries = readdirSync(projectsDir, { withFileTypes: true });
  const projects: ProjectSummary[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const filePath = join(projectsDir, entry.name, "project.json");
    if (!existsSync(filePath)) continue;

    try {
      const raw = readFileSync(filePath, "utf-8");
      const parsed = ProjectSchema.safeParse(JSON.parse(raw));
      if (parsed.success) {
        projects.push({
          id: parsed.data.id,
          name: parsed.data.name,
          implementationUrl: parsed.data.implementationUrl,
          pageCount: parsed.data.pages.length,
          updatedAt: parsed.data.updatedAt,
        });
      }
    } catch {
      // Corrupted project.json is silently skipped.
    }
  }

  return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};

export function registerListProjects(server: McpServer): void {
  server.registerTool(
    "list_projects",
    {
      description: DESCRIPTION,
      inputSchema: {},
    },
    async () => {
      try {
        const projects = listProjects();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ projectCount: projects.length, projects }, null, 2),
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

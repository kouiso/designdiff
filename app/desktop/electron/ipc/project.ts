import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { app, ipcMain } from "electron";

import { ProjectSchema } from "@figdiff/shared";

const getProjectsDir = (): string => {
  const dir = join(app.getPath("home"), ".figdiff", "projects");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
};

const getProjectDir = (projectId: string): string => {
  return join(getProjectsDir(), projectId);
};

const getProjectFilePath = (projectId: string): string => {
  return join(getProjectDir(projectId), "project.json");
};

export const registerProjectHandlers = (): void => {
  ipcMain.handle("project:list", () => {
    const projectsDir = getProjectsDir();
    const entries = readdirSync(projectsDir, { withFileTypes: true });
    const projects: {
      id: string;
      name: string;
      implementationUrl: string;
      pageCount: number;
      updatedAt: string;
    }[] = [];

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
        // 壊れたproject.jsonはスキップ
      }
    }

    return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  });

  ipcMain.handle("project:load", (_event, projectId: string) => {
    const filePath = getProjectFilePath(projectId);
    if (!existsSync(filePath)) {
      throw new Error(`Project not found: ${projectId}`);
    }
    const raw = readFileSync(filePath, "utf-8");
    const parsed = ProjectSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error(`Invalid project data: ${parsed.error.message}`);
    }
    return parsed.data;
  });

  ipcMain.handle("project:save", (_event, projectJson: string) => {
    const parsed = ProjectSchema.safeParse(JSON.parse(projectJson));
    if (!parsed.success) {
      throw new Error(`Invalid project data: ${parsed.error.message}`);
    }
    const project = parsed.data;
    const projectDir = getProjectDir(project.id);
    if (!existsSync(projectDir)) {
      mkdirSync(projectDir, { recursive: true });
    }
    writeFileSync(getProjectFilePath(project.id), JSON.stringify(project, null, 2), "utf-8");
  });

  ipcMain.handle("project:delete", (_event, projectId: string) => {
    const projectDir = getProjectDir(projectId);
    if (existsSync(projectDir)) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
};

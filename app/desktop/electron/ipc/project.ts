import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { app, ipcMain } from "electron";

import { ProjectSchema } from "@figdiff/shared";

const PROJECT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

const isValidProjectId = (id: string): boolean => {
  return PROJECT_ID_PATTERN.test(id) && !id.includes("..");
};

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

// 同一ディレクトリに一時ファイルを書き込み、rename で置き換えることで
// project.json の途中書き込み破損 (停電 / プロセス kill) を防ぐ。
// POSIX で同一ファイルシステム内の rename はアトミック。
// 失敗時は orphan tmp を rmSync で掃除して、元のエラーを伝搬する。
const writeProjectFileAtomic = (filePath: string, contents: string): void => {
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  try {
    writeFileSync(tmpPath, contents, "utf-8");
    renameSync(tmpPath, filePath);
  } catch (error) {
    try {
      if (existsSync(tmpPath)) {
        rmSync(tmpPath);
      }
    } catch {
      // cleanup error は無視し、元のエラーを伝搬する
    }
    throw error;
  }
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
    if (!isValidProjectId(projectId)) {
      throw new Error(`Invalid project ID: ${projectId}`);
    }
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

  ipcMain.handle("project:save", (_event, projectData: unknown) => {
    const parsed = ProjectSchema.safeParse(projectData);
    if (!parsed.success) {
      throw new Error(`Invalid project data: ${parsed.error.message}`);
    }
    const project = parsed.data;
    if (!isValidProjectId(project.id)) {
      throw new Error(`Invalid project ID: ${project.id}`);
    }
    const projectDir = getProjectDir(project.id);
    if (!existsSync(projectDir)) {
      mkdirSync(projectDir, { recursive: true });
    }
    writeProjectFileAtomic(getProjectFilePath(project.id), JSON.stringify(project, null, 2));
  });

  ipcMain.handle("project:delete", (_event, projectId: string) => {
    if (!isValidProjectId(projectId)) {
      throw new Error(`Invalid project ID: ${projectId}`);
    }
    const projectDir = getProjectDir(projectId);
    if (existsSync(projectDir)) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
};

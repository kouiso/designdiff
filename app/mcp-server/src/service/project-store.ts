/**
 * Project Store helpers
 */

import { constants } from "node:fs";
import { access, mkdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { ProjectSchema } from "@figdiff/shared";

export const PROJECT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function validateProjectId(projectId: string): void {
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    throw new Error("Invalid project ID: must be alphanumeric with hyphens/underscores only");
  }
}

export function getProjectsDirPath(): string {
  return join(homedir(), ".figdiff", "projects");
}

export async function ensureProjectsDir(): Promise<string> {
  const dir = getProjectsDirPath();
  await mkdir(dir, { recursive: true });
  return dir;
}

export function getProjectDir(projectId: string): string {
  validateProjectId(projectId);
  return join(getProjectsDirPath(), projectId);
}

export function getProjectJsonPath(projectId: string): string {
  return join(getProjectDir(projectId), "project.json");
}

export async function projectExists(projectId: string): Promise<boolean> {
  validateProjectId(projectId);
  try {
    await access(getProjectJsonPath(projectId), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function assertProjectExists(projectId: string): Promise<void> {
  if (!(await projectExists(projectId))) {
    throw new Error(`project not found: "${projectId}" — run create_project first`);
  }
}

export async function readProject(projectId: string): Promise<unknown> {
  const raw = await readFile(getProjectJsonPath(projectId), "utf-8");
  return ProjectSchema.parse(JSON.parse(raw));
}

export async function deleteProjectDir(projectId: string): Promise<void> {
  await rm(getProjectDir(projectId), { recursive: true, force: true });
}

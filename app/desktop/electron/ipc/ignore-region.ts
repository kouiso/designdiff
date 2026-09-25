import { existsSync } from "node:fs";
import { access } from "node:fs/promises";
import { join } from "node:path";

import { ipcMain } from "electron";
import { z } from "zod";

import { IgnoreRegionConfigEntrySchema } from "@figdiff/shared";
import { createIgnoreRegionStore } from "@figdiff/shared/node/ignore-region-store";

import { getFigdiffProjectsDir } from "../util/figdiff-home.js";

const ProjectIdSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/);
const RegionIdSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/);

const getProjectDir = (projectId: string): string =>
  join(getFigdiffProjectsDir(), ProjectIdSchema.parse(projectId));

const store = createIgnoreRegionStore({
  getProjectDir,
  async assertProjectExists(projectId) {
    const projectFile = join(getProjectDir(projectId), "project.json");
    if (!existsSync(projectFile)) throw new Error(`Project not found: ${projectId}`);
    await access(projectFile);
  },
});

export const registerIgnoreRegionHandlers = (): void => {
  ipcMain.handle("ignore-region:list", (_event, projectId: unknown, frameName?: unknown) =>
    store.getIgnoreRegionConfig(
      ProjectIdSchema.parse(projectId),
      frameName === undefined ? undefined : z.string().min(1).parse(frameName),
    ),
  );
  ipcMain.handle("ignore-region:save", (_event, projectId: unknown, entry: unknown) =>
    store.setIgnoreRegionConfig(ProjectIdSchema.parse(projectId), [
      IgnoreRegionConfigEntrySchema.parse(entry),
    ]),
  );
  ipcMain.handle("ignore-region:delete", (_event, projectId: unknown, regionId: unknown) =>
    store.deleteIgnoreRegion(ProjectIdSchema.parse(projectId), RegionIdSchema.parse(regionId)),
  );
};

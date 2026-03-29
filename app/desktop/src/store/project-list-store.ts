import { create } from "zustand";

import type { Project, ProjectPage, DesignSource } from "@figdiff/shared";

import { getPlatform } from "@/lib/platform";

interface ProjectSummary {
  id: string;
  name: string;
  implementationUrl: string;
  pageCount: number;
  updatedAt: string;
}

interface ProjectListState {
  projects: ProjectSummary[];
  isLoading: boolean;
  error: string | null;

  currentProject: Project | null;
  selectedPageId: string | null;
  selectedSourceId: string | null;

  loadProjects: () => Promise<void>;
  createProject: (name: string, implementationUrl: string) => Promise<Project>;
  openProject: (projectId: string) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  saveCurrentProject: () => Promise<void>;

  addPage: (name: string, path: string) => void;
  removePage: (pageId: string) => void;
  selectPage: (pageId: string) => void;

  addDesignSource: (pageId: string, source: DesignSource) => void;
  removeDesignSource: (pageId: string, sourceId: string) => void;
  selectSource: (sourceId: string) => void;

  clearError: () => void;
  resetCurrent: () => void;
}

export const generateId = (): string => {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
};

export const useProjectListStore = create<ProjectListState>((set, get) => ({
  projects: [],
  isLoading: false,
  error: null,
  currentProject: null,
  selectedPageId: null,
  selectedSourceId: null,

  loadProjects: async () => {
    set({ isLoading: true, error: null });
    try {
      const platform = await getPlatform();
      const projects = await platform.project.list();
      set({ projects, isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  createProject: async (name, implementationUrl) => {
    const now = new Date().toISOString();
    const project: Project = {
      id: generateId(),
      name,
      implementationUrl,
      pages: [],
      createdAt: now,
      updatedAt: now,
    };
    try {
      const platform = await getPlatform();
      await platform.project.save(project);
      set({ currentProject: project });
      await get().loadProjects();
      return project;
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  openProject: async (projectId) => {
    set({ isLoading: true, error: null });
    try {
      const platform = await getPlatform();
      const project = await platform.project.load(projectId);
      const firstPage = project.pages[0];
      set({
        currentProject: project,
        selectedPageId: firstPage?.id ?? null,
        selectedSourceId: null,
        isLoading: false,
      });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  deleteProject: async (projectId) => {
    try {
      const platform = await getPlatform();
      await platform.project.delete(projectId);
      const { currentProject } = get();
      if (currentProject?.id === projectId) {
        set({ currentProject: null, selectedPageId: null, selectedSourceId: null });
      }
      await get().loadProjects();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  saveCurrentProject: async () => {
    const { currentProject } = get();
    if (!currentProject) return;
    try {
      const updated = { ...currentProject, updatedAt: new Date().toISOString() };
      const platform = await getPlatform();
      await platform.project.save(updated);
      set({ currentProject: updated });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  addPage: (name, path) => {
    const { currentProject } = get();
    if (!currentProject) return;
    const newPage: ProjectPage = {
      id: generateId(),
      name,
      path,
      designSources: [],
    };
    const updated = {
      ...currentProject,
      pages: [...currentProject.pages, newPage],
      updatedAt: new Date().toISOString(),
    };
    set({ currentProject: updated, selectedPageId: newPage.id });
  },

  removePage: (pageId) => {
    const { currentProject, selectedPageId } = get();
    if (!currentProject) return;
    const updated = {
      ...currentProject,
      pages: currentProject.pages.filter((p) => p.id !== pageId),
      updatedAt: new Date().toISOString(),
    };
    set({
      currentProject: updated,
      selectedPageId: selectedPageId === pageId ? (updated.pages[0]?.id ?? null) : selectedPageId,
    });
  },

  selectPage: (pageId) => {
    set({ selectedPageId: pageId, selectedSourceId: null });
  },

  addDesignSource: (pageId, source) => {
    const { currentProject } = get();
    if (!currentProject) return;
    const updated = {
      ...currentProject,
      pages: currentProject.pages.map((p) =>
        p.id === pageId ? { ...p, designSources: [...p.designSources, source] } : p,
      ),
      updatedAt: new Date().toISOString(),
    };
    set({ currentProject: updated });
  },

  removeDesignSource: (pageId, sourceId) => {
    const { currentProject } = get();
    if (!currentProject) return;
    const updated = {
      ...currentProject,
      pages: currentProject.pages.map((p) =>
        p.id === pageId
          ? { ...p, designSources: p.designSources.filter((s) => s.id !== sourceId) }
          : p,
      ),
      updatedAt: new Date().toISOString(),
    };
    set({ currentProject: updated });
  },

  selectSource: (sourceId) => {
    set({ selectedSourceId: sourceId });
  },

  clearError: () => set({ error: null }),

  resetCurrent: () => set({ currentProject: null, selectedPageId: null, selectedSourceId: null }),
}));

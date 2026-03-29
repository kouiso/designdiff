import { useState } from "react";

import {
  FolderOpen,
  GitCompare,
  Globe,
  ImageIcon,
  Layers,
  Plus,
  Rocket,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { parseDesignInput } from "@figdiff/shared";

import { Badge } from "@/component/ui/badge";
import { Button } from "@/component/ui/button";
import { Card, CardContent } from "@/component/ui/card";
import { Input } from "@/component/ui/input";
import { Spinner } from "@/component/ui/spinner";
import { cn } from "@/lib/util";
import { useOverlayStore } from "@/store/overlay-store";
import { useProjectListStore } from "@/store/project-list-store";
import { useProjectStore } from "@/store/project-store";
import { useSettingStore } from "@/store/setting-store";
import { useTabStore } from "@/store/tab-store";

import { DesignInput } from "./design-input";

import type { Page } from "../../App";

const STEPS = [
  { icon: Globe, key: "step1" as const, color: "bg-primary/15 text-primary" },
  { icon: ImageIcon, key: "step2" as const, color: "bg-accent text-accent-foreground" },
  { icon: GitCompare, key: "step3" as const, color: "bg-success/15 text-success" },
] as const;

interface HomePageProps {
  onNavigate: (page: Page) => void;
}

export const HomePage = ({ onNavigate }: HomePageProps) => {
  const { t } = useTranslation();
  const projectLoading = useProjectStore((s) => s.isLoading);
  const loadError = useProjectStore((s) => s.error);
  const clearError = useProjectStore((s) => s.clearError);
  const figmaToken = useSettingStore((s) => s.figmaToken);
  const projects = useProjectListStore((s) => s.projects);
  const listLoading = useProjectListStore((s) => s.isLoading);
  const listError = useProjectListStore((s) => s.error);
  const createProject = useProjectListStore((s) => s.createProject);
  const openProject = useProjectListStore((s) => s.openProject);
  const deleteProject = useProjectListStore((s) => s.deleteProject);
  const [implUrl, setImplUrl] = useState("");

  // 新規プロジェクト作成
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");

  const handleCreateProject = async () => {
    if (!newName.trim() || !newUrl.trim()) return;
    try {
      const project = await createProject(newName.trim(), newUrl.trim());
      const tabId = useTabStore.getState().openTab(project.id, project.name);
      await openProject(project.id);
      if (tabId) {
        useTabStore.getState().setActiveTab(tabId);
      }
      setNewName("");
      setNewUrl("");
      setShowCreate(false);
    } catch {
      // error は store 経由で表示
    }
  };

  const handleOpenProject = async (projectId: string, projectName: string) => {
    const tabId = useTabStore.getState().openTab(projectId, projectName);
    await openProject(projectId);
    if (tabId) {
      useTabStore.getState().setActiveTab(tabId);
    }
  };

  // 既存フロー（Figma URL直接入力）も維持
  const handleLegacySubmit = async (input: string) => {
    if (projectLoading) return;
    const isFigmaUrl = (() => {
      try {
        return parseDesignInput(input).type === "figma_url";
      } catch {
        return false;
      }
    })();
    if (isFigmaUrl && !figmaToken) {
      useProjectStore.setState({ error: t("home.tokenRequired") });
      return;
    }
    clearError();
    await useProjectStore.getState().loadDesign(input);

    const { error: loadErr } = useProjectStore.getState();
    if (loadErr) return;

    const trimmedImplUrl = implUrl.trim();
    if (trimmedImplUrl) {
      const { frames } = useProjectStore.getState();
      if (frames.length > 0 && frames[0]) {
        await useProjectStore.getState().selectFrame(frames[0]);
      }
      useOverlayStore.getState().setUrl(trimmedImplUrl);
      onNavigate("live_overlay");
      return;
    }

    const { frames, frameImage } = useProjectStore.getState();
    if (frames.length > 0 || frameImage) {
      onNavigate("project");
    }
  };

  const isLoading = projectLoading || listLoading;
  const error = loadError || listError;

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col gap-6 overflow-y-auto">
      {/* プロジェクト一覧 */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text font-bold text-2xl text-transparent tracking-tight">
            FigDiff
          </h1>
          <Button onClick={() => setShowCreate(!showCreate)} size="sm">
            <Plus className="mr-1 h-4 w-4" />
            {t("home.newProject", "New Project")}
          </Button>
        </div>

        {showCreate && (
          <Card className="border-primary/30">
            <CardContent className="space-y-3 p-4">
              <h3 className="font-semibold text-sm">
                {t("home.createProject", "Create New Project")}
              </h3>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("home.projectName", "Project name (e.g. Corporate Site)")}
                className="h-9"
              />
              <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-1.5">
                <Globe className="ml-1 h-4 w-4 shrink-0 text-muted-foreground" />
                <Input
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  placeholder={t(
                    "home.implementationUrl",
                    "Implementation URL (e.g. http://localhost:3000)",
                  )}
                  className="border-0 bg-transparent shadow-none focus-visible:ring-0"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateProject();
                  }}
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={handleCreateProject} disabled={!newName.trim() || !newUrl.trim()}>
                  <Rocket className="mr-1 h-4 w-4" />
                  {t("common.create", "Create")}
                </Button>
                <Button variant="ghost" onClick={() => setShowCreate(false)}>
                  {t("common.cancel", "Cancel")}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {projects.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <Card
                key={p.id}
                className="group cursor-pointer transition-colors hover:border-primary/50"
                onClick={() => handleOpenProject(p.id, p.name)}
              >
                <CardContent className="flex items-start justify-between p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
                      <h3 className="truncate font-semibold text-sm">{p.name}</h3>
                    </div>
                    <p className="mt-1 truncate text-muted-foreground text-xs">
                      {p.implementationUrl}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <Badge variant="secondary" className="text-[10px]">
                        <Layers className="mr-0.5 h-2.5 w-2.5" />
                        {t("home.pageCount", "{{count}} pages", { count: p.pageCount })}
                      </Badge>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteProject(p.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          !showCreate && (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center gap-2 py-8">
                <FolderOpen className="h-10 w-10 text-muted-foreground/30" />
                <p className="text-muted-foreground text-sm">
                  {t("home.noProjects", "No projects yet. Create one to get started.")}
                </p>
              </CardContent>
            </Card>
          )
        )}
      </section>

      {/* 既存フロー（直接比較）も維持 */}
      <section className="space-y-3 border-border/40 border-t pt-4">
        <div>
          <h2 className="font-semibold text-sm text-muted-foreground">
            {t("home.quickCompare", "Quick Compare (Legacy)")}
          </h2>
          <p className="text-muted-foreground text-xs">{t("home.inputHint")}</p>
        </div>
        <DesignInput onSubmit={handleLegacySubmit} disabled={isLoading} />

        <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-1.5 shadow-sm transition-colors focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20">
          <Globe className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            type="text"
            value={implUrl}
            onChange={(e) => setImplUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.preventDefault();
            }}
            placeholder={t("home.implUrlPlaceholder")}
            aria-label={t("home.implUrlPlaceholder")}
            disabled={isLoading}
            className="border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
          {implUrl.trim() && (
            <Badge variant="outline" className="mr-2 shrink-0">
              <Rocket className="mr-1 h-3 w-3" />
              {t("home.badgeLiveOverlay")}
            </Badge>
          )}
        </div>
      </section>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">
          {error}
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center gap-2">
          <Spinner size="sm" label={t("common.loading")} />
          <span className="text-muted-foreground">{t("common.loading")}</span>
        </div>
      )}

      {/* ワークフロー説明 */}
      <section className="space-y-3">
        <h2 className="text-center font-medium text-muted-foreground text-xs uppercase tracking-widest">
          {t("home.howItWorks")}
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <Card key={step.key} className="border-border/60 bg-card/80">
              <CardContent className="flex flex-col items-center gap-3 p-5 text-center">
                <div
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-xl",
                    step.color,
                  )}
                >
                  <step.icon className="h-5 w-5" />
                </div>
                <span className="font-bold text-muted-foreground text-xs">
                  {t("home.stepLabel", { n: i + 1 })}
                </span>
                <p className="whitespace-pre-line font-medium text-sm leading-relaxed">
                  {t(`home.${step.key}`)}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <p className="text-center text-muted-foreground/50 text-xs">v{__APP_VERSION__}</p>
    </div>
  );
};

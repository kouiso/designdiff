import { useState } from "react";

import { ExternalLink, FileImage, FolderPlus, Globe, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { parseDesignInput } from "@figdiff/shared";
import type { DesignSource } from "@figdiff/shared";

import type { Page } from "@/App";
import { Badge } from "@/component/ui/badge";
import { Button } from "@/component/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/component/ui/card";
import { Input } from "@/component/ui/input";
import { cn } from "@/lib/util";
import { useCompareStore } from "@/store/compare-store";
import { generateId, useProjectListStore } from "@/store/project-list-store";
import { useProjectStore } from "@/store/project-store";

interface ProjectViewProps {
  onNavigate: (page: Page) => void;
}

export const ProjectView = ({ onNavigate }: ProjectViewProps) => {
  const { t } = useTranslation();
  const currentProject = useProjectListStore((s) => s.currentProject);
  const selectedPageId = useProjectListStore((s) => s.selectedPageId);
  const selectPage = useProjectListStore((s) => s.selectPage);
  const addPage = useProjectListStore((s) => s.addPage);
  const removePage = useProjectListStore((s) => s.removePage);
  const addDesignSource = useProjectListStore((s) => s.addDesignSource);
  const removeDesignSource = useProjectListStore((s) => s.removeDesignSource);
  const saveCurrentProject = useProjectListStore((s) => s.saveCurrentProject);

  const [newPageName, setNewPageName] = useState("");
  const [newPagePath, setNewPagePath] = useState("");
  const [showAddPage, setShowAddPage] = useState(false);
  const [newSourceLabel, setNewSourceLabel] = useState("");
  const [newSourceUrl, setNewSourceUrl] = useState("");
  const [showAddSource, setShowAddSource] = useState(false);

  if (!currentProject) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        {t("projectView.noProject", "No project loaded")}
      </div>
    );
  }

  const selectedPage = currentProject.pages.find((p) => p.id === selectedPageId);

  const handleAddPage = () => {
    if (!newPageName.trim()) return;
    const rawPath = newPagePath.trim() || newPageName.trim().toLowerCase().replace(/\s+/g, "-");
    const path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
    addPage(newPageName.trim(), path);
    setNewPageName("");
    setNewPagePath("");
    setShowAddPage(false);
    saveCurrentProject();
  };

  const handleAddSource = () => {
    if (!selectedPageId || !newSourceUrl.trim()) return;
    const url = newSourceUrl.trim();
    const label = newSourceLabel.trim() || url;

    let source: DesignSource;
    try {
      const parsed = parseDesignInput(url);
      if (parsed.type === "figma_url") {
        source = {
          type: "figma",
          id: generateId(),
          label,
          figmaUrl: url,
          fileKey: parsed.fileKey,
          nodeId: parsed.nodeId,
        };
      } else {
        source = {
          type: "local_image",
          id: generateId(),
          label,
          filePath: url,
        };
      }
    } catch {
      source = {
        type: "local_image",
        id: generateId(),
        label,
        filePath: url,
      };
    }

    addDesignSource(selectedPageId, source);
    setNewSourceLabel("");
    setNewSourceUrl("");
    setShowAddSource(false);
    saveCurrentProject();
  };

  const handleCompare = async (source: DesignSource) => {
    const inputUrl = source.type === "figma" ? source.figmaUrl : source.filePath;
    await useProjectStore.getState().loadDesign(inputUrl);
    const { frameImage } = useProjectStore.getState();
    if (frameImage) {
      useCompareStore.getState().setDesignImage(frameImage);
      onNavigate("compare");
    } else if (source.type === "figma") {
      onNavigate("project");
    }
  };

  return (
    <div className="flex h-full">
      {/* サイドバー: ページ一覧 */}
      <aside className="flex w-56 shrink-0 flex-col border-border/60 border-r bg-muted/20">
        <div className="flex items-center justify-between border-border/60 border-b p-3">
          <div className="min-w-0">
            <h2 className="truncate font-semibold text-sm">{currentProject.name}</h2>
            <p className="truncate text-muted-foreground text-xs">
              {currentProject.implementationUrl}
            </p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
              {t("projectView.pages", "Pages")}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={() => setShowAddPage(!showAddPage)}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>

          {showAddPage && (
            <div className="mb-2 space-y-1.5 rounded-md border bg-background p-2">
              <Input
                value={newPageName}
                onChange={(e) => setNewPageName(e.target.value)}
                placeholder={t("projectView.pageName", "Page name")}
                className="h-7 text-xs"
              />
              <Input
                value={newPagePath}
                onChange={(e) => setNewPagePath(e.target.value)}
                placeholder={t("projectView.pagePath", "/path")}
                className="h-7 text-xs"
              />
              <div className="flex gap-1">
                <Button size="sm" className="h-6 flex-1 text-xs" onClick={handleAddPage}>
                  <FolderPlus className="mr-1 h-3 w-3" />
                  {t("common.add", "Add")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs"
                  onClick={() => setShowAddPage(false)}
                >
                  {t("common.cancel", "Cancel")}
                </Button>
              </div>
            </div>
          )}

          {currentProject.pages.map((page) => (
            <button
              key={page.id}
              type="button"
              className={cn(
                "mb-0.5 flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                page.id === selectedPageId
                  ? "bg-primary/10 font-medium text-primary"
                  : "text-foreground hover:bg-muted",
              )}
              onClick={() => selectPage(page.id)}
            >
              <span className="truncate">{page.path}</span>
              <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                {page.designSources.length}
              </Badge>
            </button>
          ))}

          {currentProject.pages.length === 0 && !showAddPage && (
            <p className="py-4 text-center text-muted-foreground text-xs">
              {t("projectView.noPages", "No pages yet. Click + to add.")}
            </p>
          )}
        </div>
      </aside>

      {/* メインエリア: デザインソース管理 */}
      <div className="flex-1 overflow-y-auto p-4">
        {selectedPage ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-lg">{selectedPage.name}</h3>
                <p className="flex items-center gap-1 text-muted-foreground text-sm">
                  <Globe className="h-3.5 w-3.5" />
                  {currentProject.implementationUrl}
                  {selectedPage.path}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAddSource(!showAddSource)}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  {t("projectView.addSource", "Add Design Source")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => {
                    removePage(selectedPage.id);
                    saveCurrentProject();
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {showAddSource && (
              <Card>
                <CardContent className="space-y-2 p-4">
                  <Input
                    value={newSourceLabel}
                    onChange={(e) => setNewSourceLabel(e.target.value)}
                    placeholder={t("projectView.sourceLabel", "Label (e.g. PC Design, SP Design)")}
                    className="h-8 text-sm"
                  />
                  <Input
                    value={newSourceUrl}
                    onChange={(e) => setNewSourceUrl(e.target.value)}
                    placeholder={t("projectView.sourceUrl", "Figma URL or local image path")}
                    className="h-8 text-sm"
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleAddSource}>
                      {t("common.add", "Add")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setShowAddSource(false)}>
                      {t("common.cancel", "Cancel")}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {selectedPage.designSources.length === 0 && !showAddSource && (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center gap-2 py-8">
                  <FileImage className="h-8 w-8 text-muted-foreground/50" />
                  <p className="text-muted-foreground text-sm">
                    {t("projectView.noSources", "No design sources yet")}
                  </p>
                  <Button variant="outline" size="sm" onClick={() => setShowAddSource(true)}>
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    {t("projectView.addSource", "Add Design Source")}
                  </Button>
                </CardContent>
              </Card>
            )}

            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {selectedPage.designSources.map((source) => (
                <Card key={source.id} className="group">
                  <CardHeader className="p-3 pb-1">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm">{source.label}</CardTitle>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-destructive"
                          onClick={() => {
                            removeDesignSource(selectedPage.id, source.id);
                            saveCurrentProject();
                          }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2 p-3 pt-0">
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className="text-[10px]">
                        {source.type === "figma" ? "Figma" : "Local"}
                      </Badge>
                      <span className="min-w-0 truncate text-muted-foreground text-xs">
                        {source.type === "figma" ? source.figmaUrl : source.filePath}
                      </span>
                    </div>
                    <Button size="sm" className="w-full" onClick={() => handleCompare(source)}>
                      <ExternalLink className="mr-1 h-3.5 w-3.5" />
                      {t("projectView.compare", "Compare")}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <FolderPlus className="h-12 w-12 text-muted-foreground/30" />
            <p className="text-muted-foreground">
              {t("projectView.selectPage", "Select a page from the sidebar or add a new one")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

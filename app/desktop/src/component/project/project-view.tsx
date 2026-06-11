import { useState } from "react";
import type { DragEvent } from "react";

import {
  ArrowRight,
  ExternalLink,
  FileImage,
  FolderPlus,
  Globe,
  ImagePlus,
  Plus,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { parseDesignInput } from "@figdiff/shared";
import type { DesignSource, ProjectPage } from "@figdiff/shared";

import type { Page } from "@/App";
import { Input } from "@/component/ui/input";
import { ScoreRing } from "@/component/ui/score-ring";
import { StatusPill } from "@/component/ui/status-pill";
import type { StatusType } from "@/component/ui/status-pill";
import { useCompareStore } from "@/store/compare-store";
import { generateId, useProjectListStore } from "@/store/project-list-store";
import { useProjectStore } from "@/store/project-store";
import { useSettingStore } from "@/store/setting-store";

interface ProjectViewProps {
  onNavigate: (page: Page) => void;
}

const pageScore = (_page: ProjectPage): number => 0;

const pageStatus = (page: ProjectPage): StatusType => {
  return page.designSources.length > 0 ? "checking" : "idle";
};

const sourceLabel = (source: DesignSource): string => {
  return source.type === "figma" ? source.figmaUrl : source.filePath;
};

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
  const projectLoading = useProjectStore((s) => s.isLoading);
  const projectError = useProjectStore((s) => s.error);
  const figmaToken = useSettingStore((s) => s.figmaToken);
  const oauthState = useSettingStore((s) => s.oauthState);
  const screenshotImage = useCompareStore((s) => s.screenshotImage);
  const setScreenshotImage = useCompareStore((s) => s.setScreenshotImage);

  const [newPageName, setNewPageName] = useState("");
  const [newPagePath, setNewPagePath] = useState("");
  const [showAddPage, setShowAddPage] = useState(false);
  const [newSourceLabel, setNewSourceLabel] = useState("");
  const [newSourceUrl, setNewSourceUrl] = useState("");
  const [showAddSource, setShowAddSource] = useState(false);
  const [isDraggingSourceImage, setIsDraggingSourceImage] = useState(false);
  const [isDraggingScreenshot, setIsDraggingScreenshot] = useState(false);

  if (!currentProject) {
    return (
      <div className="flex h-full items-center justify-center" style={{ color: "var(--muted-fg)" }}>
        {t("projectView.noProject", "No project loaded")}
      </div>
    );
  }

  const selectedPage = currentProject.pages.find((p) => p.id === selectedPageId);
  const selectedScore = selectedPage ? pageScore(selectedPage) : 0;
  const selectedStatus = selectedPage ? pageStatus(selectedPage) : "idle";
  const primarySource = selectedPage?.designSources[0] ?? null;
  const isFigmaConnected = oauthState.mode === "oauth" || oauthState.mode === "pat" || !!figmaToken;

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

  const isImageFile = (file: File): boolean => {
    if (file.type.startsWith("image/")) return true;
    return /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(file.name);
  };

  const handleSourceDragOver = (event: DragEvent<HTMLDivElement>) => {
    const hasFile = Array.from(event.dataTransfer.items).some((item) => item.kind === "file");
    if (!hasFile) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDraggingSourceImage(true);
  };

  const handleSourceDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDraggingSourceImage(false);

    const file = Array.from(event.dataTransfer.files).find(isImageFile);
    if (!file) return;

    const path = window.electronAPI?.getPathForFile(file);
    if (!path) return;

    setNewSourceUrl(path);
    setNewSourceLabel((current) => current || file.name.replace(/\.[^.]+$/, ""));
  };

  const handleScreenshotDragOver = (event: DragEvent<HTMLDivElement>) => {
    const hasFile = Array.from(event.dataTransfer.items).some((item) => item.kind === "file");
    if (!hasFile) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDraggingScreenshot(true);
  };

  const handleScreenshotDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDraggingScreenshot(false);

    const file = Array.from(event.dataTransfer.files).find(isImageFile);
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setScreenshotImage(reader.result);
      }
    };
    reader.onerror = () => {
      useCompareStore.getState().setError(t("compare.loadFailed"));
    };
    reader.readAsDataURL(file);
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
    <div className="flex h-full" style={{ background: "var(--bg)", color: "var(--fg)" }}>
      <aside
        className="scroll flex h-full shrink-0 flex-col overflow-y-auto"
        style={{
          width: 272,
          borderRight: "1px solid var(--border)",
          background: "var(--surface)",
        }}
      >
        <div style={{ borderBottom: "1px solid var(--border)", padding: 18 }}>
          <div
            className="fd-chip mb-3"
            style={{ background: "var(--cobalt-soft)", color: "var(--cobalt)" }}
          >
            {isFigmaConnected ? "Figma" : t("home.tokenRequired")}
          </div>
          <h2 className="truncate" style={{ fontSize: 17, fontWeight: 760 }}>
            {currentProject.name}
          </h2>
          <p className="truncate" style={{ color: "var(--muted-fg)", fontSize: 12 }}>
            {currentProject.implementationUrl}
          </p>
        </div>

        <div className="flex items-center justify-between" style={{ padding: "14px 12px 8px" }}>
          <span style={{ color: "var(--muted-fg)", fontSize: 12, fontWeight: 700 }}>
            {t("projectView.pages", "Pages")}
          </span>
          <button
            type="button"
            className="fd-icon-btn"
            onClick={() => setShowAddPage(!showAddPage)}
            style={{ height: 0, width: 0, overflow: "hidden", padding: 0, border: 0 }}
            tabIndex={-1}
          >
            <Plus size={1} />
          </button>
          <button
            type="button"
            className="fd-icon-btn"
            onClick={() => setShowAddPage(!showAddPage)}
            aria-label={t("projectView.addPage", "Add page")}
          >
            <Plus size={15} />
          </button>
        </div>

        {showAddPage && (
          <div
            className="mx-3 mb-3 space-y-2"
            style={{
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm-token)",
              background: "var(--bg)",
              padding: 10,
            }}
          >
            <Input
              value={newPageName}
              onChange={(e) => setNewPageName(e.target.value)}
              placeholder={t("projectView.pageName", "Page name")}
              className="h-8 text-xs"
            />
            <Input
              value={newPagePath}
              onChange={(e) => setNewPagePath(e.target.value)}
              placeholder={t("projectView.pagePath", "/path")}
              className="h-8 text-xs"
            />
            <div className="flex gap-2">
              <button type="button" className="fd-btn primary flex-1" onClick={handleAddPage}>
                <FolderPlus size={14} />
                {t("common.add", "Add")}
              </button>
              <button type="button" className="fd-btn ghost" onClick={() => setShowAddPage(false)}>
                {t("common.cancel", "Cancel")}
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 space-y-2 px-3 pb-4">
          {currentProject.pages.map((page) => {
            const active = page.id === selectedPageId;
            return (
              <button
                key={page.id}
                type="button"
                className="w-full text-left"
                onClick={() => selectPage(page.id)}
                style={{
                  border: `1px solid ${active ? "var(--cobalt-line)" : "var(--border)"}`,
                  borderRadius: "var(--radius-sm-token)",
                  background: active ? "var(--cobalt-soft)" : "var(--bg)",
                  padding: 10,
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate" style={{ color: "var(--fg)", fontWeight: 700 }}>
                      {page.path}
                    </div>
                    <div className="truncate" style={{ color: "var(--muted-fg)", fontSize: 12 }}>
                      {page.name}
                    </div>
                  </div>
                  <ScoreRing score={pageScore(page)} size={38} stroke={4} />
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <StatusPill status={pageStatus(page)} />
                  <span className="mono" style={{ color: "var(--muted-fg)", fontSize: 11 }}>
                    {page.designSources.length}
                  </span>
                </div>
              </button>
            );
          })}

          {currentProject.pages.length === 0 && !showAddPage && (
            <button
              type="button"
              className="w-full"
              onClick={() => setShowAddPage(true)}
              style={{
                border: "1px dashed var(--border-strong)",
                borderRadius: "var(--radius-sm-token)",
                color: "var(--muted-fg)",
                padding: 20,
              }}
            >
              <Plus className="mx-auto mb-2" size={18} />
              {t("projectView.noPagesAction", "Add a page to start")}
            </button>
          )}
        </div>
      </aside>

      <main className="scroll min-w-0 flex-1 overflow-y-auto p-5">
        {selectedPage ? (
          <div className="mx-auto flex max-w-5xl flex-col gap-4">
            <section
              className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"
              style={{
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-token)",
                background: "var(--surface)",
                padding: 20,
              }}
            >
              <div className="min-w-0">
                <div className="mb-2 flex items-center gap-2">
                  <StatusPill status={selectedStatus} />
                  <span className="fd-chip">
                    <Globe size={13} />
                    {currentProject.implementationUrl}
                    {selectedPage.path}
                  </span>
                </div>
                <h1 className="truncate" style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.1 }}>
                  {selectedPage.name}
                </h1>
              </div>
              <ScoreRing score={selectedScore} size={80} stroke={7} />
            </section>

            <section
              style={{
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-token)",
                background: "var(--surface)",
                padding: 20,
              }}
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 style={{ fontSize: 16, fontWeight: 760 }}>
                    {t("projectView.sources", "Design Sources")}
                  </h2>
                  <p style={{ color: "var(--muted-fg)", fontSize: 13 }}>
                    {primarySource
                      ? sourceLabel(primarySource)
                      : t("projectView.noSources", "No design sources yet")}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="fd-btn"
                    onClick={() => setShowAddSource(!showAddSource)}
                  >
                    <Plus size={15} />
                    {t("projectView.addSource", "Add Design Source")}
                  </button>
                  <button
                    type="button"
                    className="fd-btn ghost text-destructive"
                    onClick={() => {
                      removePage(selectedPage.id);
                      saveCurrentProject();
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>

              {showAddSource && (
                <div
                  className="mb-4 space-y-2"
                  onDragEnter={handleSourceDragOver}
                  onDragOver={handleSourceDragOver}
                  onDragLeave={() => setIsDraggingSourceImage(false)}
                  onDrop={handleSourceDrop}
                  style={{
                    border: `1px solid ${
                      isDraggingSourceImage ? "var(--cobalt)" : "var(--border)"
                    }`,
                    borderRadius: "var(--radius-sm-token)",
                    background: isDraggingSourceImage ? "var(--cobalt-soft)" : "var(--bg)",
                    padding: 12,
                  }}
                >
                  <Input
                    value={newSourceLabel}
                    onChange={(e) => setNewSourceLabel(e.target.value)}
                    placeholder={t("projectView.sourceLabel", "Label (e.g. PC Design, SP Design)")}
                  />
                  <Input
                    value={newSourceUrl}
                    onChange={(e) => setNewSourceUrl(e.target.value)}
                    placeholder={t("projectView.sourceUrl", "Figma URL or local image path")}
                  />
                  <div className="flex gap-2">
                    <button type="button" className="fd-btn primary" onClick={handleAddSource}>
                      {t("common.add", "Add")}
                    </button>
                    <button
                      type="button"
                      className="fd-btn ghost"
                      onClick={() => setShowAddSource(false)}
                    >
                      {t("common.cancel", "Cancel")}
                    </button>
                  </div>
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-2">
                {selectedPage.designSources.map((source) => (
                  <article
                    key={source.id}
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-sm-token)",
                      background: "var(--bg)",
                      padding: 12,
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className="fd-pill"
                            style={{
                              background: "var(--cobalt-soft)",
                              color: "var(--cobalt)",
                            }}
                          >
                            {source.type === "figma" ? "Figma" : "Local"}
                          </span>
                          <h3 className="truncate" style={{ fontWeight: 720 }}>
                            {source.label}
                          </h3>
                        </div>
                        <p
                          className="mt-2 truncate"
                          style={{ color: "var(--muted-fg)", fontSize: 12 }}
                        >
                          {sourceLabel(source)}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="fd-icon-btn h-6 text-destructive"
                        onClick={() => {
                          removeDesignSource(selectedPage.id, source.id);
                          saveCurrentProject();
                        }}
                        aria-label={t("common.delete")}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <button
                      type="button"
                      className="fd-btn mt-3 w-full justify-center"
                      onClick={() => handleCompare(source)}
                    >
                      <ExternalLink size={15} />
                      {t("projectView.compare", "Compare")}
                    </button>
                  </article>
                ))}

                {selectedPage.designSources.length === 0 && !showAddSource && (
                  <button
                    type="button"
                    className="flex flex-col items-center justify-center gap-2"
                    onClick={() => setShowAddSource(true)}
                    style={{
                      border: "1px dashed var(--border-strong)",
                      borderRadius: "var(--radius-sm-token)",
                      color: "var(--muted-fg)",
                      minHeight: 150,
                    }}
                  >
                    <FileImage size={28} />
                    {t("projectView.noSources", "No design sources yet")}
                  </button>
                )}
              </div>
            </section>

            <section
              className="grid gap-4 lg:grid-cols-[1fr_auto]"
              style={{
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-token)",
                background: "var(--surface)",
                padding: 20,
              }}
            >
              <div
                onDragEnter={handleScreenshotDragOver}
                onDragOver={handleScreenshotDragOver}
                onDragLeave={() => setIsDraggingScreenshot(false)}
                onDrop={handleScreenshotDrop}
                style={{
                  border: `1px dashed ${
                    isDraggingScreenshot ? "var(--cobalt)" : "var(--border-strong)"
                  }`,
                  borderRadius: "var(--radius-sm-token)",
                  background: isDraggingScreenshot ? "var(--cobalt-soft)" : "var(--bg)",
                  minHeight: 170,
                  padding: 18,
                }}
              >
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                  <ImagePlus size={30} style={{ color: "var(--cobalt)" }} />
                  <h2 style={{ fontSize: 16, fontWeight: 760 }}>{t("compare.screenshotLabel")}</h2>
                  <p style={{ color: "var(--muted-fg)", fontSize: 13 }}>
                    {screenshotImage
                      ? t("compare.screenshotLoaded")
                      : t("compare.screenshotInstruction")}
                  </p>
                </div>
              </div>
              <div className="flex min-w-52 flex-col justify-between gap-3">
                {projectError && (
                  <div
                    style={{
                      border: "1px solid var(--diff)",
                      borderRadius: "var(--radius-sm-token)",
                      background: "var(--diff-soft)",
                      color: "var(--diff)",
                      padding: 10,
                      fontSize: 13,
                    }}
                  >
                    {projectError}
                  </div>
                )}
                <button
                  type="button"
                  className="fd-btn primary justify-center"
                  disabled={!primarySource || projectLoading}
                  onClick={() => {
                    if (primarySource) {
                      handleCompare(primarySource);
                    }
                  }}
                >
                  {t("project.startCompare")}
                  <ArrowRight size={16} />
                </button>
              </div>
            </section>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <div
              className="max-w-md text-center"
              style={{
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-token)",
                background: "var(--surface)",
                padding: 32,
              }}
            >
              <FolderPlus className="mx-auto mb-3" size={44} style={{ color: "var(--faint-fg)" }} />
              <h3 style={{ fontSize: 18, fontWeight: 760 }}>
                {t("projectView.emptyTitle", "Getting Started")}
              </h3>
              <p className="mt-2" style={{ color: "var(--muted-fg)", fontSize: 14 }}>
                {t(
                  "projectView.emptyDescription",
                  "Compare your Figma designs with the actual implementation in 3 steps",
                )}
              </p>
              <button
                type="button"
                className="fd-btn primary mt-6 w-full justify-center"
                onClick={() => setShowAddPage(true)}
              >
                <Plus size={16} />
                {t("projectView.addFirstPage", "Add Your First Page")}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

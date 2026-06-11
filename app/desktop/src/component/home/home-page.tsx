import { useState } from "react";

import { ArrowRight, FolderOpen, Globe, Layers, Link2, Plus, Rocket, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { buildFigmaFrameUrl, isTokenError, parseDesignInput } from "@figdiff/shared";
import type { Frame } from "@figdiff/shared";

import { Input } from "@/component/ui/input";
import { ScoreRing } from "@/component/ui/score-ring";
import { Spinner } from "@/component/ui/spinner";
import { StatusPill } from "@/component/ui/status-pill";
import type { StatusType } from "@/component/ui/status-pill";
import { useOverlayStore } from "@/store/overlay-store";
import { useProjectListStore } from "@/store/project-list-store";
import { useProjectStore } from "@/store/project-store";
import { useSettingStore } from "@/store/setting-store";
import { useTabStore } from "@/store/tab-store";

import type { Page } from "../../App";
import { DesignInput } from "./design-input";

interface HomePageProps {
  onNavigate: (page: Page) => void;
}

const projectScore = (): number => 0;

const projectStatus = (pageCount: number): StatusType => {
  return pageCount > 0 ? "checking" : "idle";
};

export const HomePage = ({ onNavigate }: HomePageProps) => {
  const { t } = useTranslation();
  const projectLoading = useProjectStore((s) => s.isLoading);
  const loadError = useProjectStore((s) => s.error);
  const clearError = useProjectStore((s) => s.clearError);
  const figmaToken = useSettingStore((s) => s.figmaToken);
  const oauthState = useSettingStore((s) => s.oauthState);
  const startFigmaLogin = useSettingStore((s) => s.startFigmaLogin);
  const projects = useProjectListStore((s) => s.projects);
  const listLoading = useProjectListStore((s) => s.isLoading);
  const listError = useProjectListStore((s) => s.error);
  const createProject = useProjectListStore((s) => s.createProject);
  const openProject = useProjectListStore((s) => s.openProject);
  const deleteProject = useProjectListStore((s) => s.deleteProject);
  const [designUrl, setDesignUrl] = useState("");
  const [implUrl, setImplUrl] = useState("");
  const [pageFrames, setPageFrames] = useState<Frame[]>([]);
  const [pageBaseUrl, setPageBaseUrl] = useState("");
  const [createName, setCreateName] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [loginStatus, setLoginStatus] = useState<"idle" | "pending" | "error">("idle");

  const isConnected = oauthState.mode === "oauth" || oauthState.mode === "pat" || !!figmaToken;

  const handleCreateProject = async () => {
    const trimmedName = createName.trim();
    const trimmedImplUrl = implUrl.trim();
    if (!trimmedName || !trimmedImplUrl) return;

    const trimmedDesignUrl = designUrl.trim();
    if (trimmedDesignUrl) {
      try {
        const parsed = parseDesignInput(trimmedDesignUrl);
        if (parsed.type === "figma_url" && !figmaToken && oauthState.mode !== "oauth") {
          useProjectStore.setState({ error: t("home.tokenRequired"), isLoading: false });
          useSettingStore.getState().requireToken();
          return;
        }
      } catch {
        // Figma URL 以外の入力は従来どおり後続の読み込み処理に委ねる
      }
    }

    try {
      const project = await createProject(trimmedName, trimmedImplUrl);
      const tabId = useTabStore.getState().openTab(project.id, project.name);
      await openProject(project.id);
      if (tabId) {
        useTabStore.getState().setActiveTab(tabId);
      }
      onNavigate("project");
      setCreateName("");
      setShowCreateForm(false);
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
    onNavigate("project");
  };

  const ensureQuickCompareTab = (page: Page = "project"): void => {
    const { activeTabId } = useTabStore.getState();
    if (activeTabId) return;
    const tabId = useTabStore
      .getState()
      .openTab("quick-compare", t("home.quickCompare", "Quick Compare"));
    useTabStore.getState().setTabPage(tabId, page);
  };

  const navigateAfterLoad = async (): Promise<void> => {
    const trimmedImplUrl = implUrl.trim();
    if (trimmedImplUrl) {
      const { frames } = useProjectStore.getState();
      if (frames.length > 0 && frames[0]) {
        await useProjectStore.getState().selectFrame(frames[0]);
        if (useProjectStore.getState().error) return;
      }
      useOverlayStore.getState().setUrl(trimmedImplUrl);
      ensureQuickCompareTab("live_overlay");
      onNavigate("live_overlay");
      return;
    }
    const { frames, frameImage } = useProjectStore.getState();
    if (frames.length > 0 || frameImage) {
      ensureQuickCompareTab("project");
      onNavigate("project");
      return;
    }
    useProjectStore.setState({ error: t("home.noDesignFound") });
  };

  const handleLoadError = (err: unknown): void => {
    console.error(err);
    useProjectStore.setState({ error: String(err), isLoading: false });
  };

  const handleFrameSelect = async (frame: Frame) => {
    setPageFrames([]);
    const frameUrl = buildFigmaFrameUrl(pageBaseUrl, frame.id);
    clearError();
    await useProjectStore.getState().loadDesign(frameUrl);

    const { error: loadErr } = useProjectStore.getState();
    if (loadErr) return;

    await navigateAfterLoad().catch(handleLoadError);
  };

  const tryPageDetection = async (
    input: string,
    fileKey: string,
    nodeId: string,
  ): Promise<boolean> => {
    try {
      const nodeDetail = await window.electronAPI.getFigmaNodeDetail(fileKey, nodeId, 1);
      if (nodeDetail.nodeType !== "CANVAS") return false;

      const frames = await window.electronAPI.getFigmaPageFrames(fileKey, nodeId);
      if (frames.length === 1 && frames[0]) {
        const frameUrl = buildFigmaFrameUrl(input, frames[0].id);
        await useProjectStore.getState().loadDesign(frameUrl);
        const { error: loadErr } = useProjectStore.getState();
        if (loadErr) return true;
        ensureQuickCompareTab("project");
        onNavigate("project");
        return true;
      }
      if (frames.length > 1) {
        setPageBaseUrl(input);
        setPageFrames(frames);
        return true;
      }
      useProjectStore.setState({ error: t("home.noDesignFound") });
      return true;
    } catch (e) {
      const errorMsg = String(e);
      if (isTokenError(errorMsg)) {
        useProjectStore.setState({ error: t("home.tokenRequired"), isLoading: false });
        useSettingStore.getState().requireToken();
        return true;
      }
      console.warn("Page frame detection failed, falling back to single frame flow", e);
      return false;
    }
  };

  const handleLegacySubmit = async (input: string) => {
    if (projectLoading) return;
    setPageFrames([]);
    useProjectStore.setState({ isLoading: true, error: null });

    try {
      const parsed = (() => {
        try {
          return parseDesignInput(input);
        } catch {
          return null;
        }
      })();

      const isFigmaUrl = parsed?.type === "figma_url";
      if (isFigmaUrl && !figmaToken && oauthState.mode !== "oauth") {
        useProjectStore.setState({ error: t("home.tokenRequired"), isLoading: false });
        useSettingStore.getState().requireToken();
        return;
      }

      if (isFigmaUrl && parsed.type === "figma_url" && parsed.nodeId) {
        const handled = await tryPageDetection(input, parsed.fileKey, parsed.nodeId);
        if (handled) {
          useProjectStore.setState({ isLoading: false });
          return;
        }
      }

      clearError();
      await useProjectStore.getState().loadDesign(input);

      const { error: loadErr } = useProjectStore.getState();
      if (loadErr) return;

      await navigateAfterLoad();
    } catch (err) {
      handleLoadError(err);
    }
  };

  const handleLauncherSubmit = async () => {
    if (implUrl.trim()) {
      await handleCreateProject();
      return;
    }
    if (designUrl.trim()) {
      await handleLegacySubmit(designUrl.trim());
      return;
    }
  };

  const handleHeroAction = async () => {
    if (!isConnected) {
      setLoginStatus("pending");
      try {
        await startFigmaLogin();
        setLoginStatus("idle");
      } catch (e) {
        console.error(e);
        setLoginStatus("error");
      }
      return;
    }
    await handleCreateProject();
  };

  const isLoading = projectLoading || listLoading;
  const error = loadError || listError;

  return (
    <div className="scroll mx-auto flex h-full max-w-6xl flex-col gap-5 overflow-y-auto">
      <section
        style={{
          border: "1px solid var(--cobalt-line)",
          borderRadius: "var(--radius-lg-token)",
          background:
            "linear-gradient(135deg, var(--surface) 0%, var(--cobalt-soft) 54%, var(--surface-2) 100%)",
          boxShadow: "0 22px 70px hsl(var(--shadow-color) / 0.12)",
          padding: 28,
        }}
      >
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="fd-chip mb-4" style={{ background: "var(--surface)" }}>
              <Rocket size={14} />
              {t("home.pageTitle")}
            </div>
            <h1 style={{ color: "var(--fg)", fontSize: 44, fontWeight: 800, lineHeight: 1.05 }}>
              FigDiff
            </h1>
            <p className="mt-3 max-w-xl" style={{ color: "var(--fg-2)", fontSize: 16 }}>
              {t("home.pageDescription")}
            </p>
          </div>
          <button
            type="button"
            className="fd-btn primary"
            onClick={isConnected ? () => setShowCreateForm(true) : handleHeroAction}
          >
            {isConnected ? t("home.newProject") : t("home.startFigmaLogin", "Login with Figma")}
            <ArrowRight size={16} />
          </button>
        </div>
      </section>

      <section
        style={{
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-token)",
          background: "var(--surface)",
          padding: 18,
        }}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 style={{ color: "var(--fg)", fontSize: 16, fontWeight: 700 }}>
              {t("home.inputTitle")}
            </h2>
            <p style={{ color: "var(--muted-fg)", fontSize: 13 }}>{t("home.inputHint")}</p>
          </div>
          <span className="fd-pill" style={{ background: "var(--cobalt-soft)", color: "var(--cobalt)" }}>
            {t("home.stepLabel", { n: 1 })}
          </span>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr_auto]">
          <label
            className="flex items-center gap-2"
            style={{
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm-token)",
              background: "var(--bg)",
              padding: "0 12px",
            }}
          >
            <Link2 size={16} style={{ color: "var(--muted-fg)" }} />
            <Input
              value={designUrl}
              onChange={(e) => setDesignUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && designUrl.trim()) {
                  handleLauncherSubmit();
                }
              }}
              placeholder={t("home.inputPlaceholder")}
              disabled={isLoading}
              className="border-0 bg-transparent shadow-none focus-visible:ring-0"
            />
          </label>
          <label
            className="flex items-center gap-2"
            style={{
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm-token)",
              background: "var(--bg)",
              padding: "0 12px",
            }}
          >
            <Globe size={16} style={{ color: "var(--muted-fg)" }} />
            <Input
              value={implUrl}
              onChange={(e) => setImplUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleLauncherSubmit();
                }
              }}
              placeholder={t("home.implUrlPlaceholder")}
              aria-label={t("home.implUrlPlaceholder")}
              disabled={isLoading}
              className="border-0 bg-transparent shadow-none focus-visible:ring-0"
            />
          </label>
          <button
            type="button"
            className="fd-btn primary justify-center"
            onClick={handleLauncherSubmit}
            disabled={isLoading || (!designUrl.trim() && !implUrl.trim())}
          >
            <Plus size={16} />
            {t("common.submit")}
          </button>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            className="fd-btn"
            onClick={() => setShowCreateForm((current) => !current)}
          >
            <Plus size={15} />
            {t("home.newProject")}
          </button>
        </div>

        {showCreateForm && (
          <div
            className="mt-4 space-y-3"
            style={{
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm-token)",
              background: "var(--bg)",
              padding: 14,
            }}
          >
            <h3 style={{ color: "var(--fg)", fontSize: 15, fontWeight: 740 }}>
              {t("home.createProject")}
            </h3>
            <Input
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder={t("home.projectName")}
              disabled={isLoading}
              style={{ background: "var(--surface)", borderColor: "var(--border)" }}
            />
            <Input
              value={implUrl}
              onChange={(e) => setImplUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleCreateProject();
                }
              }}
              placeholder={t("home.implementationUrl")}
              disabled={isLoading}
              style={{ background: "var(--surface)", borderColor: "var(--border)" }}
            />
            <div className="flex gap-2">
              <button
                type="button"
                className="fd-btn primary"
                onClick={handleCreateProject}
                disabled={isLoading}
              >
                {t("common.create")}
              </button>
              <button
                type="button"
                className="fd-btn ghost"
                onClick={() => setShowCreateForm(false)}
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        )}

        {pageFrames.length > 0 && (
          <div className="mt-4 grid gap-2">
            <div className="flex items-center gap-2" style={{ color: "var(--fg-2)", fontSize: 13 }}>
              <Layers size={15} />
              {t("home.pageFrames", "Frames in this page")} ({pageFrames.length})
            </div>
            {pageFrames.map((frame) => (
              <button
                key={frame.id}
                type="button"
                onClick={() => handleFrameSelect(frame)}
                disabled={isLoading}
                className="flex items-center justify-between text-left"
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm-token)",
                  background: "var(--bg)",
                  color: "var(--fg)",
                  padding: "10px 12px",
                }}
              >
                <span style={{ fontWeight: 650 }}>{frame.name}</span>
                <span className="mono" style={{ color: "var(--muted-fg)", fontSize: 12 }}>
                  {frame.width}x{frame.height}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {error && (
        <div
          style={{
            border: "1px solid var(--diff)",
            borderRadius: "var(--radius-sm-token)",
            background: "var(--diff-soft)",
            color: "var(--diff)",
            padding: 12,
          }}
        >
          {error}
        </div>
      )}

      {loginStatus === "error" && (
        <div style={{ color: "var(--diff)", fontSize: 13 }}>Figma ログインに失敗しました</div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center gap-2" style={{ color: "var(--muted-fg)" }}>
          <Spinner size="sm" label={t("common.loading")} />
          <span>{t("common.loading")}</span>
        </div>
      )}

      <section className="grid gap-3 md:grid-cols-3">
        {[1, 2, 3].map((n) => (
          <div
            key={n}
            style={{
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-token)",
              background: "var(--surface)",
              padding: 16,
            }}
          >
            <span className="fd-pill" style={{ background: "var(--cobalt-soft)", color: "var(--cobalt)" }}>
              {t("home.stepLabel", { n })}
            </span>
            <p className="mt-3 whitespace-pre-line" style={{ color: "var(--fg)", fontWeight: 720 }}>
              {t(`home.step${n}`)}
            </p>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 style={{ color: "var(--fg)", fontSize: 18, fontWeight: 750 }}>続きから</h2>
            <p style={{ color: "var(--muted-fg)", fontSize: 13 }}>{t("home.howItWorks")}</p>
          </div>
          <span className="mono" style={{ color: "var(--faint-fg)", fontSize: 12 }}>
            v{__APP_VERSION__}
          </span>
        </div>

        {projects.length > 0 ? (
          <div className="grid gap-3">
            {projects.map((project) => {
              const score = projectScore();
              const status = projectStatus(project.pageCount);
              return (
                <article
                  key={project.id}
                  className="grid items-center gap-4 lg:grid-cols-[1fr_auto_auto_auto]"
                  onClick={() => handleOpenProject(project.id, project.name)}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-token)",
                    background: "var(--surface)",
                    cursor: "pointer",
                    padding: 14,
                  }}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <FolderOpen size={17} style={{ color: "var(--cobalt)" }} />
                      <h3 className="truncate" style={{ color: "var(--fg)", fontWeight: 700 }}>
                        {project.name}
                      </h3>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="fd-chip">
                        <Layers size={13} />
                        {t("home.pageCount", "{{count}} pages", { count: project.pageCount })}
                      </span>
                      <span className="truncate" style={{ color: "var(--muted-fg)", fontSize: 12 }}>
                        {project.implementationUrl}
                      </span>
                    </div>
                  </div>
                  <ScoreRing score={score} size={52} stroke={5} />
                  <StatusPill status={status} />
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      className="fd-btn ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteProject(project.id);
                      }}
                      aria-label={t("common.delete")}
                    >
                      <Trash2 className="text-destructive" size={15} />
                    </button>
                    <button
                      type="button"
                      className="fd-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenProject(project.id, project.name);
                      }}
                    >
                      開く
                      <ArrowRight size={15} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div
            className="flex flex-col items-center justify-center gap-2"
            style={{
              border: "1px dashed var(--border-strong)",
              borderRadius: "var(--radius-token)",
              color: "var(--muted-fg)",
              padding: 32,
            }}
          >
            <FolderOpen size={34} style={{ color: "var(--faint-fg)" }} />
            <p>{t("home.noProjects", "No projects yet. Create one to get started.")}</p>
          </div>
        )}
      </section>

      <section
        className="space-y-3"
        style={{
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-token)",
          background: "var(--surface)",
          padding: 18,
        }}
      >
        <h2 style={{ color: "var(--fg)", fontSize: 16, fontWeight: 740 }}>
          {t("home.quickCompare")}
        </h2>
        <DesignInput
          value={designUrl}
          onChange={setDesignUrl}
          onSubmit={handleLegacySubmit}
          disabled={isLoading}
        />
      </section>
    </div>
  );
};

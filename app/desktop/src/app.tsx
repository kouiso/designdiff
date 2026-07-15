import { useCallback, useEffect, useState } from "react";

import { ComparePage } from "./component/compare/compare-page";
import { HomePage } from "./component/home/home-page";
import { Header } from "./component/layout/header";
import { TabBar } from "./component/layout/tab-bar";
import { LiveOverlayPage } from "./component/live-overlay/live-overlay-page";
import { ProjectPage } from "./component/project/project-page";
import { ProjectView } from "./component/project/project-view";
import { SettingsScreen } from "./component/setting/setting-screen";
import { TokenRequiredDialog } from "./component/setting/token-required-dialog";
import { ErrorBoundary } from "./component/ui/error-boundary";
import { getOverlay } from "./lib/platform";
import { cn } from "./lib/util";
import { useOverlayStore } from "./store/overlay-store";
import { useProjectListStore } from "./store/project-list-store";
import { useSettingStore } from "./store/setting-store";
import { useTabStore } from "./store/tab-store";

export type Page = "home" | "project" | "compare" | "live_overlay" | "settings" | "project_view";

const QUICK_COMPARE_PROJECT_ID = "quick-compare";

export const App = () => {
  const [standalonePage, setStandalonePage] = useState<Page | null>(null);
  const loadSettings = useSettingStore((s) => s.loadSettings);
  const loadProjects = useProjectListStore((s) => s.loadProjects);
  const openProject = useProjectListStore((s) => s.openProject);
  const currentProjectId = useProjectListStore((s) => s.currentProject?.id ?? null);
  const activeTab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null);
  const tabs = useTabStore((s) => s.tabs);
  const isOverlayOpen = useOverlayStore((s) => s.isOpen);
  const activeProjectId = activeTab?.projectId ?? null;

  const currentPage = activeTab?.page ?? standalonePage ?? "home";

  useEffect(() => {
    loadSettings();
    loadProjects();
  }, [loadSettings, loadProjects]);

  useEffect(() => {
    if (!activeProjectId || activeProjectId === QUICK_COMPARE_PROJECT_ID) return;
    if (currentProjectId === activeProjectId) return;

    openProject(activeProjectId);
  }, [activeProjectId, currentProjectId, openProject]);

  const handleNavigate = useCallback(
    (target: Page) => {
      const leavingOverlay = currentPage === "live_overlay" && target !== "live_overlay";
      if (leavingOverlay) {
        useOverlayStore.getState().closeSite();
      }

      if (target === "settings") {
        setStandalonePage("settings");
        useTabStore.getState().setActiveTab(null);
        return;
      }

      if (target === "live_overlay") {
        setStandalonePage("live_overlay");
        useTabStore.getState().setActiveTab(null);
        return;
      }

      setStandalonePage(null);

      if (target === "home") {
        useTabStore.getState().setActiveTab(null);
        return;
      }
      if (activeTab) {
        useTabStore.getState().setTabPage(activeTab.id, target);
      }
    },
    [currentPage, activeTab],
  );

  useEffect(() => {
    if (activeTab && standalonePage) {
      if (standalonePage === "live_overlay") {
        useOverlayStore.getState().closeSite();
      }
      setStandalonePage(null);
    }
  }, [activeTab, standalonePage]);

  useEffect(() => {
    if (currentPage === "live_overlay" || !isOverlayOpen) return;
    useOverlayStore.getState().closeSite();
  }, [currentPage, isOverlayOpen]);

  useEffect(() => {
    if (currentPage === "live_overlay") return;
    getOverlay()
      .then((overlay) => overlay?.close())
      .catch(() => {
        // ページ遷移直後にネイティブビューが既に閉じている場合は無視する
      });
  }, [currentPage]);

  const showTabBar = tabs.length > 0;
  const showHome = !activeTab && !standalonePage;

  return (
    <ErrorBoundary>
      <div className="flex h-screen flex-col bg-background text-foreground">
        <Header currentPage={showHome ? "home" : currentPage} onNavigate={handleNavigate} />
        {showTabBar && <TabBar />}
        <main
          className={cn(
            "flex-1 overflow-hidden",
            showHome
              ? "p-6"
              : currentPage === "live_overlay" || currentPage === "settings"
                ? "p-0"
                : "p-2",
          )}
        >
          {showHome && <HomePage onNavigate={handleNavigate} />}
          {!showHome && currentPage === "project_view" && (
            <ProjectView onNavigate={handleNavigate} />
          )}
          {!showHome && currentPage === "project" && <ProjectPage onNavigate={handleNavigate} />}
          {!showHome && currentPage === "compare" && <ComparePage />}
          {!showHome && currentPage === "live_overlay" && (
            <LiveOverlayPage onNavigate={handleNavigate} />
          )}
          {!showHome && currentPage === "settings" && <SettingsScreen />}
        </main>
        <TokenRequiredDialog />
      </div>
    </ErrorBoundary>
  );
};

import { useEffect, useState } from "react";

import { ComparePage } from "./component/compare/compare-page";
import { HomePage } from "./component/home/home-page";
import { Header } from "./component/layout/header";
import { TabBar } from "./component/layout/tab-bar";
import { LiveOverlayPage } from "./component/live-overlay/live-overlay-page";
import { ProjectPage } from "./component/project/project-page";
import { ProjectView } from "./component/project/project-view";
import { SettingDialog } from "./component/setting/setting-dialog";
import { TokenRequiredDialog } from "./component/setting/token-required-dialog";
import { ErrorBoundary } from "./component/ui/error-boundary";
import { cn } from "./lib/util";
import { useProjectListStore } from "./store/project-list-store";
import { useSettingStore } from "./store/setting-store";
import { useTabStore } from "./store/tab-store";

export type Page = "home" | "project" | "compare" | "live_overlay" | "settings" | "project_view";

export const App = () => {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const loadSettings = useSettingStore((s) => s.loadSettings);
  const loadProjects = useProjectListStore((s) => s.loadProjects);
  const activeTab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null);
  const tabs = useTabStore((s) => s.tabs);

  const currentPage = activeTab?.page ?? "home";

  useEffect(() => {
    loadSettings();
    loadProjects();
  }, [loadSettings, loadProjects]);

  const handleNavigate = (target: Page) => {
    if (target === "settings") {
      setSettingsOpen(true);
      return;
    }
    if (target === "home") {
      useTabStore.getState().setActiveTab(null);
      return;
    }
    if (activeTab) {
      useTabStore.getState().setTabPage(activeTab.id, target);
    }
  };

  const showTabBar = tabs.length > 0;
  const showHome = !activeTab;

  return (
    <ErrorBoundary>
      <div className="flex h-screen flex-col bg-background text-foreground">
        <Header currentPage={showHome ? "home" : currentPage} onNavigate={handleNavigate} />
        {showTabBar && <TabBar />}
        <main
          className={cn(
            "flex-1 overflow-hidden",
            showHome ? "p-6" : currentPage === "live_overlay" ? "p-0" : "p-2",
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
        </main>
        <SettingDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        <TokenRequiredDialog />
      </div>
    </ErrorBoundary>
  );
};

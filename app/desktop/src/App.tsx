import { useEffect, useState } from "react";

import { ComparePage } from "./component/compare/compare-page";
import { HomePage } from "./component/home/home-page";
import { Header } from "./component/layout/header";
import { LiveOverlayPage } from "./component/live-overlay/live-overlay-page";
import { ProjectPage } from "./component/project/project-page";
import { SettingDialog } from "./component/setting/setting-dialog";
import { TokenRequiredDialog } from "./component/setting/token-required-dialog";
import { ErrorBoundary } from "./component/ui/error-boundary";
import { cn } from "./lib/util";
import { useSettingStore } from "./store/setting-store";

export type Page = "home" | "project" | "compare" | "live_overlay" | "settings";

export function App() {
  const [page, setPage] = useState<Page>("home");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const loadSettings = useSettingStore((s) => s.loadSettings);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleNavigate = (target: Page) => {
    if (target === "settings") {
      setSettingsOpen(true);
      return;
    }
    setPage(target);
  };

  return (
    <ErrorBoundary>
      <div className="flex h-screen flex-col bg-background text-foreground">
        <Header currentPage={page} onNavigate={handleNavigate} />
        <main
          className={cn(
            "flex-1 overflow-hidden",
            page === "home" ? "p-6" : page === "live_overlay" ? "p-0" : "p-2",
          )}
        >
          {page === "home" && <HomePage onNavigate={handleNavigate} />}
          {page === "project" && <ProjectPage onNavigate={handleNavigate} />}
          {page === "compare" && <ComparePage />}
          {page === "live_overlay" && <LiveOverlayPage onNavigate={handleNavigate} />}
        </main>
        <SettingDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        <TokenRequiredDialog />
      </div>
    </ErrorBoundary>
  );
}

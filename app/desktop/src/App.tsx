import { useEffect, useState } from "react";

import { ComparePage } from "./component/compare/compare-page";
import { HomePage } from "./component/home/home-page";
import { Header } from "./component/layout/header";
import { ProjectPage } from "./component/project/project-page";
import { SettingDialog } from "./component/setting/setting-dialog";
import { TokenRequiredDialog } from "./component/setting/token-required-dialog";
import { useSettingStore } from "./store/setting-store";

export type Page = "home" | "project" | "compare" | "settings";

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
    <div className="flex h-screen flex-col bg-background text-foreground">
      <Header currentPage={page} onNavigate={handleNavigate} />
      <main className="flex-1 overflow-auto p-6">
        {page === "home" && <HomePage onNavigate={handleNavigate} />}
        {page === "project" && <ProjectPage onNavigate={handleNavigate} />}
        {page === "compare" && <ComparePage />}
      </main>
      <SettingDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <TokenRequiredDialog />
    </div>
  );
}

import { ChevronRight, Layers, Moon, Settings, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/component/ui/button";
import { useSettingStore } from "@/store/setting-store";

import type { Page } from "../../App";

interface HeaderProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

export function Header({ currentPage, onNavigate }: HeaderProps) {
  const { t } = useTranslation();
  const { theme, setTheme } = useSettingStore();

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-border border-b bg-card/60 px-4 backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          onClick={() => onNavigate("home")}
          className="mr-1 h-auto gap-1.5 px-1 font-bold text-lg tracking-tight hover:bg-transparent"
        >
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm">
            F
          </span>
          <span>FigDiff</span>
        </Button>
        <nav className="flex items-center gap-1 text-sm" aria-label={t("nav.breadcrumb")}>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
          <button
            type="button"
            onClick={() => onNavigate("home")}
            className={
              currentPage === "home"
                ? "font-medium text-foreground"
                : "text-muted-foreground transition-colors hover:text-foreground"
            }
            aria-current={currentPage === "home" ? "page" : undefined}
          >
            {t("nav.home")}
          </button>
          {(currentPage === "project" || currentPage === "compare") && (
            <>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
              <button
                type="button"
                onClick={() => onNavigate("project")}
                className={
                  currentPage === "project"
                    ? "font-medium text-foreground"
                    : "text-muted-foreground transition-colors hover:text-foreground"
                }
                aria-current={currentPage === "project" ? "page" : undefined}
              >
                {t("nav.project")}
              </button>
            </>
          )}
          {currentPage === "compare" && (
            <>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
              <span className="font-medium text-foreground">{t("nav.compare")}</span>
            </>
          )}
          {currentPage === "live_overlay" && (
            <>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
              <span className="font-medium text-foreground">{t("nav.liveOverlay")}</span>
            </>
          )}
        </nav>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onNavigate("live_overlay")}
          className={`h-9 gap-1.5 text-sm ${currentPage === "live_overlay" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          <Layers className="h-4 w-4" />
          {t("nav.liveOverlay")}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label={t("settings.toggleTheme")}
          className="h-9 w-9 text-muted-foreground hover:text-foreground"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onNavigate("settings")}
          aria-label={t("nav.settings")}
          className="h-9 w-9 text-muted-foreground hover:text-foreground"
        >
          <Settings className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}

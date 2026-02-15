import { Settings } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { Page } from "../../App";

interface HeaderProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

export function Header({ currentPage, onNavigate }: HeaderProps) {
  const { t } = useTranslation();

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => onNavigate("home")} className="text-xl font-bold">
          FigDiff
        </button>
        <nav className="flex items-center gap-1.5 text-base">
          <button
            type="button"
            onClick={() => onNavigate("home")}
            className={
              currentPage === "home"
                ? "text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground"
            }
          >
            {t("nav.home")}
          </button>
          {currentPage === "project" && (
            <>
              <span className="text-muted-foreground/50">/</span>
              <span className="text-foreground font-medium">{t("nav.project")}</span>
            </>
          )}
          {currentPage === "compare" && (
            <>
              <span className="text-muted-foreground/50">/</span>
              <button
                type="button"
                onClick={() => onNavigate("project")}
                className="text-muted-foreground hover:text-foreground"
              >
                {t("nav.project")}
              </button>
              <span className="text-muted-foreground/50">/</span>
              <span className="text-foreground font-medium">{t("nav.compare")}</span>
            </>
          )}
        </nav>
      </div>
      <button
        type="button"
        onClick={() => onNavigate("settings")}
        className="text-muted-foreground hover:text-foreground"
        aria-label={t("nav.settings")}
      >
        <Settings className="h-5 w-5" />
      </button>
    </header>
  );
}

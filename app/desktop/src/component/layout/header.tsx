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
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
      <div className="flex items-center gap-4">
        <button type="button" onClick={() => onNavigate("home")} className="text-lg font-bold">
          FigDiff
        </button>
        <nav className="flex gap-4 text-sm">
          <button
            type="button"
            onClick={() => onNavigate("home")}
            className={currentPage === "home" ? "text-foreground" : "text-muted-foreground"}
          >
            {t("nav.home")}
          </button>
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

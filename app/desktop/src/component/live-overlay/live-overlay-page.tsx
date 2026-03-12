import { useEffect } from "react";

import { useTranslation } from "react-i18next";

import { useOverlayStore } from "@/store/overlay-store";

import type { Page } from "../../App";
import { LiveOverlayPanel } from "./live-overlay-panel";

interface LiveOverlayPageProps {
  onNavigate: (page: Page) => void;
}

export function LiveOverlayPage({ onNavigate }: LiveOverlayPageProps) {
  const { t } = useTranslation();
  const isOpen = useOverlayStore((s) => s.isOpen);

  useEffect(() => {
    const unsubscribe = window.electronAPI.overlay.onNavigated((url) => {
      useOverlayStore.getState().handleNavigated(url);
    });
    return unsubscribe;
  }, []);

  return (
    <div className="flex h-full flex-col">
      <LiveOverlayPanel onNavigate={onNavigate} />
      {!isOpen && (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <p className="text-sm">{t("overlay.urlPlaceholder")}</p>
        </div>
      )}
    </div>
  );
}

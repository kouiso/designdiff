import { useEffect } from "react";

import { useTranslation } from "react-i18next";

import { getOverlay } from "@/lib/platform";
import { useOverlayStore } from "@/store/overlay-store";

import { LiveOverlayPanel } from "./live-overlay-panel";

import type { Page } from "../../App";

interface LiveOverlayPageProps {
  onNavigate: (page: Page) => void;
}

export function LiveOverlayPage({ onNavigate }: LiveOverlayPageProps) {
  const { t } = useTranslation();
  const isOpen = useOverlayStore((s) => s.isOpen);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    getOverlay().then((overlay) => {
      if (cancelled || !overlay) return;

      if (!useOverlayStore.getState().isOpen) {
        overlay.close();
      }

      unsubscribe = overlay.onNavigated((url) => {
        useOverlayStore.getState().handleNavigated(url);
      });
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
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

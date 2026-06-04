import { useEffect } from "react";

import { useTranslation } from "react-i18next";

import { CompareDiffReport } from "@/component/compare/compare-diff-report";
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
  const isLiveDiffEnabled = useOverlayStore((s) => s.isLiveDiffEnabled);
  const overlayImageBase64 = useOverlayStore((s) => s.overlayImageBase64);
  const liveDiffResult = useOverlayStore((s) => s.liveDiffResult);

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

  useEffect(() => {
    if (!isOpen || !isLiveDiffEnabled || !overlayImageBase64) return;

    useOverlayStore
      .getState()
      .runLiveDiff()
      .catch(() => undefined);
    const intervalId = window.setInterval(() => {
      useOverlayStore
        .getState()
        .runLiveDiff()
        .catch(() => undefined);
    }, 800);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isLiveDiffEnabled, isOpen, overlayImageBase64]);

  return (
    <div className="flex h-full flex-col">
      <LiveOverlayPanel onNavigate={onNavigate} />
      {isOpen && liveDiffResult && <CompareDiffReport compareResult={liveDiffResult} />}
      {!isOpen && (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <p className="text-sm">{t("overlay.urlPlaceholder")}</p>
        </div>
      )}
    </div>
  );
}

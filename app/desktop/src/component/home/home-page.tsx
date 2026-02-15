import { useTranslation } from "react-i18next";

import { Spinner } from "@/component/ui/spinner";
import { useProjectStore } from "@/store/project-store";
import { useSettingStore } from "@/store/setting-store";

import type { Page } from "../../App";
import { DesignInput } from "./design-input";

interface HomePageProps {
  onNavigate: (page: Page) => void;
}

export function HomePage({ onNavigate }: HomePageProps) {
  const { t } = useTranslation();
  const { loadDesign, isLoading, error, clearError } = useProjectStore();
  const { figmaToken } = useSettingStore();

  const handleSubmit = async (input: string) => {
    if (input.includes("figma.com") && !figmaToken) {
      useProjectStore.setState({
        error: t("home.tokenRequired"),
      });
      return;
    }
    clearError();
    await loadDesign(input);
    const { frames, frameImage } = useProjectStore.getState();
    if (frames.length > 0 || frameImage) {
      onNavigate("project");
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-8 pt-16">
      <div className="space-y-2 text-center">
        <h1 className="text-4xl font-bold tracking-tight">{t("app.title")}</h1>
        <p className="text-base text-muted-foreground">{t("app.description")}</p>
      </div>

      <DesignInput onSubmit={handleSubmit} disabled={isLoading} />

      {error && (
        <div className="rounded-md border border-red-500 bg-red-900/60 p-4 text-base font-medium text-red-200">
          {error}
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center gap-2">
          <Spinner size="sm" />
          <span className="text-sm text-muted-foreground">{t("common.loading")}</span>
        </div>
      )}
    </div>
  );
}

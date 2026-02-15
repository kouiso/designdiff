import { GitCompare, ImageIcon, Layers } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Card, CardContent } from "@/component/ui/card";
import { Spinner } from "@/component/ui/spinner";
import { cn } from "@/lib/util";
import { useProjectStore } from "@/store/project-store";
import { useSettingStore } from "@/store/setting-store";

import { DesignInput } from "./design-input";

import type { Page } from "../../App";

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

  const steps = [
    {
      icon: ImageIcon,
      key: "step1" as const,
      color: "bg-primary/15 text-primary",
    },
    {
      icon: Layers,
      key: "step2" as const,
      color: "bg-accent text-accent-foreground",
    },
    {
      icon: GitCompare,
      key: "step3" as const,
      color: "bg-success/15 text-success",
    },
  ];

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col justify-center space-y-10">
      {/* Hero section */}
      <div className="space-y-3 text-center">
        <h1 className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text font-bold text-4xl text-transparent tracking-tight">
          {t("home.pageTitle")}
        </h1>
        <p className="text-base text-muted-foreground">{t("home.pageDescription")}</p>
      </div>

      {/* Input */}
      <DesignInput onSubmit={handleSubmit} disabled={isLoading} />

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">
          {error}
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center gap-2">
          <Spinner size="sm" label={t("common.loading")} />
          <span className="text-muted-foreground">{t("common.loading")}</span>
        </div>
      )}

      {/* Workflow cards */}
      <div className="space-y-3">
        <h2 className="text-center font-medium text-muted-foreground text-sm uppercase tracking-widest">
          {t("home.howItWorks")}
        </h2>
        <div className="grid grid-cols-3 gap-4">
          {steps.map((step, i) => (
            <Card key={step.key} className="border-border/60 bg-card/80">
              <CardContent className="flex flex-col items-center gap-3 p-5 text-center">
                <div
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-xl",
                    step.color,
                  )}
                >
                  <step.icon className="h-5 w-5" />
                </div>
                <span className="font-bold text-muted-foreground text-xs">
                  {t("home.stepLabel", { n: i + 1 })}
                </span>
                <p className="whitespace-pre-line font-medium text-sm leading-relaxed">
                  {t(`home.${step.key}`)}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

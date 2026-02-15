import { GitCompare, ImageIcon, Layers } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/component/ui/badge";
import { Button } from "@/component/ui/button";
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
    <div className="mx-auto flex h-full max-w-3xl flex-col justify-center gap-8">
      <section className="rounded-2xl border border-border/60 bg-gradient-to-br from-primary/10 via-accent/40 to-background p-6 shadow-sm">
        <Badge variant="secondary" className="mb-3 w-fit">
          {t("home.stepLabel", { n: 1 })}
        </Badge>
        <h1 className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text font-bold text-4xl text-transparent tracking-tight">
          {t("home.pageTitle")}
        </h1>
        <p className="mt-2 text-base text-muted-foreground">{t("home.pageDescription")}</p>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="font-semibold text-lg">{t("home.inputTitle")}</h2>
          <p className="text-muted-foreground text-sm">{t("home.inputHint")}</p>
        </div>
        <DesignInput onSubmit={handleSubmit} disabled={isLoading} />
        {!figmaToken && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-accent px-4 py-3">
            <p className="text-accent-foreground text-sm">{t("home.tokenRequired")}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onNavigate("settings")}
              className="shrink-0"
            >
              {t("nav.settings")}
            </Button>
          </div>
        )}
      </section>

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

      <section className="space-y-3">
        <h2 className="text-center font-medium text-muted-foreground text-sm uppercase tracking-widest">
          {t("home.howItWorks")}
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
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
      </section>
    </div>
  );
}

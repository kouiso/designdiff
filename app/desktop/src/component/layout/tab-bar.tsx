import { Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/component/ui/button";
import { cn } from "@/lib/util";
import { useTabStore } from "@/store/tab-store";

export const TabBar = () => {
  const { t } = useTranslation();
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const setActiveTab = useTabStore((s) => s.setActiveTab);
  const closeTab = useTabStore((s) => s.closeTab);

  return (
    <div className="flex h-9 shrink-0 items-center gap-0 border-border/60 border-b bg-muted/30 px-1">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => setActiveTab(tab.id)}
          className={cn(
            "group flex h-7 max-w-48 items-center gap-1 rounded-md px-2 text-xs transition-colors",
            tab.id === activeTabId
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
          )}
        >
          <span className="min-w-0 flex-1 truncate text-left">{tab.label}</span>
          <span
            role="button"
            tabIndex={0}
            className="ml-1 rounded p-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              closeTab(tab.id);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                closeTab(tab.id);
              }
            }}
            aria-label={t("tab.close", { name: tab.label })}
          >
            <X className="h-3 w-3" />
          </span>
        </button>
      ))}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground hover:text-foreground"
        onClick={() => setActiveTab(null)}
        aria-label={t("tab.new")}
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
};

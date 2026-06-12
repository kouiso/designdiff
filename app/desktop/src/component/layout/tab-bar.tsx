import { Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/util";
import { useTabStore } from "@/store/tab-store";

export const TabBar = () => {
  const { t } = useTranslation();
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const setActiveTab = useTabStore((s) => s.setActiveTab);
  const closeTab = useTabStore((s) => s.closeTab);

  return (
    <div
      style={{
        height: 40,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "0 8px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg)",
        overflowX: "auto",
      }}
      className="scroll"
    >
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn("group")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              minWidth: 0,
              maxWidth: 220,
              padding: "0 8px 0 11px",
              height: 30,
              borderRadius: 9,
              border: active ? "1px solid var(--border)" : "1px solid transparent",
              color: active ? "var(--fg)" : "var(--muted-fg)",
              background: active ? "var(--bg-2)" : "transparent",
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
              transition: "background 0.14s, color 0.14s, border-color 0.14s",
              flexShrink: 0,
              fontFamily: "inherit",
            }}
          >
            {/* ステータスドット */}
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 99,
                background: "var(--cobalt)",
                flexShrink: 0,
              }}
            />
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flex: 1,
                textAlign: "left",
              }}
            >
              {tab.label}
            </span>
            <span
              role="button"
              tabIndex={0}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 18,
                height: 18,
                borderRadius: 6,
                color: "var(--faint-fg)",
                flexShrink: 0,
              }}
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
              <X size={12} />
            </span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => setActiveTab(null)}
        aria-label={t("tab.new")}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          borderRadius: 8,
          color: "var(--muted-fg)",
          background: "none",
          border: "none",
          cursor: "pointer",
          flexShrink: 0,
          transition: "all 0.14s",
        }}
      >
        <Plus size={14} />
      </button>
    </div>
  );
};

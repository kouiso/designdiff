import type { ReactNode } from "react";

import { BarChart2, Home, Layers, Settings, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Logo } from "@/component/layout/logo";
import { useSettingStore } from "@/store/setting-store";

import type { Page } from "../../App";

interface HeaderProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

interface NavItem {
  id: Page;
  icon: ReactNode;
  label: string;
}

export function Header({ currentPage, onNavigate }: HeaderProps) {
  const { t } = useTranslation();
  const { theme, setTheme } = useSettingStore();

  const navItems: NavItem[] = [
    { id: "home", icon: <Home size={15} />, label: t("nav.home") },
    { id: "project", icon: <SlidersHorizontal size={15} />, label: t("nav.project") },
    { id: "compare", icon: <BarChart2 size={15} />, label: t("nav.compare") },
    { id: "live_overlay", icon: <Layers size={15} />, label: t("nav.liveOverlay") },
    { id: "settings", icon: <Settings size={15} />, label: t("nav.settings") },
  ];

  const activeId: Page = currentPage === "project_view" ? "project" : currentPage;

  return (
    <header
      style={{
        height: 56,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 0,
        padding: "0 16px",
        borderBottom: "1px solid var(--border)",
        background: "var(--surface)",
      }}
    >
      {/* ロゴ */}
      <button
        type="button"
        onClick={() => onNavigate("home")}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "0 12px 0 0",
          display: "flex",
          alignItems: "center",
        }}
      >
        <Logo size={28} variant="full" />
      </button>

      {/* 区切り線 */}
      <span
        style={{
          width: 1,
          height: 20,
          background: "var(--border)",
          marginRight: 12,
          flexShrink: 0,
        }}
      />

      {/* ナビゲーション */}
      <nav style={{ display: "flex", gap: 2 }} aria-label="Main navigation">
        {navItems.map((item) => {
          const active = activeId === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              aria-current={active ? "page" : undefined}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                padding: "6px 12px",
                borderRadius: "var(--radius-sm-token)",
                background: active ? "var(--surface-2)" : "transparent",
                border: active ? "1px solid var(--border)" : "1px solid transparent",
                color: active ? "var(--fg)" : "var(--muted-fg)",
                fontSize: 13,
                fontWeight: active ? 600 : 500,
                cursor: "pointer",
                transition: "all 0.14s",
                fontFamily: "inherit",
              }}
              onMouseEnter={(e) => {
                if (!active) {
                  e.currentTarget.style.color = "var(--fg-2)";
                  e.currentTarget.style.background = "var(--surface-2)";
                }
              }}
              onMouseLeave={(e) => {
                if (!active) {
                  e.currentTarget.style.color = "var(--muted-fg)";
                  e.currentTarget.style.background = "transparent";
                }
              }}
            >
              {item.icon}
              {item.label}
            </button>
          );
        })}
      </nav>

      <span style={{ flex: 1 }} />

      {/* 右側: テーマ切替と新規比較 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label={t("settings.toggleTheme")}
          className="fd-icon-btn"
          title={theme === "dark" ? "ライトモード" : "ダークモード"}
        >
          {theme === "dark" ? (
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
            </svg>
          ) : (
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
        <button
          type="button"
          onClick={() => onNavigate("compare")}
          className="fd-btn primary"
          style={{ padding: "7px 14px", fontSize: 13 }}
        >
          <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {t("header.newCompare", "新規比較")}
        </button>
      </div>
    </header>
  );
}

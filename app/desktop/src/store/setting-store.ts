import { create } from "zustand";

import type { FigmaAuthState } from "@figdiff/shared";

import { getPlatform } from "@/lib/platform";

interface SettingState {
  figmaToken: string | null;
  oauthState: FigmaAuthState;
  theme: "light" | "dark";
  defaultThreshold: number;
  isLoading: boolean;
  showTokenDialog: boolean;
  // 表示用のミラー。正本は Electron main 側の telemetry-config.json。
  telemetryConsent: boolean;

  setFigmaToken: (token: string) => Promise<void>;
  removeFigmaToken: () => Promise<void>;
  loadSettings: () => Promise<void>;
  setTheme: (theme: "light" | "dark") => void;
  setDefaultThreshold: (threshold: number) => void;
  requireToken: () => void;
  closeTokenDialog: () => void;
  setTelemetryConsent: (consent: boolean) => Promise<void>;

  startFigmaLogin: () => Promise<void>;
  logoutFigma: () => Promise<void>;
  saveOAuthClient: (clientId: string, clientSecret: string) => Promise<void>;
  loadOAuthStatus: () => Promise<void>;
}

export const useSettingStore = create<SettingState>((set) => ({
  figmaToken: null,
  oauthState: { mode: "none" },
  theme: "dark",
  defaultThreshold: 0.1,
  isLoading: false,
  showTokenDialog: false,
  telemetryConsent: false,

  setFigmaToken: async (token: string) => {
    const platform = await getPlatform();
    await platform.token.save(token);
    set({ figmaToken: token, showTokenDialog: false });
  },

  removeFigmaToken: async () => {
    const platform = await getPlatform();
    await platform.token.delete();
    set({ figmaToken: null });
  },

  loadSettings: async () => {
    set({ isLoading: true });
    try {
      const platform = await getPlatform();
      const [token, oauthState, telemetryConsent] = await Promise.all([
        platform.token.get(),
        platform.oauth.status(),
        platform.analytics.getConsent(),
      ]);
      const saved = localStorage.getItem("figdiff-theme");
      const theme = saved === "light" ? "light" : "dark";
      document.documentElement.classList.toggle("dark", theme === "dark");
      set({ figmaToken: token, oauthState, theme, telemetryConsent });
    } finally {
      set({ isLoading: false });
    }
  },

  setTheme: (theme) => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("figdiff-theme", theme);
    set({ theme });
  },

  setDefaultThreshold: (threshold) => set({ defaultThreshold: threshold }),

  requireToken: () => set({ showTokenDialog: true }),

  closeTokenDialog: () => set({ showTokenDialog: false }),

  setTelemetryConsent: async (consent: boolean) => {
    const platform = await getPlatform();
    await platform.analytics.setConsent(consent);
    // 要求値をそのまま反映しない。Web 版の setConsent は no-op で常に false を
    // 返すため、要求値を鵜呑みにすると「押したら有効に見えるのに実際は何も
    // 起きていない」表示になる。実効値を読み直して初めて表示と実態が揃う。
    const effectiveConsent = await platform.analytics.getConsent();
    set({ telemetryConsent: effectiveConsent });
  },

  startFigmaLogin: async () => {
    const platform = await getPlatform();
    await platform.oauth.start();
    const oauthState = await platform.oauth.status();
    set({ oauthState, showTokenDialog: false });
  },

  logoutFigma: async () => {
    const platform = await getPlatform();
    await platform.oauth.logout();
    set({ oauthState: { mode: "none" } });
  },

  saveOAuthClient: async (clientId: string, clientSecret: string) => {
    const platform = await getPlatform();
    await platform.oauth.saveClient(clientId, clientSecret);
  },

  loadOAuthStatus: async () => {
    const platform = await getPlatform();
    const oauthState = await platform.oauth.status();
    set({ oauthState });
  },
}));

import { beforeEach, describe, expect, it } from "vitest";

import { useTabStore } from "./tab-store";

beforeEach(() => {
  useTabStore.setState({ tabs: [], activeTabId: null });
});

describe("useTabStore", () => {
  describe("openTab", () => {
    it("新しいタブを開ける", () => {
      const id = useTabStore.getState().openTab("proj-1", "Test Project");
      expect(id).toBeTruthy();
      expect(useTabStore.getState().tabs).toHaveLength(1);
      expect(useTabStore.getState().activeTabId).toBe(id);
    });

    it("同じプロジェクトのタブが既にあれば再利用する", () => {
      const id1 = useTabStore.getState().openTab("proj-1", "Test");
      const id2 = useTabStore.getState().openTab("proj-1", "Test");
      expect(id1).toBe(id2);
      expect(useTabStore.getState().tabs).toHaveLength(1);
    });

    it("異なるプロジェクトは別タブで開く", () => {
      useTabStore.getState().openTab("proj-1", "Project 1");
      useTabStore.getState().openTab("proj-2", "Project 2");
      expect(useTabStore.getState().tabs).toHaveLength(2);
    });
  });

  describe("closeTab", () => {
    it("タブを閉じられる", () => {
      const id = useTabStore.getState().openTab("proj-1", "Test");
      useTabStore.getState().closeTab(id);
      expect(useTabStore.getState().tabs).toHaveLength(0);
      expect(useTabStore.getState().activeTabId).toBeNull();
    });

    it("アクティブなタブを閉じたら隣のタブがアクティブになる", () => {
      const id1 = useTabStore.getState().openTab("proj-1", "P1");
      const id2 = useTabStore.getState().openTab("proj-2", "P2");
      useTabStore.getState().setActiveTab(id2);
      useTabStore.getState().closeTab(id2);
      expect(useTabStore.getState().activeTabId).toBe(id1);
    });

    it("最後のタブを閉じたらactiveTabIdがnullになる", () => {
      const id = useTabStore.getState().openTab("proj-1", "Test");
      useTabStore.getState().closeTab(id);
      expect(useTabStore.getState().activeTabId).toBeNull();
    });
  });

  describe("setActiveTab", () => {
    it("アクティブタブを切り替えられる", () => {
      const id1 = useTabStore.getState().openTab("proj-1", "P1");
      const id2 = useTabStore.getState().openTab("proj-2", "P2");
      useTabStore.getState().setActiveTab(id1);
      expect(useTabStore.getState().activeTabId).toBe(id1);
      useTabStore.getState().setActiveTab(id2);
      expect(useTabStore.getState().activeTabId).toBe(id2);
    });
  });

  describe("setTabPage", () => {
    it("タブのページを変更できる", () => {
      const id = useTabStore.getState().openTab("proj-1", "Test");
      useTabStore.getState().setTabPage(id, "compare");
      const tab = useTabStore.getState().tabs.find((t) => t.id === id);
      expect(tab?.page).toBe("compare");
    });
  });

  describe("getActiveTab", () => {
    it("アクティブなタブを取得できる", () => {
      const id = useTabStore.getState().openTab("proj-1", "Test");
      const active = useTabStore.getState().getActiveTab();
      expect(active?.id).toBe(id);
      expect(active?.projectId).toBe("proj-1");
    });

    it("タブがない場合はnullを返す", () => {
      expect(useTabStore.getState().getActiveTab()).toBeNull();
    });
  });
});

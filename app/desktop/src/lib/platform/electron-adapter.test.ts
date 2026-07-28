import { beforeEach, describe, expect, it, vi } from "vitest";

import { electronAdapter, electronCapabilities, electronOverlayAdapter } from "./electron-adapter";

describe("electronAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("figma", () => {
    it("getFrames が electronAPI.getFigmaFrames を呼び Zod parse する", async () => {
      const frames = [{ id: "1:2", name: "Home", width: 1440, height: 900 }];
      vi.mocked(window.electronAPI.getFigmaFrames).mockResolvedValueOnce(frames);

      const result = await electronAdapter.figma.getFrames("ABC123");

      expect(window.electronAPI.getFigmaFrames).toHaveBeenCalledWith("ABC123");
      expect(result).toEqual(frames);
    });

    it("getFrameImage が fileKey, nodeId, scale を渡す", async () => {
      vi.mocked(window.electronAPI.getFigmaFrameImage).mockResolvedValueOnce("base64img");

      const result = await electronAdapter.figma.getFrameImage("ABC123", "1:2", 3);

      expect(window.electronAPI.getFigmaFrameImage).toHaveBeenCalledWith("ABC123", "1:2", 3);
      expect(result).toBe("base64img");
    });

    it("getFrameImage の scale デフォルト値は 2", async () => {
      vi.mocked(window.electronAPI.getFigmaFrameImage).mockResolvedValueOnce("img");

      await electronAdapter.figma.getFrameImage("ABC", "1:1");

      expect(window.electronAPI.getFigmaFrameImage).toHaveBeenCalledWith("ABC", "1:1", 2);
    });

    it("getNodeDetail が electronAPI.getFigmaNodeDetail を呼び Zod parse する", async () => {
      const nodeDetail = {
        nodeId: "1:1",
        nodeName: "Frame",
        nodeType: "FRAME",
        layout: { x: 0, y: 0, width: 100, height: 100 },
        appearance: {
          fills: [],
          strokes: [],
          effects: [],
          borderRadius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
          opacity: 1,
          blendMode: "NORMAL",
        },
        childrenSummary: [],
        cssSuggestion: "css",
      };
      vi.mocked(window.electronAPI.getFigmaNodeDetail).mockResolvedValueOnce(nodeDetail);

      const result = await electronAdapter.figma.getNodeDetail("ABC", "1:1");

      expect(window.electronAPI.getFigmaNodeDetail).toHaveBeenCalledWith("ABC", "1:1", 3);
      expect(result.nodeId).toBe("1:1");
    });

    it("getNodeDetail が指定された depth を渡す", async () => {
      const nodeDetail = {
        nodeId: "1:1",
        nodeName: "Frame",
        nodeType: "FRAME",
        layout: { x: 0, y: 0, width: 100, height: 100 },
        appearance: {
          fills: [],
          strokes: [],
          effects: [],
          borderRadius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
          opacity: 1,
          blendMode: "NORMAL",
        },
        childrenSummary: [],
        cssSuggestion: "css",
      };
      vi.mocked(window.electronAPI.getFigmaNodeDetail).mockResolvedValueOnce(nodeDetail);

      await electronAdapter.figma.getNodeDetail("ABC", "1:1", 1);

      expect(window.electronAPI.getFigmaNodeDetail).toHaveBeenCalledWith("ABC", "1:1", 1);
    });
  });

  describe("token", () => {
    it("save が FigmaTokenSchema.parse + electronAPI.saveFigmaToken を呼ぶ", async () => {
      vi.mocked(window.electronAPI.saveFigmaToken).mockResolvedValueOnce(undefined);

      await electronAdapter.token.save("figd_valid_token_12345");

      expect(window.electronAPI.saveFigmaToken).toHaveBeenCalledWith("figd_valid_token_12345");
    });

    it("get が electronAPI.getFigmaToken を呼ぶ", async () => {
      vi.mocked(window.electronAPI.getFigmaToken).mockResolvedValueOnce("token123");

      const result = await electronAdapter.token.get();

      expect(result).toBe("token123");
    });

    it("delete が electronAPI.deleteFigmaToken を呼ぶ", async () => {
      vi.mocked(window.electronAPI.deleteFigmaToken).mockResolvedValueOnce(undefined);

      await electronAdapter.token.delete();

      expect(window.electronAPI.deleteFigmaToken).toHaveBeenCalled();
    });
  });

  describe("file", () => {
    it("readLocalImage が electronAPI.readLocalImage を呼ぶ", async () => {
      vi.mocked(window.electronAPI.readLocalImage).mockResolvedValueOnce("localImg");

      const result = await electronAdapter.file.readLocalImage("/path/to/img.png");

      expect(window.electronAPI.readLocalImage).toHaveBeenCalledWith("/path/to/img.png");
      expect(result).toBe("localImg");
    });

    it("captureUrlScreenshot が width/height を Math.round して渡す", async () => {
      vi.mocked(window.electronAPI.captureUrlScreenshot).mockResolvedValueOnce("screenshot");

      const result = await electronAdapter.file.captureUrlScreenshot(
        "http://example.com",
        100.7,
        200.3,
      );

      expect(window.electronAPI.captureUrlScreenshot).toHaveBeenCalledWith(
        "http://example.com",
        101,
        200,
      );
      expect(result).toBe("screenshot");
    });
  });
});

describe("electronOverlayAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("open が electronAPI.overlay.open を呼ぶ", async () => {
    await electronOverlayAdapter.open("http://localhost:3000");
    expect(window.electronAPI.overlay.open).toHaveBeenCalledWith("http://localhost:3000");
  });

  it("close が electronAPI.overlay.close を呼ぶ", async () => {
    await electronOverlayAdapter.close();
    expect(window.electronAPI.overlay.close).toHaveBeenCalled();
  });

  it("setOverlayImage が base64 と opacity を渡す", async () => {
    await electronOverlayAdapter.setOverlayImage("imgdata", 0.5);
    expect(window.electronAPI.overlay.setOverlayImage).toHaveBeenCalledWith("imgdata", 0.5);
  });

  it("setMode が全パラメータを渡す", async () => {
    await electronOverlayAdapter.setMode("split_screen", "img", 0.8, 0.5);
    expect(window.electronAPI.overlay.setMode).toHaveBeenCalledWith(
      "split_screen",
      "img",
      0.8,
      0.5,
    );
  });

  it("updateSplitPosition が splitPosition を渡す", async () => {
    await electronOverlayAdapter.updateSplitPosition(0.3);
    expect(window.electronAPI.overlay.updateSplitPosition).toHaveBeenCalledWith(0.3);
  });

  it("updateScale が scale と scaleMode を渡す", async () => {
    await electronOverlayAdapter.updateScale(0.75, "actual_size");
    expect(window.electronAPI.overlay.updateScale).toHaveBeenCalledWith(0.75, "actual_size");
  });

  it("toggleStart が intervalMs を渡す", async () => {
    await electronOverlayAdapter.toggleStart(500);
    expect(window.electronAPI.overlay.toggleStart).toHaveBeenCalledWith(500);
  });

  it("toggleStop が呼ばれる", async () => {
    await electronOverlayAdapter.toggleStop();
    expect(window.electronAPI.overlay.toggleStop).toHaveBeenCalled();
  });

  it("onNavigated がコールバックを渡し unsubscribe 関数を返す", () => {
    const callback = vi.fn();
    const unsub = electronOverlayAdapter.onNavigated(callback);
    expect(window.electronAPI.overlay.onNavigated).toHaveBeenCalledWith(callback);
    expect(typeof unsub).toBe("function");
  });
});

describe("electronCapabilities", () => {
  it("全capability が true", () => {
    expect(electronCapabilities.hasOverlay).toBe(true);
    expect(electronCapabilities.hasLocalFileAccess).toBe(true);
    expect(electronCapabilities.hasSecureTokenStorage).toBe(true);
  });
});

describe("electronAdapter 残りの経路", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 未保存を「持っている」と誤って答えると、トークン要求の案内が出ずに
  // 後段の Figma 呼び出しが理由の分からんエラーで落ちる。
  it("token.has は未保存を false、保存済みを true にする", async () => {
    vi.mocked(window.electronAPI.getFigmaToken).mockResolvedValue(null);
    await expect(electronAdapter.token.has()).resolves.toBe(false);

    vi.mocked(window.electronAPI.getFigmaToken).mockResolvedValue("figd_0123456789012345678901");
    await expect(electronAdapter.token.has()).resolves.toBe(true);
  });

  it("overlay.updateOffset がずれ量をそのまま渡す", () => {
    electronOverlayAdapter.updateOffset({ x: 4, y: -8 });
    expect(window.electronAPI.overlay.updateOffset).toHaveBeenCalledWith({ x: 4, y: -8 });
  });

  it("overlay.updateOpacity / removeOverlay / captureScreenshot が届く", () => {
    electronOverlayAdapter.updateOpacity(0.35);
    electronOverlayAdapter.removeOverlay();
    electronOverlayAdapter.captureScreenshot();

    expect(window.electronAPI.overlay.updateOpacity).toHaveBeenCalledWith(0.35);
    expect(window.electronAPI.overlay.removeOverlay).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.overlay.captureScreenshot).toHaveBeenCalledTimes(1);
  });

  it("project.save / delete が引数そのままで渡る", async () => {
    const project = {
      id: "p1",
      name: "Site",
      pages: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    vi.mocked(window.electronAPI.project.save).mockResolvedValue(undefined);
    vi.mocked(window.electronAPI.project.delete).mockResolvedValue(undefined);

    await electronAdapter.project.save(project);
    await electronAdapter.project.delete("p1");

    expect(window.electronAPI.project.save).toHaveBeenCalledWith(project);
    expect(window.electronAPI.project.delete).toHaveBeenCalledWith("p1");
  });

  it("oauth の各操作が main プロセスへ素通しされる", async () => {
    await electronAdapter.oauth.start();
    await electronAdapter.oauth.logout();
    await electronAdapter.oauth.saveClient("client-id", "client-secret");
    await electronAdapter.oauth.getClientId();

    expect(window.electronAPI.oauth.start).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.oauth.logout).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.oauth.saveClient).toHaveBeenCalledWith("client-id", "client-secret");
    expect(window.electronAPI.oauth.getClientId).toHaveBeenCalledTimes(1);
  });
});

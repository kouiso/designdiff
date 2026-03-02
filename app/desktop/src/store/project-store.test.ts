import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useProjectStore } from "./project-store";

const mockInvoke = vi.mocked(invoke);

function resetStore() {
  useProjectStore.setState({
    frames: [],
    selectedFrame: null,
    frameImage: null,
    isLoading: false,
    error: null,
    currentFileKey: null,
  });
}

describe("useProjectStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it("has correct initial state", () => {
    const state = useProjectStore.getState();
    expect(state.frames).toEqual([]);
    expect(state.selectedFrame).toBeNull();
    expect(state.frameImage).toBeNull();
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  describe("loadDesign", () => {
    it("loads frames from Figma URL without node-id", async () => {
      const frames = [{ id: "1:2", name: "Home", width: 1440, height: 900 }];
      mockInvoke.mockResolvedValueOnce(frames);

      await useProjectStore.getState().loadDesign("https://www.figma.com/design/ABC123/Title");

      expect(mockInvoke).toHaveBeenCalledWith("get_figma_frames", { fileKey: "ABC123" });
      expect(useProjectStore.getState().frames).toEqual(frames);
      expect(useProjectStore.getState().isLoading).toBe(false);
    });

    it("loads image directly from Figma URL with node-id", async () => {
      mockInvoke.mockResolvedValueOnce("iVBORw0KGgo=");

      await useProjectStore
        .getState()
        .loadDesign("https://www.figma.com/design/ABC123/Title?node-id=1-23");

      expect(mockInvoke).toHaveBeenCalledWith("get_figma_frame_image", {
        fileKey: "ABC123",
        nodeId: "1:23",
        scale: 2,
      });
      expect(useProjectStore.getState().frameImage).toBe("data:image/png;base64,iVBORw0KGgo=");
    });

    it("loads local image directly", async () => {
      mockInvoke.mockResolvedValueOnce("localBase64==");

      await useProjectStore.getState().loadDesign("/home/user/screenshot.png");

      expect(mockInvoke).toHaveBeenCalledWith("read_local_image", {
        path: "/home/user/screenshot.png",
      });
      expect(useProjectStore.getState().frameImage).toBe("data:image/png;base64,localBase64==");
    });

    it("sets error on invalid input", async () => {
      await useProjectStore.getState().loadDesign("");

      expect(useProjectStore.getState().error).toContain("Input cannot be empty");
    });

    it("sets error on API failure", async () => {
      mockInvoke.mockRejectedValueOnce(new Error("API error"));

      await useProjectStore.getState().loadDesign("https://www.figma.com/design/ABC123/Title");

      expect(useProjectStore.getState().error).toBe("Error: API error");
      expect(useProjectStore.getState().isLoading).toBe(false);
    });
  });

  describe("selectFrame", () => {
    it("loads frame image when frame is selected", async () => {
      useProjectStore.setState({ currentFileKey: "ABC123" });
      mockInvoke.mockResolvedValueOnce("frameBase64==");

      const frame = { id: "1:2", name: "Home", width: 1440, height: 900 };
      await useProjectStore.getState().selectFrame(frame);

      expect(mockInvoke).toHaveBeenCalledWith("get_figma_frame_image", {
        fileKey: "ABC123",
        nodeId: "1:2",
        scale: 2,
      });
      expect(useProjectStore.getState().selectedFrame).toEqual(frame);
      expect(useProjectStore.getState().frameImage).toBe("data:image/png;base64,frameBase64==");
    });

    it("does nothing when no fileKey is set", async () => {
      const frame = { id: "1:2", name: "Home", width: 1440, height: 900 };
      await useProjectStore.getState().selectFrame(frame);

      expect(mockInvoke).not.toHaveBeenCalled();
    });
  });

  describe("reset", () => {
    it("resets state to defaults", () => {
      useProjectStore.setState({
        frames: [{ id: "1", name: "F", width: 100, height: 100 }],
        selectedFrame: { id: "1", name: "F", width: 100, height: 100 },
        frameImage: "data:image/png;base64,xxx",
        isLoading: true,
        error: "old error",
        currentFileKey: "ABC",
      });

      useProjectStore.getState().reset();

      const state = useProjectStore.getState();
      expect(state.frames).toEqual([]);
      expect(state.selectedFrame).toBeNull();
      expect(state.frameImage).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.currentFileKey).toBeNull();
    });
  });
});

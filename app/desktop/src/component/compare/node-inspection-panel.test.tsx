import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DesignToken, NodeInspection } from "@figdiff/shared";

import { getPlatform } from "@/lib/platform";

import { NodeInspectionPanel } from "./node-inspection-panel";

vi.mock("@/lib/platform", () => ({ getPlatform: vi.fn() }));

const getNodeDetail = vi.fn();
const getDesignTokens = vi.fn();

const inspection = (nodeId: string, nodeName: string): NodeInspection => ({
  nodeId,
  nodeName,
  nodeType: "FRAME",
  layout: { x: 10, y: 20, width: 320, height: 180 },
  appearance: { fills: [], strokes: [], opacity: 1, blendMode: "NORMAL", effects: [] },
  cssSuggestion: "width: 320px;",
  childrenSummary: [],
});

const tokens = (nodeId: string, nodeName: string): DesignToken[] => [
  { nodeId, nodeName, nodeType: "FRAME", property: "width", value: 320, unit: "px" },
];

const deferred = <T,>() => {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPlatform).mockResolvedValue({
    figma: {
      getFrames: vi.fn(),
      getFrameImage: vi.fn(),
      getNodeDetail,
      getDesignTokens,
    },
    file: { readLocalImage: vi.fn(), captureUrlScreenshot: vi.fn() },
    token: { save: vi.fn(), get: vi.fn(), has: vi.fn(), delete: vi.fn() },
    project: { list: vi.fn(), load: vi.fn(), save: vi.fn(), delete: vi.fn() },
    oauth: {
      start: vi.fn(),
      logout: vi.fn(),
      status: vi.fn(),
      saveClient: vi.fn(),
      getClientId: vi.fn(),
    },
  });
});

afterEach(cleanup);

describe("NodeInspectionPanel", () => {
  it("選択した候補だけの詳細と共有抽出トークンをEnterキーで取得する", async () => {
    const fileKey = crypto.randomUUID();
    const nodeId = crypto.randomUUID();
    getNodeDetail.mockResolvedValueOnce(inspection(nodeId, "Hero"));
    getDesignTokens.mockResolvedValueOnce(tokens(nodeId, "Hero"));

    render(<NodeInspectionPanel fileKey={fileKey} candidates={[{ nodeId, nodeName: "Hero" }]} />);
    fireEvent.keyDown(screen.getByLabelText("ノードID"), { key: "Enter" });

    expect(await screen.findByTestId("node-inspection-result")).toHaveTextContent("Hero");
    expect(screen.getByText("320px")).toBeInTheDocument();
    expect(getNodeDetail).toHaveBeenCalledWith(fileKey, nodeId, 3);
    expect(getDesignTokens).toHaveBeenCalledWith(fileKey, nodeId, 2);
  });

  it("ファイル切替前の遅い応答を新しい案件へ表示しない", async () => {
    const oldFileKey = crypto.randomUUID();
    const newFileKey = crypto.randomUUID();
    const oldNodeId = crypto.randomUUID();
    const newNodeId = crypto.randomUUID();
    const oldDetail = deferred<NodeInspection>();
    const oldTokens = deferred<DesignToken[]>();
    getNodeDetail
      .mockReturnValueOnce(oldDetail.promise)
      .mockResolvedValueOnce(inspection(newNodeId, "Current node"));
    getDesignTokens
      .mockReturnValueOnce(oldTokens.promise)
      .mockResolvedValueOnce(tokens(newNodeId, "Current node"));

    const view = render(
      <NodeInspectionPanel
        key={JSON.stringify([oldFileKey, oldNodeId])}
        fileKey={oldFileKey}
        candidates={[{ nodeId: oldNodeId, nodeName: "Old node" }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "取得" }));
    expect(screen.getByText("ノード情報を取得中…")).toBeInTheDocument();

    view.rerender(
      <NodeInspectionPanel
        key={JSON.stringify([newFileKey, newNodeId])}
        fileKey={newFileKey}
        candidates={[{ nodeId: newNodeId, nodeName: "Current node" }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "取得" }));
    expect(await screen.findByTestId("node-inspection-result")).toHaveTextContent("Current node");

    await act(async () => {
      oldDetail.resolve(inspection(oldNodeId, "Stale node"));
      oldTokens.resolve(tokens(oldNodeId, "Stale node"));
      await oldDetail.promise;
    });
    expect(screen.queryByText("Stale node")).not.toBeInTheDocument();
    expect(screen.getByTestId("node-inspection-result")).toHaveTextContent("Current node");
  });

  it("取得失敗を表示し同じ対象を再試行できる", async () => {
    const fileKey = crypto.randomUUID();
    const nodeId = crypto.randomUUID();
    getNodeDetail
      .mockRejectedValueOnce(new Error("Node was not found"))
      .mockResolvedValueOnce(inspection(nodeId, "Recovered node"));
    getDesignTokens.mockResolvedValue(tokens(nodeId, "Recovered node"));

    render(<NodeInspectionPanel fileKey={fileKey} candidates={[{ nodeId, nodeName: "Target" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "取得" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Node was not found");

    fireEvent.click(screen.getByRole("button", { name: "再試行" }));
    expect(await screen.findByTestId("node-inspection-result")).toHaveTextContent("Recovered node");
  });

  it("同じ選択フレームの候補追加では手入力したノードIDを保持する", () => {
    const fileKey = crypto.randomUUID();
    const selectedNodeId = crypto.randomUUID();
    const manualNodeId = crypto.randomUUID();
    const nearbyNodeId = crypto.randomUUID();
    const view = render(
      <NodeInspectionPanel
        fileKey={fileKey}
        candidates={[{ nodeId: selectedNodeId, nodeName: "Selected" }]}
      />,
    );

    fireEvent.change(screen.getByLabelText("ノードID"), { target: { value: manualNodeId } });
    view.rerender(
      <NodeInspectionPanel
        fileKey={fileKey}
        candidates={[
          { nodeId: selectedNodeId, nodeName: "Selected" },
          { nodeId: nearbyNodeId, nodeName: "Nearby" },
        ]}
      />,
    );

    expect(screen.getByLabelText("ノードID")).toHaveValue(manualNodeId);
  });
});

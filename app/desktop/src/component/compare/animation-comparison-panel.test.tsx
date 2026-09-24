import { StrictMode } from "react";

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnimationCompareResult } from "@figdiff/shared";

import { compareAnimationImages } from "@/service/animation-comparison";

import { AnimationComparisonPanel } from "./animation-comparison-panel";

vi.mock("@/service/animation-comparison", () => ({ compareAnimationImages: vi.fn() }));

class TestFileReader {
  result: string | ArrayBuffer | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  readAsDataURL(file: File) {
    queueMicrotask(() => {
      if (file.name.startsWith("broken")) {
        this.onerror?.();
        return;
      }
      this.result = `data:image/png;base64,${file.name}`;
      this.onload?.();
    });
  }
}

const deferred = <T,>() => {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
};

const result = (overrides: Partial<AnimationCompareResult> = {}): AnimationCompareResult => ({
  frames: [
    {
      atMs: 0,
      screenshotPath: "implementation:0",
      status: "FAIL",
      matchRate: 0.75,
      comparisonId: "comparison-0",
      diffImagePath: "plain-base64",
    },
  ],
  alignments: [
    { designAtMs: 0, matchedAtMs: 20, driftMs: 20, mismatchRate: 0.25 },
    {
      designAtMs: 100,
      matchedAtMs: null,
      driftMs: null,
      mismatchRate: null,
      reason: "対応する実装フレームがありません。",
    },
  ],
  temporal: {
    status: "FAIL",
    rationale: "見た目が設計と違うフレームがある。",
    maxAbsDriftMs: 20,
    orderViolation: true,
  },
  driftMeasured: true,
  evidencePaths: [],
  ...overrides,
});

const upload = async (label: string, names: string[]) => {
  fireEvent.change(screen.getByLabelText(label), {
    target: { files: names.map((name) => new File(["image"], name, { type: "image/png" })) },
  });
  for (const name of names) expect(await screen.findByText(name)).toBeInTheDocument();
};

const enterTimes = (side: "設計フレーム" | "実装フレーム", values: number[]) => {
  values.forEach((value, index) => {
    fireEvent.change(screen.getByLabelText(`${side} ${index + 1} 時刻`), {
      target: { value: String(value) },
    });
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("FileReader", TestFileReader);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AnimationComparisonPanel", () => {
  it("keeps user order and renders frame mappings, missing frames, local diffs, and the overall verdict", async () => {
    vi.mocked(compareAnimationImages).mockResolvedValue(result());
    render(<AnimationComparisonPanel />);
    await upload("設計フレームを追加", ["design-0.png", "design-100.png"]);
    await upload("実装フレームを追加", ["impl-20.png", "impl-120.png"]);
    enterTimes("設計フレーム", [0, 100]);
    enterTimes("実装フレーム", [20, 120]);
    fireEvent.change(screen.getByLabelText("対応候補の時間幅"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("許容する時間差"), { target: { value: "15" } });

    fireEvent.click(screen.getByRole("button", { name: "時系列を比較" }));

    await waitFor(() =>
      expect(compareAnimationImages).toHaveBeenCalledWith({
        designFrames: [
          { image: "data:image/png;base64,design-0.png", atMs: 0 },
          { image: "data:image/png;base64,design-100.png", atMs: 100 },
        ],
        implFrames: [
          { image: "data:image/png;base64,impl-20.png", atMs: 20 },
          { image: "data:image/png;base64,impl-120.png", atMs: 120 },
        ],
        driftWindowMs: 40,
        driftFailMs: 15,
      }),
    );
    expect(await screen.findByTestId("animation-comparison-result")).toHaveTextContent("FAIL");
    expect(screen.getByText(/0ms → 20ms \(差 20ms\)/)).toBeInTheDocument();
    expect(screen.getByText(/100ms → 欠落/)).toHaveTextContent(
      "対応する実装フレームがありません。",
    );
    expect(screen.getByText("フレーム順序が逆転しています。")).toBeInTheDocument();
    expect(screen.getByAltText("0msの差分")).toHaveAttribute(
      "src",
      "data:image/png;base64,plain-base64",
    );
    expect(screen.getByText(/0ms:/)).toHaveTextContent("75.00%");
  });

  it("states that drift is unmeasured for a single design without inventing a time source", async () => {
    vi.mocked(compareAnimationImages).mockResolvedValue(
      result({
        alignments: [],
        temporal: {
          status: "PASS",
          rationale: "全フレームの見た目が設計と一致しとる。",
          maxAbsDriftMs: null,
          orderViolation: false,
        },
        driftMeasured: false,
        driftUnmeasuredReason: "設計が1枚だけのため、時間差は未計測です。",
        frameTimeSource: undefined,
      }),
    );
    render(<AnimationComparisonPanel />);
    await upload("設計フレームを追加", ["design.png"]);
    await upload("実装フレームを追加", ["impl.png"]);
    enterTimes("設計フレーム", [0]);
    enterTimes("実装フレーム", [80]);
    fireEvent.click(screen.getByRole("button", { name: "時系列を比較" }));

    expect(
      await screen.findByText("設計が1枚だけのため、時間差は未計測です。"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/時刻source/)).not.toBeInTheDocument();
    expect(screen.queryByText(/最大時間差/)).not.toBeInTheDocument();
  });

  it("rejects excessive, missing, duplicate, and unsorted timestamps without sorting or comparing", async () => {
    render(<AnimationComparisonPanel />);
    fireEvent.change(screen.getByLabelText("設計フレームを追加"), {
      target: {
        files: Array.from(
          { length: 13 },
          (_, index) => new File(["image"], `design-${index}.png`, { type: "image/png" }),
        ),
      },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("各側の画像は最大12枚です。");
    expect(compareAnimationImages).not.toHaveBeenCalled();

    await upload("設計フレームを追加", ["design-100.png", "design-0.png"]);
    await upload("実装フレームを追加", ["impl.png"]);
    fireEvent.click(screen.getByRole("button", { name: "時系列を比較" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "設計側の各画像に時刻を入力してください。",
    );
    enterTimes("設計フレーム", [100, 0]);
    enterTimes("実装フレーム", [0]);
    fireEvent.click(screen.getByRole("button", { name: "時系列を比較" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "設計側: 撮影する時刻は小さい順に並べてください",
    );
    expect(compareAnimationImages).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("設計フレーム 2 時刻"), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByRole("button", { name: "時系列を比較" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "設計側: 撮影する時刻は小さい順に並べてください",
    );
    expect(compareAnimationImages).not.toHaveBeenCalled();
  });

  it("shows image read failures and never invokes the comparison adapter", async () => {
    render(<AnimationComparisonPanel />);
    fireEvent.change(screen.getByLabelText("設計フレームを追加"), {
      target: {
        files: [new File(["broken"], "broken-design.png", { type: "image/png" })],
      },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("画像を読み込めませんでした。");
    expect(compareAnimationImages).not.toHaveBeenCalled();
  });

  it("ignores an old comparison after input changes and after unmount", async () => {
    const first = deferred<AnimationCompareResult>();
    vi.mocked(compareAnimationImages).mockReturnValueOnce(first.promise);
    const view = render(<AnimationComparisonPanel />);
    await upload("設計フレームを追加", ["design.png"]);
    await upload("実装フレームを追加", ["impl.png"]);
    enterTimes("設計フレーム", [0]);
    enterTimes("実装フレーム", [0]);
    fireEvent.click(screen.getByRole("button", { name: "時系列を比較" }));
    await waitFor(() => expect(compareAnimationImages).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("実装フレーム 1 時刻"), {
      target: { value: "10" },
    });
    await act(async () => {
      first.resolve(result());
      await first.promise;
    });
    expect(screen.queryByTestId("animation-comparison-result")).not.toBeInTheDocument();

    const second = deferred<AnimationCompareResult>();
    vi.mocked(compareAnimationImages).mockReturnValueOnce(second.promise);
    fireEvent.click(screen.getByRole("button", { name: "時系列を比較" }));
    await waitFor(() => expect(compareAnimationImages).toHaveBeenCalledTimes(2));
    view.unmount();
    await act(async () => {
      second.resolve(result());
      await second.promise;
    });
  });

  it("accepts completed responses after the StrictMode setup-cleanup-setup cycle", async () => {
    vi.mocked(compareAnimationImages).mockResolvedValue(result());
    render(
      <StrictMode>
        <AnimationComparisonPanel />
      </StrictMode>,
    );
    await upload("設計フレームを追加", ["design.png"]);
    await upload("実装フレームを追加", ["impl.png"]);
    enterTimes("設計フレーム", [0]);
    enterTimes("実装フレーム", [0]);
    fireEvent.click(screen.getByRole("button", { name: "時系列を比較" }));
    expect(await screen.findByTestId("animation-comparison-result")).toBeInTheDocument();
  });

  it("disables both file inputs while a FileReader is pending instead of dropping another side", async () => {
    const pending: (() => void)[] = [];
    class DeferredFileReader extends TestFileReader {
      override readAsDataURL(file: File) {
        pending.push(() => {
          this.result = `data:image/png;base64,${file.name}`;
          this.onload?.();
        });
      }
    }
    vi.stubGlobal("FileReader", DeferredFileReader);
    render(<AnimationComparisonPanel />);
    fireEvent.change(screen.getByLabelText("設計フレームを追加"), {
      target: { files: [new File(["image"], "design.png", { type: "image/png" })] },
    });
    expect(screen.getByRole("status")).toHaveTextContent("画像を読み込み中…");
    expect(screen.getByLabelText("設計フレームを追加")).toBeDisabled();
    expect(screen.getByLabelText("実装フレームを追加")).toBeDisabled();
    await act(async () => pending.shift()?.());
    expect(await screen.findByText("design.png")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("実装フレームを追加"), {
      target: { files: [new File(["image"], "impl.png", { type: "image/png" })] },
    });
    await act(async () => pending.shift()?.());
    expect(screen.getByText("design.png")).toBeInTheDocument();
    expect(await screen.findByText("impl.png")).toBeInTheDocument();
  });
});

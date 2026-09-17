import { type ChangeEvent, useEffect, useRef, useState } from "react";

import { useTranslation } from "react-i18next";

import { MAX_FRAMES, parseFrameTimestamps, type AnimationCompareResult } from "@figdiff/shared";

import { compareAnimationImages, type DesktopAnimationFrame } from "@/service/animation-comparison";

interface EditableFrame {
  id: number;
  name: string;
  image: string;
  atMs: string;
}

const readImage = async (file: File): Promise<string> =>
  await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("画像を読み込めませんでした。"));
    };
    reader.onerror = () => reject(new Error("画像を読み込めませんでした。"));
    reader.readAsDataURL(file);
  });

const parseFrames = (frames: EditableFrame[], side: string): DesktopAnimationFrame[] => {
  const timestamps = frames.map((frame) => {
    if (frame.atMs.trim().length === 0) {
      throw new Error(`${side}の各画像に時刻を入力してください。`);
    }
    return Number(frame.atMs);
  });
  let parsedTimestamps: number[];
  try {
    parsedTimestamps = parseFrameTimestamps(timestamps);
  } catch (reason) {
    throw new Error(`${side}: ${reason instanceof Error ? reason.message : String(reason)}`);
  }
  return frames.map((frame, index) => ({ image: frame.image, atMs: parsedTimestamps[index] }));
};

const parseOptionalMs = (value: string, label: string): number | undefined => {
  if (value.trim().length === 0) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label}は0以上の有限値で入力してください。`);
  }
  return parsed;
};

const imageSource = (value: string): string =>
  value.startsWith("data:image/") ? value : `data:image/png;base64,${value}`;

export function AnimationComparisonPanel() {
  const { t } = useTranslation();
  const [designFrames, setDesignFrames] = useState<EditableFrame[]>([]);
  const [implementationFrames, setImplementationFrames] = useState<EditableFrame[]>([]);
  const [driftWindowMs, setDriftWindowMs] = useState("");
  const [driftFailMs, setDriftFailMs] = useState("");
  const [result, setResult] = useState<AnimationCompareResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const operationRef = useRef(0);
  const frameIdRef = useRef(0);
  const mountedRef = useRef(true);
  const fileLoadingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      operationRef.current += 1;
    };
  }, []);

  const invalidateResult = () => {
    operationRef.current += 1;
    setResult(null);
    setError(null);
    setBusy(false);
  };

  const addFiles = async (
    side: "design" | "implementation",
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    if (fileLoadingRef.current) {
      setError("画像の読み込み完了後に追加してください。");
      return;
    }
    const current = side === "design" ? designFrames : implementationFrames;
    invalidateResult();
    const operation = operationRef.current;
    if (current.length + files.length > MAX_FRAMES) {
      setError(`各側の画像は最大${MAX_FRAMES}枚です。`);
      return;
    }
    fileLoadingRef.current = true;
    setFileLoading(true);
    try {
      const loaded = await Promise.all(
        files.map(async (file) => ({
          id: ++frameIdRef.current,
          name: file.name,
          image: await readImage(file),
          atMs: "",
        })),
      );
      if (!mountedRef.current || operation !== operationRef.current) return;
      if (side === "design") setDesignFrames((frames) => [...frames, ...loaded]);
      else setImplementationFrames((frames) => [...frames, ...loaded]);
    } catch (reason) {
      if (mountedRef.current && operation === operationRef.current) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      fileLoadingRef.current = false;
      if (mountedRef.current) setFileLoading(false);
    }
  };

  const updateTime = (side: "design" | "implementation", id: number, atMs: string) => {
    invalidateResult();
    const update = (frames: EditableFrame[]) =>
      frames.map((frame) => (frame.id === id ? { ...frame, atMs } : frame));
    if (side === "design") setDesignFrames(update);
    else setImplementationFrames(update);
  };

  const removeFrame = (side: "design" | "implementation", id: number) => {
    invalidateResult();
    if (side === "design") setDesignFrames((frames) => frames.filter((frame) => frame.id !== id));
    else setImplementationFrames((frames) => frames.filter((frame) => frame.id !== id));
  };

  const compare = async () => {
    const operation = ++operationRef.current;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const compared = await compareAnimationImages({
        designFrames: parseFrames(designFrames, "設計側"),
        implFrames: parseFrames(implementationFrames, "実装側"),
        driftWindowMs: parseOptionalMs(driftWindowMs, "対応候補の時間幅"),
        driftFailMs: parseOptionalMs(driftFailMs, "許容する時間差"),
      });
      if (mountedRef.current && operation === operationRef.current) setResult(compared);
    } catch (reason) {
      if (mountedRef.current && operation === operationRef.current) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      if (mountedRef.current && operation === operationRef.current) setBusy(false);
    }
  };

  return (
    <section className="min-w-0 space-y-4" aria-labelledby="animation-comparison-title">
      <div>
        <h3 id="animation-comparison-title" className="font-semibold text-sm">
          {t("compare.animationTitle", { defaultValue: "アニメーション比較" })}
        </h3>
        <p className="mt-1 text-xs" style={{ color: "var(--muted-fg)" }}>
          {t("compare.animationTimingNotice", {
            defaultValue:
              "設計側は申告時刻、実装側は実際に撮影した時刻を入力してください。入力順は変更しません。",
          })}
        </p>
      </div>

      <div className="grid min-w-0 gap-4">
        <FrameEditor
          title={t("compare.animationDesignFrames", { defaultValue: "設計フレーム" })}
          timeLabel={t("compare.animationDeclaredTime", { defaultValue: "申告時刻" })}
          side="design"
          frames={designFrames}
          disabled={fileLoading}
          onFiles={addFiles}
          onTime={updateTime}
          onRemove={removeFrame}
        />
        <FrameEditor
          title={t("compare.animationImplementationFrames", { defaultValue: "実装フレーム" })}
          timeLabel={t("compare.animationMeasuredTime", { defaultValue: "実測時刻" })}
          side="implementation"
          frames={implementationFrames}
          disabled={fileLoading}
          onFiles={addFiles}
          onTime={updateTime}
          onRemove={removeFrame}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs">
          {t("compare.animationDriftWindow", { defaultValue: "対応候補の時間幅 (ms)" })}
          <input
            aria-label="対応候補の時間幅"
            className="mt-1 w-full rounded border bg-transparent px-2 py-1.5"
            type="number"
            min={0}
            value={driftWindowMs}
            disabled={fileLoading}
            onChange={(event) => {
              invalidateResult();
              setDriftWindowMs(event.target.value);
            }}
          />
        </label>
        <label className="text-xs">
          {t("compare.animationDriftFail", { defaultValue: "許容する時間差 (ms)" })}
          <input
            aria-label="許容する時間差"
            className="mt-1 w-full rounded border bg-transparent px-2 py-1.5"
            type="number"
            min={0}
            value={driftFailMs}
            disabled={fileLoading}
            onChange={(event) => {
              invalidateResult();
              setDriftFailMs(event.target.value);
            }}
          />
        </label>
      </div>

      {fileLoading ? <p role="status">画像を読み込み中…</p> : null}

      <button
        type="button"
        className="fd-btn primary w-full"
        disabled={busy || fileLoading}
        onClick={compare}
      >
        {busy
          ? t("compare.animationComparing", { defaultValue: "比較中…" })
          : t("compare.animationCompare", { defaultValue: "時系列を比較" })}
      </button>
      {error ? (
        <p role="alert" className="text-sm" style={{ color: "var(--diff)" }}>
          {error}
        </p>
      ) : null}
      {result ? <AnimationResult result={result} /> : null}
    </section>
  );
}

function FrameEditor({
  title,
  timeLabel,
  side,
  frames,
  disabled,
  onFiles,
  onTime,
  onRemove,
}: {
  title: string;
  timeLabel: string;
  side: "design" | "implementation";
  frames: EditableFrame[];
  disabled: boolean;
  onFiles: (
    side: "design" | "implementation",
    event: ChangeEvent<HTMLInputElement>,
  ) => Promise<void>;
  onTime: (side: "design" | "implementation", id: number, value: string) => void;
  onRemove: (side: "design" | "implementation", id: number) => void;
}) {
  return (
    <fieldset className="min-w-0 space-y-2 rounded p-3" style={{ background: "var(--surface-2)" }}>
      <legend className="font-semibold text-xs">{title}</legend>
      <input
        aria-label={`${title}を追加`}
        className="block w-full min-w-0 text-xs"
        type="file"
        accept="image/*"
        multiple
        disabled={disabled}
        onChange={async (event) => {
          await onFiles(side, event);
        }}
      />
      <ol className="space-y-2">
        {frames.map((frame, index) => (
          <li
            key={frame.id}
            className="grid min-w-0 grid-cols-[minmax(0,1fr)_6rem_auto] items-end gap-2"
          >
            <span className="min-w-0 truncate text-xs" title={frame.name}>
              {frame.name}
            </span>
            <label className="text-xs">
              {timeLabel} {index + 1} (ms)
              <input
                aria-label={`${title} ${index + 1} 時刻`}
                className="mt-1 w-full rounded border bg-transparent px-2 py-1"
                type="number"
                min={0}
                step={1}
                value={frame.atMs}
                disabled={disabled}
                onChange={(event) => onTime(side, frame.id, event.target.value)}
              />
            </label>
            <button
              type="button"
              className="fd-btn"
              disabled={disabled}
              aria-label={`${frame.name}を削除`}
              onClick={() => onRemove(side, frame.id)}
            >
              削除
            </button>
          </li>
        ))}
      </ol>
      <p className="text-xs" style={{ color: "var(--muted-fg)" }}>
        {frames.length}/{MAX_FRAMES}
      </p>
    </fieldset>
  );
}

function AnimationResult({ result }: { result: AnimationCompareResult }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3" data-testid="animation-comparison-result">
      <div className="rounded p-3" style={{ background: "var(--surface-2)" }}>
        <p>
          {t("compare.animationOverall", { defaultValue: "全体判定" })}:{" "}
          <strong>{result.temporal.status}</strong>
        </p>
        <p className="text-xs">{result.temporal.rationale}</p>
        {result.driftMeasured ? (
          <p className="text-xs">
            {t("compare.animationMaxDrift", { defaultValue: "最大時間差" })}:{" "}
            {result.temporal.maxAbsDriftMs}ms
          </p>
        ) : (
          <p className="text-xs">
            {result.driftUnmeasuredReason ??
              t("compare.animationDriftUnmeasured", { defaultValue: "時間差は未計測です。" })}
          </p>
        )}
        {result.temporal.orderViolation ? (
          <p className="text-xs" style={{ color: "var(--diff)" }}>
            {t("compare.animationOrderViolation", {
              defaultValue: "フレーム順序が逆転しています。",
            })}
          </p>
        ) : null}
        {result.frameTimeSource ? (
          <p className="text-xs">
            {t("compare.animationTimeSource", { defaultValue: "時刻source" })}:{" "}
            {result.frameTimeSource}
          </p>
        ) : null}
      </div>

      {result.alignments.length > 0 ? (
        <ol aria-label="フレーム対応" className="space-y-1">
          {result.alignments.map((alignment) => (
            <li key={alignment.designAtMs} className="text-xs">
              {alignment.designAtMs}ms →{" "}
              {alignment.matchedAtMs === null ? "欠落" : `${alignment.matchedAtMs}ms`}
              {alignment.driftMs === null ? "" : ` (差 ${alignment.driftMs}ms)`}
              {alignment.reason ? ` — ${alignment.reason}` : ""}
            </li>
          ))}
        </ol>
      ) : null}

      <ol aria-label="局所フレーム結果" className="grid gap-2 sm:grid-cols-2">
        {result.frames.map((frame) => (
          <li
            key={frame.comparisonId}
            className="rounded p-2"
            style={{ background: "var(--surface-2)" }}
          >
            <p className="text-xs">
              {frame.atMs}ms: <strong>{frame.status}</strong> {(frame.matchRate * 100).toFixed(2)}%
            </p>
            <p className="mono truncate text-xs" title={frame.comparisonId}>
              {frame.comparisonId}
            </p>
            {frame.diffImagePath ? (
              <img
                className="mt-2 aspect-video w-full object-contain"
                src={imageSource(frame.diffImagePath)}
                alt={`${frame.atMs}msの差分`}
              />
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

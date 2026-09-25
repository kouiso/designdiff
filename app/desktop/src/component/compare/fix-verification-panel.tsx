import { useState } from "react";

import { useTranslation } from "react-i18next";

import type { FixTargetRegionMeasurement } from "@/service/diff-report";
import { type DesktopFixVerification, listFixRegionIds } from "@/service/fix-verification";
import { useCompareStore } from "@/store/compare-store";

const formatDelta = (value: number): string => `${value >= 0 ? "+" : ""}${value.toFixed(3)}`;

export function FixVerificationPanel() {
  const { t } = useTranslation();
  const currentComparison = useCompareStore((state) => state.currentComparison);
  const fixBaseline = useCompareStore((state) => state.fixBaseline);
  const fixVerification = useCompareStore((state) => state.fixVerification);
  const selectedTargetId = useCompareStore((state) => state.selectedFixTargetId);
  const fixError = useCompareStore((state) => state.fixError);
  const isComparing = useCompareStore((state) => state.isComparing);
  const setSelectedTargetId = useCompareStore((state) => state.setSelectedFixTargetId);
  const pinBaseline = useCompareStore((state) => state.pinFixBaseline);
  const verifyFix = useCompareStore((state) => state.verifyFix);
  const clearBaseline = useCompareStore((state) => state.clearFixBaseline);

  const targetSource = fixBaseline ?? currentComparison;
  const candidates = listFixRegionIds(targetSource);
  const selectedCandidate = candidates.includes(selectedTargetId ?? "")
    ? (selectedTargetId ?? "")
    : (candidates[0] ?? "");
  const currentAfter =
    fixBaseline && currentComparison?.runId !== fixBaseline.runId ? currentComparison : null;

  return (
    <section className="space-y-3" aria-labelledby="fix-verification-title">
      <div>
        <h3 id="fix-verification-title" className="font-semibold text-sm">
          {t("compare.fixTitle")}
        </h3>
        <p className="mt-1 text-xs" style={{ color: "var(--muted-fg)" }}>
          {t("compare.fixTemporaryNotice")}
        </p>
      </div>

      {!fixBaseline ? (
        <div
          className="space-y-3 rounded-[var(--radius-token)] p-3"
          style={{ background: "var(--surface-2)" }}
        >
          <FixTargetLoader isComparing={isComparing} />
          <label className="block space-y-1 text-xs" style={{ color: "var(--muted-fg)" }}>
            <span>{t("compare.fixRegionSelection")}</span>
            <select
              aria-label={t("compare.fixRegionSelection")}
              className="w-full rounded-[var(--radius-sm-token)] bg-[var(--bg)] px-3 py-2 text-[var(--fg)]"
              value={selectedCandidate}
              disabled={candidates.length === 0 || isComparing}
              onChange={(event) => setSelectedTargetId(event.target.value)}
            >
              {candidates.length === 0 ? (
                <option value="">{t("compare.fixNoMeasuredRegion")}</option>
              ) : (
                candidates.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {t("compare.fixRegionOption", { id: candidate })}
                  </option>
                ))
              )}
            </select>
          </label>
          <button
            type="button"
            className="fd-btn primary w-full"
            disabled={
              !currentComparison?.result.diffReport || candidates.length === 0 || isComparing
            }
            onClick={() => {
              if (selectedCandidate) setSelectedTargetId(selectedCandidate);
              pinBaseline();
            }}
          >
            {t("compare.fixPinBaseline")}
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2" data-testid="fix-comparison-pair">
            <ComparisonSnapshotCard
              title={t("compare.fixBefore")}
              comparisonId={fixBaseline.result.comparisonId}
              matchRate={fixBaseline.result.matchRate}
              image={fixBaseline.result.diffImageBase64}
            />
            {currentAfter ? (
              <ComparisonSnapshotCard
                title={t("compare.fixAfter")}
                comparisonId={currentAfter.result.comparisonId}
                matchRate={currentAfter.result.matchRate}
                image={currentAfter.result.diffImageBase64}
              />
            ) : (
              <div
                className="rounded-[var(--radius-sm-token)] p-3 text-xs"
                style={{ background: "var(--surface-2)", color: "var(--muted-fg)" }}
              >
                <p className="font-semibold">{t("compare.fixAfter")}</p>
                <p className="mt-2">{t("compare.fixRunAfter")}</p>
              </div>
            )}
          </div>

          <p className="text-xs" style={{ color: "var(--muted-fg)" }}>
            {t("compare.fixSelectedRegion", { id: selectedTargetId })}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="fd-btn primary flex-1"
              disabled={!currentAfter || isComparing}
              onClick={verifyFix}
            >
              {t("compare.fixVerify")}
            </button>
            <button type="button" className="fd-btn" disabled={isComparing} onClick={clearBaseline}>
              {t("compare.fixClearBaseline")}
            </button>
          </div>
        </>
      )}

      {fixError ? (
        <p role="alert" className="text-sm" style={{ color: "var(--diff)" }}>
          {t(fixError)}
        </p>
      ) : null}
      {currentComparison?.targetRegion ? (
        <TargetMeasurement measurement={currentComparison.targetRegion} />
      ) : null}
      {fixVerification ? <VerificationResult result={fixVerification} /> : null}
    </section>
  );
}

function FixTargetLoader({ isComparing }: { isComparing: boolean }) {
  const { t } = useTranslation();
  const fixTarget = useCompareStore((state) => state.fixTarget);
  const isLoading = useCompareStore((state) => state.isLoadingFixTarget);
  const load = useCompareStore((state) => state.loadFixTarget);
  const clear = useCompareStore((state) => state.clearFixTarget);
  const [nodeId, setNodeId] = useState("");
  const disabled = isLoading || isComparing;

  return (
    <div className="space-y-2 border-[var(--border)] border-b pb-3">
      <label className="block space-y-1 text-xs" style={{ color: "var(--muted-fg)" }}>
        <span>{t("compare.fixNodeId")}</span>
        <input
          aria-label={t("compare.fixNodeId")}
          className="w-full rounded-[var(--radius-sm-token)] bg-[var(--bg)] px-3 py-2 text-[var(--fg)]"
          value={nodeId}
          disabled={disabled}
          placeholder={t("compare.fixNodePlaceholder")}
          onChange={(event) => setNodeId(event.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="fd-btn primary min-w-0 flex-1"
          disabled={!nodeId.trim() || disabled}
          onClick={() => load(nodeId)}
        >
          {isLoading ? t("compare.fixNodeLoading") : t("compare.fixNodeLoad")}
        </button>
        {fixTarget ? (
          <button type="button" className="fd-btn" disabled={disabled} onClick={clear}>
            {t("compare.fixNodeClear")}
          </button>
        ) : null}
      </div>
      {fixTarget ? (
        <div className="space-y-1 text-xs" data-testid="fix-target-source">
          <p>
            {t("compare.fixNodeConfigured", {
              name: fixTarget.targetNodeName,
              id: fixTarget.targetNodeId,
            })}
          </p>
          <p className="mono break-all" style={{ color: "var(--muted-fg)" }}>
            {t("compare.fixNodeVersion", { version: fixTarget.sourceVersion })}
          </p>
          <p style={{ color: "var(--muted-fg)" }}>{t("compare.fixNodeRunComparison")}</p>
        </div>
      ) : (
        <p className="text-xs" style={{ color: "var(--muted-fg)" }}>
          {t("compare.fixNodeHint")}
        </p>
      )}
    </div>
  );
}

function TargetMeasurement({ measurement }: { measurement: FixTargetRegionMeasurement }) {
  const { t } = useTranslation();
  if (measurement.status === "unmeasured") {
    return (
      <p role="status" className="text-xs" style={{ color: "var(--warn)" }}>
        {t(`compare.fixTargetMeasurement.${measurement.reason}`)}
      </p>
    );
  }
  return (
    <p role="status" className="text-xs" style={{ color: "var(--muted-fg)" }}>
      {t("compare.fixTargetMeasured", {
        name: measurement.nodeName,
        evaluated: measurement.evaluatedPixelCount,
        total: measurement.totalPixelCount,
      })}
    </p>
  );
}

function ComparisonSnapshotCard({
  title,
  comparisonId,
  matchRate,
  image,
}: {
  title: string;
  comparisonId: string;
  matchRate: number;
  image: string;
}) {
  return (
    <div
      className="min-w-0 rounded-[var(--radius-sm-token)] p-2"
      style={{ background: "var(--surface-2)" }}
    >
      <p className="font-semibold text-xs">{title}</p>
      <img
        className="mt-2 aspect-video w-full rounded object-contain"
        src={`data:image/png;base64,${image}`}
        alt={title}
      />
      <p className="mono mt-2 truncate text-xs" title={comparisonId}>
        {comparisonId}
      </p>
      <p className="mono text-xs">{matchRate.toFixed(2)}%</p>
    </div>
  );
}

function VerificationResult({ result }: { result: DesktopFixVerification }) {
  const { t } = useTranslation();
  if (result.status === "matched") {
    return (
      <div
        className="space-y-2 rounded-[var(--radius-token)] p-3"
        style={{ background: "var(--surface-2)" }}
        data-testid="fix-verification-result"
      >
        <div className="grid grid-cols-2 gap-2 text-xs">
          <p>
            {t("compare.fixLocalVerdict")}: <strong>{result.localVerdict.toUpperCase()}</strong>
          </p>
          <p>
            {t("compare.fixOverallVerdict")}:{" "}
            <strong>{result.currentAggregateVerdict.toUpperCase()}</strong>
          </p>
        </div>
        <dl className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <dt>STRUCT</dt>
            <dd className="mono">{formatDelta(result.structureDelta)}</dd>
          </div>
          <div>
            <dt>COLOR</dt>
            <dd className="mono">{formatDelta(result.colorDelta)}</dd>
          </div>
          <div>
            <dt>SHAPE</dt>
            <dd className="mono">{formatDelta(result.shapeDelta)}</dd>
          </div>
        </dl>
        <div>
          <p className="font-semibold text-xs">{t("compare.fixSideEffects")}</p>
          {result.sideEffects.length === 0 ? (
            <p className="mt-1 text-xs" style={{ color: "var(--muted-fg)" }}>
              {t("compare.fixSideEffectsEmpty")}
            </p>
          ) : (
            <ul className="mt-1 space-y-1 text-xs">
              {result.sideEffects.map((effect) => (
                <li key={effect.nodeId} className="mono">
                  {effect.nodeId}: {formatDelta(effect.delta)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  const detail =
    result.status === "conditions-mismatch"
      ? result.differences.join(", ")
      : result.status === "missing"
        ? result.availableRegionIds.join(", ") || t("compare.fixNone")
        : result.status === "ambiguous"
          ? result.candidateRegionIds.join(", ")
          : result.status === "target-unmeasured"
            ? `${result.which}: ${result.reason}`
            : result.which;
  return (
    <div
      role="alert"
      className="rounded-[var(--radius-token)] p-3 text-sm"
      style={{ background: "var(--warn-soft)", color: "var(--warn)" }}
    >
      <p>{t(`compare.fixStatus.${result.status}`)}</p>
      <p className="mono mt-1 break-words text-xs">{detail}</p>
    </div>
  );
}

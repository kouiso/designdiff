import { useRef, useState } from "react";

import { Braces, RefreshCw, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { DesignToken, NodeInspection } from "@figdiff/shared";

import { Spinner } from "@/component/ui/spinner";
import { getPlatform } from "@/lib/platform";

export interface InspectionCandidate {
  nodeId: string;
  nodeName: string;
}

interface NodeInspectionPanelProps {
  fileKey: string | null;
  candidates: InspectionCandidate[];
}

interface InspectionResult {
  detail: NodeInspection;
  tokens: DesignToken[];
}

export function NodeInspectionPanel({ fileKey, candidates }: NodeInspectionPanelProps) {
  const { t } = useTranslation();
  const [selection, setSelection] = useState({ fileKey, nodeId: candidates[0]?.nodeId ?? "" });
  const [result, setResult] = useState<InspectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const requestId = useRef(0);
  const currentFileKey = useRef(fileKey);
  currentFileKey.current = fileKey;

  const nodeId = selection.fileKey === fileKey ? selection.nodeId : (candidates[0]?.nodeId ?? "");

  const changeNode = (nextNodeId: string) => {
    requestId.current += 1;
    setSelection({ fileKey, nodeId: nextNodeId });
    setResult(null);
    setError(null);
    setIsLoading(false);
  };

  const inspectNode = async () => {
    const requestedFileKey = fileKey;
    const requestedNodeId = nodeId.trim();
    if (!requestedFileKey || !requestedNodeId) return;

    const currentRequestId = requestId.current + 1;
    requestId.current = currentRequestId;
    setIsLoading(true);
    setResult(null);
    setError(null);

    try {
      const platform = await getPlatform();
      const [detail, tokens] = await Promise.all([
        platform.figma.getNodeDetail(requestedFileKey, requestedNodeId, 3),
        platform.figma.getDesignTokens(requestedFileKey, requestedNodeId, 2),
      ]);
      if (requestId.current !== currentRequestId || currentFileKey.current !== requestedFileKey)
        return;
      setResult({ detail, tokens });
    } catch (reason) {
      if (requestId.current !== currentRequestId || currentFileKey.current !== requestedFileKey)
        return;
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (requestId.current === currentRequestId && currentFileKey.current === requestedFileKey) {
        setIsLoading(false);
      }
    }
  };

  if (!fileKey) {
    return (
      <p className="rounded-[var(--radius-token)] bg-[var(--surface-2)] p-4 text-[var(--muted-fg)] text-sm">
        {t("compare.inspectRequiresFigma")}
      </p>
    );
  }

  return (
    <section className="space-y-3" aria-labelledby="node-inspection-title">
      <div>
        <h3 id="node-inspection-title" className="font-semibold text-sm">
          {t("compare.inspectTitle")}
        </h3>
        <p className="mt-1 text-[var(--muted-fg)] text-xs">{t("compare.inspectHint")}</p>
      </div>

      {candidates.length > 0 ? (
        <label className="block space-y-1 text-[var(--muted-fg)] text-xs">
          <span>{t("compare.inspectCandidate")}</span>
          <select
            className="w-full rounded-[var(--radius-sm-token)] bg-[var(--bg)] px-3 py-2 text-[var(--fg)] text-sm"
            style={{ border: "1px solid var(--border-strong)" }}
            value={candidates.some((candidate) => candidate.nodeId === nodeId) ? nodeId : ""}
            onChange={(event) => changeNode(event.target.value)}
          >
            <option value="">{t("compare.inspectManual")}</option>
            {candidates.map((candidate) => (
              <option key={candidate.nodeId} value={candidate.nodeId}>
                {candidate.nodeName} · {candidate.nodeId}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="flex gap-2">
        <label className="min-w-0 flex-1 space-y-1 text-[var(--muted-fg)] text-xs">
          <span>{t("compare.inspectNodeId")}</span>
          <input
            value={nodeId}
            onChange={(event) => changeNode(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") inspectNode();
            }}
            className="mono w-full rounded-[var(--radius-sm-token)] bg-[var(--bg)] px-3 py-2 text-[var(--fg)] text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--cobalt)]"
            style={{ border: "1px solid var(--border-strong)" }}
          />
        </label>
        <button
          type="button"
          className="fd-btn primary self-end"
          onClick={inspectNode}
          disabled={!nodeId.trim() || isLoading}
        >
          {isLoading ? <Spinner size="sm" label={t("common.loading")} /> : <Search size={15} />}
          {t("compare.inspectAction")}
        </button>
      </div>

      {isLoading ? (
        <div
          className="flex items-center gap-2 rounded-[var(--radius-token)] bg-[var(--surface-2)] p-4 text-sm"
          aria-live="polite"
        >
          <Spinner size="sm" label={t("common.loading")} />
          {t("compare.inspectLoading")}
        </div>
      ) : null}

      {error ? (
        <div
          className="rounded-[var(--radius-token)] bg-[var(--diff-soft)] p-4 text-[var(--diff)] text-sm"
          role="alert"
        >
          <p>{t("compare.inspectFailed")}</p>
          <p className="mt-1 break-words text-xs">{error}</p>
          <button type="button" className="fd-btn ghost mt-3" onClick={inspectNode}>
            <RefreshCw size={14} />
            {t("compare.inspectRetry")}
          </button>
        </div>
      ) : null}

      {result ? (
        <div className="space-y-3" data-testid="node-inspection-result">
          <div className="rounded-[var(--radius-token)] bg-[var(--surface-2)] p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-semibold text-sm">{result.detail.nodeName}</p>
                <p className="mono mt-1 text-[var(--muted-fg)] text-xs">
                  {result.detail.nodeType} · {result.detail.nodeId}
                </p>
              </div>
              <span className="fd-pill">
                {t("compare.inspectTokenCount", { count: result.tokens.length })}
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div>
                <dt className="text-[var(--muted-fg)]">{t("compare.inspectPosition")}</dt>
                <dd className="mono">
                  {result.detail.layout.x}, {result.detail.layout.y}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--muted-fg)]">{t("compare.inspectSize")}</dt>
                <dd className="mono">
                  {result.detail.layout.width} × {result.detail.layout.height}
                </dd>
              </div>
            </dl>
          </div>

          {result.tokens.length > 0 ? (
            <div
              className="scroll max-h-64 overflow-auto rounded-[var(--radius-token)]"
              style={{ border: "1px solid var(--border)" }}
            >
              <table className="w-full text-left text-xs">
                <caption className="sr-only">{t("compare.inspectTokens")}</caption>
                <thead className="sticky top-0 bg-[var(--surface-2)] text-[var(--muted-fg)]">
                  <tr>
                    <th className="px-3 py-2">{t("compare.inspectProperty")}</th>
                    <th className="px-3 py-2">{t("compare.inspectValue")}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.tokens.map((token) => (
                    <tr
                      key={`${token.nodeId}-${token.property}-${token.value}-${token.unit ?? ""}`}
                      style={{ borderTop: "1px solid var(--border)" }}
                    >
                      <td className="px-3 py-2">
                        <span className="mono">{token.property}</span>
                        <span className="block truncate text-[var(--faint-fg)]">
                          {token.nodeName}
                        </span>
                      </td>
                      <td className="mono px-3 py-2">
                        {token.value}
                        {token.unit ?? ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="rounded-[var(--radius-token)] bg-[var(--surface-2)] p-4 text-[var(--muted-fg)] text-sm">
              {t("compare.inspectTokensEmpty")}
            </p>
          )}

          <details className="rounded-[var(--radius-token)] bg-[var(--surface-2)] p-3">
            <summary className="flex cursor-pointer items-center gap-2 font-semibold text-sm">
              <Braces size={15} />
              {t("compare.inspectCss")}
            </summary>
            <pre className="scroll mt-3 overflow-auto whitespace-pre-wrap text-[var(--muted-fg)] text-xs">
              {result.detail.cssSuggestion}
            </pre>
          </details>
        </div>
      ) : null}
    </section>
  );
}

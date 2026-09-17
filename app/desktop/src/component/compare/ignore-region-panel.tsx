import { useEffect, useRef, useState } from "react";

import { useTranslation } from "react-i18next";

import {
  classifyIgnoreRegionEntries,
  IgnoreRegionConfigEntrySchema,
  type IgnoreRegionConfigEntry,
} from "@figdiff/shared";

import { getPlatform } from "@/lib/platform";
import type { DesktopCompareResult } from "@/service/image-compare";
import { useCompareStore } from "@/store/compare-store";

interface IgnoreRegionPanelProps {
  projectId: string | null;
  frameName: string | null;
  compareResult: DesktopCompareResult | null;
}

const EMPTY_FORM = { id: "", label: "", x: "", y: "", width: "", height: "" };

export function IgnoreRegionPanel({ projectId, frameName, compareResult }: IgnoreRegionPanelProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<IgnoreRegionConfigEntry[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scopeKey = JSON.stringify([projectId, frameName]);
  const currentScopeRef = useRef(scopeKey);
  const mutationIdRef = useRef(0);
  currentScopeRef.current = scopeKey;
  const setIgnoreRegionEntries = useCompareStore((state) => state.setIgnoreRegionEntries);
  const runComparison = useCompareStore((state) => state.runComparison);
  const lastComparisonGeometry = useCompareStore((state) => state.lastComparisonGeometry);
  const comparisonGeometry = compareResult?.comparisonGeometry ?? lastComparisonGeometry;
  const classification = classifyIgnoreRegionEntries(entries, comparisonGeometry ?? undefined);
  const incompatibleIds = new Set(classification.incompatible.map((entry) => entry.id));

  useEffect(() => {
    mutationIdRef.current += 1;
    setBusy(false);
    let active = true;
    setEntries([]);
    setIgnoreRegionEntries([]);
    setError(null);
    if (!projectId)
      return () => {
        active = false;
      };
    getPlatform()
      .then((platform) => {
        if (!platform.ignoreRegion) throw new Error(t("ignoreRegion.desktopOnly"));
        return platform.ignoreRegion.list(projectId, frameName ?? undefined);
      })
      .then((loaded) => {
        if (!active) return;
        setEntries(loaded);
        setIgnoreRegionEntries(loaded);
      })
      .catch((reason: unknown) => {
        if (active) setError(String(reason));
      });
    return () => {
      active = false;
      mutationIdRef.current += 1;
    };
  }, [frameName, projectId, setIgnoreRegionEntries, t]);

  const saveAndCompare = async () => {
    if (!projectId || !compareResult) return;
    const mutationId = ++mutationIdRef.current;
    const mutationScope = scopeKey;
    const isCurrent = () =>
      mutationIdRef.current === mutationId && currentScopeRef.current === mutationScope;
    setBusy(true);
    setError(null);
    try {
      const platform = await getPlatform();
      if (!platform.ignoreRegion) throw new Error(t("ignoreRegion.desktopOnly"));
      const entry = IgnoreRegionConfigEntrySchema.parse({
        id: form.id.trim(),
        label: form.label.trim() || undefined,
        frame_name: frameName ?? undefined,
        x: Number(form.x),
        y: Number(form.y),
        width: Number(form.width),
        height: Number(form.height),
        coordinate_context: compareResult.comparisonGeometry,
      });
      await platform.ignoreRegion.save(projectId, entry);
      if (!isCurrent()) return;
      const scoped = await platform.ignoreRegion.list(projectId, frameName ?? undefined);
      if (!isCurrent()) return;
      setEntries(scoped);
      setIgnoreRegionEntries(scoped);
      setForm(EMPTY_FORM);
      await runComparison();
    } catch (reason) {
      if (isCurrent()) setError(String(reason));
    } finally {
      if (isCurrent()) setBusy(false);
    }
  };

  const remove = async (regionId: string) => {
    if (!projectId) return;
    const mutationId = ++mutationIdRef.current;
    const mutationScope = scopeKey;
    const isCurrent = () =>
      mutationIdRef.current === mutationId && currentScopeRef.current === mutationScope;
    setBusy(true);
    setError(null);
    try {
      const platform = await getPlatform();
      if (!platform.ignoreRegion) throw new Error(t("ignoreRegion.desktopOnly"));
      await platform.ignoreRegion.delete(projectId, regionId);
      if (!isCurrent()) return;
      const remaining = entries.filter((entry) => entry.id !== regionId);
      setEntries(remaining);
      setIgnoreRegionEntries(remaining);
      await runComparison();
    } catch (reason) {
      if (isCurrent()) setError(String(reason));
    } finally {
      if (isCurrent()) setBusy(false);
    }
  };

  if (!projectId)
    return (
      <p className="text-sm" style={{ color: "var(--muted-fg)" }}>
        {t("ignoreRegion.projectRequired")}
      </p>
    );

  return (
    <div className="space-y-3">
      {error ? (
        <p className="text-sm" style={{ color: "var(--diff)" }}>
          {error}
        </p>
      ) : null}
      <div className="space-y-2">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="rounded-[var(--radius-sm-token)] p-3"
            style={{ background: "var(--surface-2)" }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-sm">{entry.label ?? entry.id}</span>
              <button
                type="button"
                className="fd-btn"
                disabled={busy}
                onClick={async () => {
                  await remove(entry.id);
                }}
              >
                {t("ignoreRegion.delete")}
              </button>
            </div>
            <p className="mono mt-1 text-xs" style={{ color: "var(--muted-fg)" }}>
              x:{entry.x} y:{entry.y} w:{entry.width} h:{entry.height}
            </p>
            <p
              className="mt-1 text-xs"
              style={{
                color:
                  !entry.coordinate_context || !comparisonGeometry
                    ? "var(--warn)"
                    : incompatibleIds.has(entry.id)
                      ? "var(--diff)"
                      : "var(--match)",
              }}
            >
              {!entry.coordinate_context
                ? t("ignoreRegion.legacy")
                : !comparisonGeometry
                  ? t("ignoreRegion.unverified")
                  : incompatibleIds.has(entry.id)
                    ? t("ignoreRegion.incompatible")
                    : t("ignoreRegion.bound")}
            </p>
          </div>
        ))}
      </div>
      <fieldset className="grid grid-cols-2 gap-2" disabled={busy || !compareResult}>
        {(["id", "label", "x", "y", "width", "height"] as const).map((field) => (
          <label key={field} className="text-xs" style={{ color: "var(--muted-fg)" }}>
            {field}
            <input
              className="mt-1 w-full rounded-[var(--radius-sm-token)] border bg-transparent px-2 py-1.5 outline-none focus-visible:ring-2"
              type={["x", "y", "width", "height"].includes(field) ? "number" : "text"}
              min={field === "x" || field === "y" ? 0 : 1}
              value={form[field]}
              onChange={(event) =>
                setForm((current) => ({ ...current, [field]: event.target.value }))
              }
            />
          </label>
        ))}
      </fieldset>
      <button
        type="button"
        className="fd-btn primary w-full"
        disabled={busy || !compareResult}
        onClick={async () => {
          await saveAndCompare();
        }}
      >
        {t("ignoreRegion.saveAndCompare")}
      </button>
      {!compareResult ? (
        <p className="text-xs" style={{ color: "var(--warn)" }}>
          {t("ignoreRegion.compareRequired")}
        </p>
      ) : null}
    </div>
  );
}

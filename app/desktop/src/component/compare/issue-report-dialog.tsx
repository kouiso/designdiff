import { useCallback, useEffect, useRef, useState } from "react";

import { ExternalLink, Send } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/component/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/component/ui/dialog";
import { Input } from "@/component/ui/input";
import { Label } from "@/component/ui/label";
import {
  getIssueReporter,
  type IssueReportAdapter,
  type IssueReportInput,
  type IssueReportPreview,
  type IssueReportSubmitResult,
} from "@/lib/platform";

type PendingAction = "prepare" | "submit" | null;

interface IssueReportDialogProps {
  open: boolean;
  scopeKey: string;
  onOpenChange: (open: boolean) => void;
}

const EMPTY_INPUT: IssueReportInput = { title: "", body: "" };

const parseCategory = (value: string): IssueReportInput["category"] => {
  if (value === "bug" || value === "usability" || value === "enhancement" || value === "docs") {
    return value;
  }
  return undefined;
};

export function IssueReportDialog({ open, scopeKey, onOpenChange }: IssueReportDialogProps) {
  const { t } = useTranslation();
  const [input, setInput] = useState<IssueReportInput>(EMPTY_INPUT);
  const [preview, setPreview] = useState<IssueReportPreview | null>(null);
  const [submitted, setSubmitted] = useState<IssueReportSubmitResult | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [error, setError] = useState<string | null>(null);
  const operationRef = useRef(0);
  const pendingRef = useRef(false);
  const previewRef = useRef<IssueReportPreview | null>(null);
  const reporterRef = useRef<IssueReportAdapter | null>(null);
  const mountedRef = useRef(true);
  const previousScopeRef = useRef(scopeKey);

  const discard = useCallback(
    async (draftId: string, errorOperation?: number) => {
      try {
        const reporter = reporterRef.current ?? (await getIssueReporter());
        if (!reporter) throw new Error(t("issueReport.unavailable"));
        reporterRef.current = reporter;
        await reporter.discard(draftId);
      } catch (reason) {
        if (mountedRef.current && operationRef.current === errorOperation) {
          setError(t("issueReport.discardFailed", { error: String(reason) }));
        }
      }
    },
    [t],
  );

  const invalidatePreview = useCallback(
    (clearForm: boolean, reportDiscardError = false) => {
      const operation = ++operationRef.current;
      pendingRef.current = false;
      setPending(null);
      const stalePreview = previewRef.current;
      previewRef.current = null;
      setPreview(null);
      setSubmitted(null);
      setError(null);
      if (clearForm) setInput(EMPTY_INPUT);
      if (stalePreview) {
        discard(stalePreview.draftId, reportDiscardError ? operation : undefined);
      }
    },
    [discard],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      operationRef.current += 1;
      const stalePreview = previewRef.current;
      previewRef.current = null;
      if (stalePreview) discard(stalePreview.draftId);
    };
  }, [discard]);

  useEffect(() => {
    if (previousScopeRef.current === scopeKey) return;
    previousScopeRef.current = scopeKey;
    invalidatePreview(false);
  }, [invalidatePreview, scopeKey]);

  const updateInput = (next: IssueReportInput) => {
    if (previewRef.current) invalidatePreview(false);
    setInput(next);
    setError(null);
  };

  const prepare = async () => {
    if (pendingRef.current) return;
    const candidate = {
      title: input.title.trim(),
      body: input.body.trim(),
      ...(input.category ? { category: input.category } : {}),
    };
    if (!candidate.title || !candidate.body) {
      setError(t("issueReport.required"));
      return;
    }
    const operation = ++operationRef.current;
    pendingRef.current = true;
    setPending("prepare");
    setError(null);
    try {
      const reporter = await getIssueReporter();
      if (!reporter) throw new Error(t("issueReport.unavailable"));
      reporterRef.current = reporter;
      const prepared = await reporter.prepare(candidate);
      if (!mountedRef.current || operation !== operationRef.current) {
        await reporter.discard(prepared.draftId);
        return;
      }
      previewRef.current = prepared;
      setPreview(prepared);
    } catch (reason) {
      if (mountedRef.current && operation === operationRef.current) {
        setError(t("issueReport.prepareFailed", { error: String(reason) }));
      }
    } finally {
      if (mountedRef.current && operation === operationRef.current) {
        pendingRef.current = false;
        setPending(null);
      }
    }
  };

  const submit = async () => {
    const currentPreview = previewRef.current;
    if (!currentPreview || pendingRef.current) return;
    const operation = ++operationRef.current;
    pendingRef.current = true;
    // 送信開始後のdraftはmain側が消費する。閉じる操作から並行discardしない。
    previewRef.current = null;
    setPending("submit");
    setError(null);
    try {
      const reporter = reporterRef.current ?? (await getIssueReporter());
      if (!reporter) throw new Error(t("issueReport.unavailable"));
      reporterRef.current = reporter;
      const result = await reporter.submit(currentPreview.draftId);
      if (!mountedRef.current || operation !== operationRef.current) return;
      previewRef.current = null;
      setPreview(null);
      setSubmitted(result);
    } catch (reason) {
      if (mountedRef.current && operation === operationRef.current) {
        previewRef.current = currentPreview;
        setError(t("issueReport.submitFailed", { error: String(reason) }));
      } else {
        discard(currentPreview.draftId);
      }
    } finally {
      if (mountedRef.current && operation === operationRef.current) {
        pendingRef.current = false;
        setPending(null);
      }
    }
  };

  const close = () => {
    invalidatePreview(true);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && close()}>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Send className="h-5 w-5" />
          {t("issueReport.title")}
        </DialogTitle>
        <DialogDescription>{t("issueReport.description")}</DialogDescription>
      </DialogHeader>

      <div className="max-h-[65vh] space-y-4 overflow-y-auto py-4 pr-1">
        {submitted ? (
          <SubmittedIssue result={submitted} />
        ) : preview ? (
          <IssuePreview preview={preview} />
        ) : (
          <IssueInput input={input} disabled={pending !== null} onChange={updateInput} />
        )}

        {error ? (
          <p role="alert" className="text-sm" style={{ color: "var(--diff)" }}>
            {error}
          </p>
        ) : null}
      </div>

      <DialogFooter className="gap-2">
        {submitted ? (
          <Button type="button" onClick={close}>
            {t("common.close")}
          </Button>
        ) : preview ? (
          <>
            <Button
              type="button"
              variant="outline"
              disabled={pending !== null}
              onClick={() => invalidatePreview(false, true)}
            >
              {t("issueReport.edit")}
            </Button>
            <Button
              type="button"
              disabled={pending !== null}
              onClick={() => {
                submit();
              }}
            >
              {pending === "submit" ? t("issueReport.submitting") : t("issueReport.submit")}
            </Button>
          </>
        ) : (
          <>
            <Button type="button" variant="outline" disabled={pending !== null} onClick={close}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              disabled={pending !== null}
              onClick={() => {
                prepare();
              }}
            >
              {pending === "prepare" ? t("issueReport.preparing") : t("issueReport.review")}
            </Button>
          </>
        )}
      </DialogFooter>
    </Dialog>
  );
}

function IssueInput({
  input,
  disabled,
  onChange,
}: {
  input: IssueReportInput;
  disabled: boolean;
  onChange: (input: IssueReportInput) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="issue-report-category">{t("issueReport.category")}</Label>
        <select
          id="issue-report-category"
          className="w-full rounded border bg-transparent px-3 py-2 text-sm"
          value={input.category ?? ""}
          disabled={disabled}
          onChange={(event) =>
            onChange({
              ...input,
              category: parseCategory(event.target.value),
            })
          }
        >
          <option value="">{t("issueReport.categoryNone")}</option>
          <option value="bug">{t("issueReport.categoryBug")}</option>
          <option value="usability">{t("issueReport.categoryUsability")}</option>
          <option value="enhancement">{t("issueReport.categoryEnhancement")}</option>
          <option value="docs">{t("issueReport.categoryDocs")}</option>
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="issue-report-title">{t("issueReport.inputTitle")}</Label>
        <Input
          id="issue-report-title"
          value={input.title}
          disabled={disabled}
          onChange={(event) => onChange({ ...input, title: event.target.value })}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="issue-report-body">{t("issueReport.body")}</Label>
        <textarea
          id="issue-report-body"
          className="min-h-40 w-full rounded border bg-transparent px-3 py-2 text-sm"
          value={input.body}
          disabled={disabled}
          onChange={(event) => onChange({ ...input, body: event.target.value })}
        />
      </div>
      <p className="text-xs" style={{ color: "var(--muted-fg)" }}>
        {t("issueReport.noAutomaticAttachments")}
      </p>
    </div>
  );
}

function IssuePreview({ preview }: { preview: IssueReportPreview }) {
  const { t } = useTranslation();
  return (
    <section className="space-y-3" aria-label={t("issueReport.previewTitle")}>
      <div className="rounded p-3" style={{ background: "var(--surface-2)" }}>
        <p className="text-xs" style={{ color: "var(--muted-fg)" }}>
          {preview.repository.owner}/{preview.repository.repo}
        </p>
        <h3 className="mt-1 font-semibold text-sm">{preview.title}</h3>
        <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm">{preview.body}</pre>
      </div>
      <p className="text-xs">
        {t("issueReport.labels")}: {preview.labels.join(", ") || t("issueReport.none")}
      </p>
      <p className="text-xs">{t("issueReport.maskedCount", { count: preview.maskedCount })}</p>
      <p className="text-xs" style={{ color: "var(--muted-fg)" }}>
        {t("issueReport.exactPayloadNotice")}
      </p>
      {preview.duplicate.status === "found" ? (
        <div className="rounded p-3 text-sm" style={{ background: "var(--warn-soft)" }}>
          <p>{t("issueReport.duplicateFound", { number: preview.duplicate.issueNumber })}</p>
          <a
            className="mt-1 inline-flex items-center gap-1 underline"
            href={preview.duplicate.issueUrl}
            target="_blank"
            rel="noreferrer"
          >
            {t("issueReport.openExisting")}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      ) : (
        <p className="text-xs">{t("issueReport.noDuplicate")}</p>
      )}
    </section>
  );
}

function SubmittedIssue({ result }: { result: IssueReportSubmitResult }) {
  const { t } = useTranslation();
  return (
    <section className="rounded p-4" style={{ background: "var(--match-soft)" }}>
      <p className="font-semibold">
        {result.deduped
          ? t("issueReport.deduped", { number: result.issueNumber })
          : t("issueReport.submitted", { number: result.issueNumber })}
      </p>
      <a
        className="mt-2 inline-flex items-center gap-1 underline"
        href={result.issueUrl}
        target="_blank"
        rel="noreferrer"
      >
        {t("issueReport.openIssue", { number: result.issueNumber })}
        <ExternalLink className="h-4 w-4" />
      </a>
      <p className="mt-2 text-xs">{t("issueReport.maskedCount", { count: result.maskedCount })}</p>
    </section>
  );
}

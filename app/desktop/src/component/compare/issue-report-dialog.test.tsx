import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getIssueReporter } from "@/lib/platform";

import { IssueReportDialog } from "./issue-report-dialog";

vi.mock("@/lib/platform", () => ({ getIssueReporter: vi.fn() }));

const preview = (duplicate = false, draftId = "draft-1") => ({
  draftId,
  repository: { owner: "kouiso", repo: "designdiff" },
  title: "Sanitized title",
  body: "Sanitized body\nwithout private context",
  labels: ["bug", "desktop"],
  maskedCount: 2,
  duplicate: duplicate
    ? {
        status: "found" as const,
        issueNumber: 42,
        issueUrl: "https://github.test/kouiso/designdiff/issues/42",
      }
    : { status: "none" as const },
});

const deferred = <T,>() => {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
};

const fillReport = () => {
  fireEvent.change(screen.getByLabelText("種類"), { target: { value: "bug" } });
  fireEvent.change(screen.getByLabelText("タイトル"), { target: { value: "  Broken panel  " } });
  fireEvent.change(screen.getByLabelText("内容"), { target: { value: "  Steps to reproduce  " } });
};

describe("IssueReportDialog", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("mainが返したexact payloadをreadonly表示して自動添付しない", async () => {
    const reporter = {
      prepare: vi.fn().mockResolvedValue(preview()),
      submit: vi.fn(),
      discard: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(getIssueReporter).mockResolvedValue(reporter);
    render(<IssueReportDialog open scopeKey="scope-a" onOpenChange={vi.fn()} />);

    expect(screen.getByText(/画像、比較結果、URL、ローカルパス/)).toBeInTheDocument();
    fillReport();
    const reviewButton = screen.getByRole("button", { name: "送信内容を確認" });
    fireEvent.click(reviewButton);
    fireEvent.click(reviewButton);

    expect(await screen.findByRole("heading", { name: "Sanitized title" })).toBeInTheDocument();
    expect(screen.getByText(/Sanitized body/)).toHaveTextContent(
      "Sanitized body without private context",
    );
    expect(screen.getByText("kouiso/designdiff")).toBeInTheDocument();
    expect(screen.getByText("ラベル: bug, desktop")).toBeInTheDocument();
    expect(screen.getByText("秘匿処理: 2件")).toBeInTheDocument();
    expect(screen.queryByLabelText("タイトル")).not.toBeInTheDocument();
    expect(reporter.prepare).toHaveBeenCalledWith({
      title: "Broken panel",
      body: "Steps to reproduce",
      category: "bug",
    });
    expect(reporter.prepare).toHaveBeenCalledTimes(1);
  });

  it("duplicateを明示し、編集へ戻るとdraftを破棄する", async () => {
    const reporter = {
      prepare: vi.fn().mockResolvedValue(preview(true)),
      submit: vi.fn(),
      discard: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(getIssueReporter).mockResolvedValue(reporter);
    render(<IssueReportDialog open scopeKey="scope-a" onOpenChange={vi.fn()} />);
    fillReport();
    fireEvent.click(screen.getByRole("button", { name: "送信内容を確認" }));

    expect(await screen.findByText(/同じ内容のIssue #42/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "既存Issueを確認" })).toHaveAttribute(
      "href",
      "https://github.test/kouiso/designdiff/issues/42",
    );
    fireEvent.click(screen.getByRole("button", { name: "編集に戻る" }));

    expect(screen.getByLabelText("タイトル")).toHaveValue("  Broken panel  ");
    await waitFor(() => expect(reporter.discard).toHaveBeenCalledWith("draft-1"));
  });

  it("旧draftの遅延discard失敗を新しいpreviewへ混入させない", async () => {
    let rejectDiscard: (reason: Error) => void = () => undefined;
    const discardPromise = new Promise<never>((_resolve, reject) => {
      rejectDiscard = reject;
    });
    const reporter = {
      prepare: vi
        .fn()
        .mockResolvedValueOnce(preview(false, "draft-old"))
        .mockResolvedValueOnce(preview(false, "draft-new")),
      submit: vi.fn(),
      discard: vi.fn().mockReturnValueOnce(discardPromise),
    };
    vi.mocked(getIssueReporter).mockResolvedValue(reporter);
    render(<IssueReportDialog open scopeKey="scope-a" onOpenChange={vi.fn()} />);
    fillReport();
    fireEvent.click(screen.getByRole("button", { name: "送信内容を確認" }));
    await screen.findByRole("heading", { name: "Sanitized title" });
    fireEvent.click(screen.getByRole("button", { name: "編集に戻る" }));
    fireEvent.click(screen.getByRole("button", { name: "送信内容を確認" }));
    await waitFor(() => expect(reporter.prepare).toHaveBeenCalledTimes(2));

    await act(async () => {
      rejectDiscard(new Error("old discard failed"));
      await discardPromise.catch(() => undefined);
    });

    expect(screen.getByRole("heading", { name: "Sanitized title" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("scope変更中に返ったprepare応答を表示せず、そのdraftを破棄する", async () => {
    const pending = deferred<ReturnType<typeof preview>>();
    const reporter = {
      prepare: vi.fn().mockReturnValue(pending.promise),
      submit: vi.fn(),
      discard: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(getIssueReporter).mockResolvedValue(reporter);
    const view = render(<IssueReportDialog open scopeKey="scope-a" onOpenChange={vi.fn()} />);
    fillReport();
    fireEvent.click(screen.getByRole("button", { name: "送信内容を確認" }));

    view.rerender(<IssueReportDialog open scopeKey="scope-b" onOpenChange={vi.fn()} />);
    await act(async () => {
      pending.resolve(preview());
      await pending.promise;
    });

    expect(screen.queryByRole("heading", { name: "Sanitized title" })).not.toBeInTheDocument();
    expect(reporter.discard).toHaveBeenCalledWith("draft-1");
  });

  it("送信中の二重操作を拒否し、mainのIssue番号とdedupe結果を表示する", async () => {
    const pending = deferred<{
      issueUrl: string;
      issueNumber: number;
      deduped: boolean;
      maskedCount: number;
    }>();
    const reporter = {
      prepare: vi.fn().mockResolvedValue(preview()),
      submit: vi.fn().mockReturnValue(pending.promise),
      discard: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(getIssueReporter).mockResolvedValue(reporter);
    render(<IssueReportDialog open scopeKey="scope-a" onOpenChange={vi.fn()} />);
    fillReport();
    fireEvent.click(screen.getByRole("button", { name: "送信内容を確認" }));
    const submitButton = await screen.findByRole("button", { name: "この内容を送信" });

    fireEvent.click(submitButton);
    fireEvent.click(submitButton);
    expect(reporter.submit).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve({
        issueUrl: "https://github.test/kouiso/designdiff/issues/42",
        issueNumber: 42,
        deduped: true,
        maskedCount: 2,
      });
      await pending.promise;
    });

    expect(screen.getByText("既存のIssue #42を使用しました。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Issue #42を開く" })).toHaveAttribute(
      "href",
      "https://github.test/kouiso/designdiff/issues/42",
    );
  });

  it("submit失敗を表示し、同じreview済みdraftを再送できる", async () => {
    const reporter = {
      prepare: vi.fn().mockResolvedValue(preview()),
      submit: vi
        .fn()
        .mockRejectedValueOnce(new Error("credentials missing"))
        .mockResolvedValueOnce({
          issueUrl: "https://github.test/kouiso/designdiff/issues/43",
          issueNumber: 43,
          deduped: false,
          maskedCount: 2,
        }),
      discard: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(getIssueReporter).mockResolvedValue(reporter);
    render(<IssueReportDialog open scopeKey="scope-a" onOpenChange={vi.fn()} />);
    fillReport();
    fireEvent.click(screen.getByRole("button", { name: "送信内容を確認" }));
    const submitButton = await screen.findByRole("button", { name: "この内容を送信" });

    fireEvent.click(submitButton);
    expect(await screen.findByRole("alert")).toHaveTextContent("credentials missing");
    fireEvent.click(screen.getByRole("button", { name: "この内容を送信" }));

    expect(await screen.findByText("Issue #43を作成しました。")).toBeInTheDocument();
    expect(reporter.submit).toHaveBeenNthCalledWith(1, "draft-1");
    expect(reporter.submit).toHaveBeenNthCalledWith(2, "draft-1");
  });

  it("closeでdraftを破棄し、prepare/setupエラーを可視化する", async () => {
    const onOpenChange = vi.fn();
    const reporter = {
      prepare: vi.fn().mockResolvedValueOnce(preview()),
      submit: vi.fn(),
      discard: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(getIssueReporter).mockResolvedValue(reporter);
    const view = render(<IssueReportDialog open scopeKey="scope-a" onOpenChange={onOpenChange} />);
    fillReport();
    fireEvent.click(screen.getByRole("button", { name: "送信内容を確認" }));
    await screen.findByRole("heading", { name: "Sanitized title" });
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    await waitFor(() => expect(reporter.discard).toHaveBeenCalledWith("draft-1"));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    view.rerender(
      <IssueReportDialog open={false} scopeKey="scope-a" onOpenChange={onOpenChange} />,
    );
    vi.mocked(getIssueReporter).mockResolvedValue(null);
    view.rerender(<IssueReportDialog open scopeKey="scope-a" onOpenChange={onOpenChange} />);
    fillReport();
    fireEvent.click(screen.getByRole("button", { name: "送信内容を確認" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "この環境ではアプリ内の問題報告を利用できません。",
    );
  });

  it("close後に返ったsubmit応答を再度開いたdialogへ混入させず送信中draftを破棄しない", async () => {
    const pending = deferred<{
      issueUrl: string;
      issueNumber: number;
      deduped: boolean;
      maskedCount: number;
    }>();
    const reporter = {
      prepare: vi.fn().mockResolvedValue(preview()),
      submit: vi.fn().mockReturnValue(pending.promise),
      discard: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(getIssueReporter).mockResolvedValue(reporter);
    const onOpenChange = vi.fn();
    const view = render(<IssueReportDialog open scopeKey="scope-a" onOpenChange={onOpenChange} />);
    fillReport();
    fireEvent.click(screen.getByRole("button", { name: "送信内容を確認" }));
    fireEvent.click(await screen.findByRole("button", { name: "この内容を送信" }));
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(reporter.discard).not.toHaveBeenCalled();
    view.rerender(
      <IssueReportDialog open={false} scopeKey="scope-a" onOpenChange={onOpenChange} />,
    );
    view.rerender(<IssueReportDialog open scopeKey="scope-a" onOpenChange={onOpenChange} />);

    await act(async () => {
      pending.resolve({
        issueUrl: "https://github.test/kouiso/designdiff/issues/99",
        issueNumber: 99,
        deduped: false,
        maskedCount: 0,
      });
      await pending.promise;
    });

    expect(screen.queryByText("Issue #99を作成しました。")).not.toBeInTheDocument();
    expect(screen.getByLabelText("タイトル")).toHaveValue("");
    expect(reporter.discard).not.toHaveBeenCalled();
  });

  it("close後にsubmitが失敗した場合はmainの送信終了後にdraftを破棄する", async () => {
    let rejectSubmit: (reason: Error) => void = () => undefined;
    const submitPromise = new Promise<never>((_resolve, reject) => {
      rejectSubmit = reject;
    });
    const reporter = {
      prepare: vi.fn().mockResolvedValue(preview()),
      submit: vi.fn().mockReturnValue(submitPromise),
      discard: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(getIssueReporter).mockResolvedValue(reporter);
    const view = render(<IssueReportDialog open scopeKey="scope-a" onOpenChange={vi.fn()} />);
    fillReport();
    fireEvent.click(screen.getByRole("button", { name: "送信内容を確認" }));
    fireEvent.click(await screen.findByRole("button", { name: "この内容を送信" }));
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(reporter.discard).not.toHaveBeenCalled();

    view.rerender(<IssueReportDialog open={false} scopeKey="scope-a" onOpenChange={vi.fn()} />);
    await act(async () => {
      rejectSubmit(new Error("network failed"));
      await submitPromise.catch(() => undefined);
    });

    await waitFor(() => expect(reporter.discard).toHaveBeenCalledWith("draft-1"));
  });
});

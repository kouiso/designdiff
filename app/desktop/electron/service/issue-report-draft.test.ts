import { describe, expect, it, vi } from "vitest";

import { createIssueReportDraftService } from "./issue-report-draft.js";

const repository = { owner: "kouiso", repo: "designdiff" };

function createClient() {
  return {
    searchOpenIssueByTitle: vi.fn().mockResolvedValue({ status: "none" }),
    createIssue: vi.fn().mockResolvedValue({
      number: 42,
      html_url: "https://attacker.invalid/not-canonical",
      deduped: false,
    }),
  };
}

describe("issue report draft service", () => {
  it("sanitizes and guards the immutable preview before storing it", async () => {
    const client = createClient();
    const service = createIssueReportDraftService({
      createClient: () => client,
      resolveRepository: () => repository,
      detectForeignNames: vi.fn().mockResolvedValue([]),
      createDraftId: () => "draft-1",
      now: () => 100,
    });

    const preview = await service.prepare({
      title: "Token ghp_secret123",
      body: "screenshot: /home/alice/private/result.png",
      category: "bug",
    });

    expect(preview).toEqual({
      draftId: "draft-1",
      repository,
      title: "[bug] Token [REDACTED]",
      body: "screenshot: ~/private/result.png",
      labels: ["desktop-feedback", "bug"],
      maskedCount: 2,
      duplicate: { status: "none" },
    });

    preview.title = "changed after review";
    preview.body = "changed after review";
    preview.labels.push("changed");

    await expect(service.submit("draft-1")).resolves.toEqual({
      issueUrl: "https://github.com/kouiso/designdiff/issues/42",
      issueNumber: 42,
      deduped: false,
      maskedCount: 2,
    });
    expect(client.createIssue).toHaveBeenCalledWith({
      owner: "kouiso",
      repo: "designdiff",
      title: "[bug] Token [REDACTED]",
      body: "screenshot: ~/private/result.png",
      labels: ["desktop-feedback", "bug"],
      requireDuplicateCheck: true,
    });
  });

  it("blocks foreign project identifiers before GitHub lookup", async () => {
    const client = createClient();
    const service = createIssueReportDraftService({
      createClient: () => client,
      resolveRepository: () => repository,
      detectForeignNames: vi.fn().mockResolvedValue(["private-client"]),
    });

    await expect(service.prepare({ title: "Problem", body: "private-client" })).rejects.toThrow(
      /private-client/,
    );
    expect(client.searchOpenIssueByTitle).not.toHaveBeenCalled();
  });

  it("rejects a title whose category prefix exceeds the final GitHub limit", async () => {
    const client = createClient();
    const service = createIssueReportDraftService({
      createClient: () => client,
      resolveRepository: () => repository,
      detectForeignNames: vi.fn().mockResolvedValue([]),
    });

    await expect(
      service.prepare({ title: "a".repeat(256), body: "Details", category: "enhancement" }),
    ).rejects.toThrow("exceeds 256 characters");
    expect(client.searchOpenIssueByTitle).not.toHaveBeenCalled();
  });

  it("fails closed when the prepare duplicate lookup is unavailable", async () => {
    const client = createClient();
    client.searchOpenIssueByTitle.mockResolvedValue({
      status: "unavailable",
      statusCode: 503,
      message: "service unavailable",
    });
    const service = createIssueReportDraftService({
      createClient: () => client,
      resolveRepository: () => repository,
      detectForeignNames: vi.fn().mockResolvedValue([]),
    });

    await expect(service.prepare({ title: "Problem", body: "Details" })).rejects.toThrow(
      "duplicate lookup failed",
    );
  });

  it("shows and rechecks duplicates, returning a canonical URL without posting", async () => {
    const client = createClient();
    client.searchOpenIssueByTitle.mockResolvedValue({
      status: "found",
      issue: { number: 17, html_url: "https://attacker.invalid/17" },
    });
    const service = createIssueReportDraftService({
      createClient: () => client,
      resolveRepository: () => repository,
      detectForeignNames: vi.fn().mockResolvedValue([]),
      createDraftId: () => "draft-duplicate",
    });

    const preview = await service.prepare({ title: "Problem", body: "Details" });
    expect(preview.duplicate).toEqual({
      status: "found",
      issueNumber: 17,
      issueUrl: "https://github.com/kouiso/designdiff/issues/17",
    });
    await expect(service.submit(preview.draftId)).resolves.toEqual({
      issueUrl: "https://github.com/kouiso/designdiff/issues/17",
      issueNumber: 17,
      deduped: true,
      maskedCount: 0,
    });
    expect(client.searchOpenIssueByTitle).toHaveBeenCalledTimes(2);
    expect(client.createIssue).not.toHaveBeenCalled();
    await expect(service.submit(preview.draftId)).rejects.toThrow(/not found or has expired/);
  });

  it("retains a draft after submission failure and permits an explicit retry", async () => {
    const client = createClient();
    client.createIssue.mockRejectedValueOnce(new Error("network failed"));
    const service = createIssueReportDraftService({
      createClient: () => client,
      resolveRepository: () => repository,
      detectForeignNames: vi.fn().mockResolvedValue([]),
      createDraftId: () => "draft-retry",
    });
    await service.prepare({ title: "Problem", body: "Details" });

    await expect(service.submit("draft-retry")).rejects.toThrow("network failed");
    await expect(service.submit("draft-retry")).resolves.toMatchObject({ issueNumber: 42 });
    expect(client.createIssue).toHaveBeenCalledTimes(2);
  });

  it("rejects concurrent submission of the same draft", async () => {
    let releaseLookup: (() => void) | undefined;
    const delayedLookup = new Promise<void>((resolve) => {
      releaseLookup = resolve;
    });
    const client = createClient();
    client.searchOpenIssueByTitle
      .mockResolvedValueOnce({ status: "none" })
      .mockImplementationOnce(async () => {
        await delayedLookup;
        return { status: "none" };
      });
    const service = createIssueReportDraftService({
      createClient: () => client,
      resolveRepository: () => repository,
      detectForeignNames: vi.fn().mockResolvedValue([]),
      createDraftId: () => "draft-inflight",
    });
    await service.prepare({ title: "Problem", body: "Details" });

    const first = service.submit("draft-inflight");
    await expect(service.submit("draft-inflight")).rejects.toThrow("already in progress");
    expect(() => service.discard("draft-inflight")).toThrow("during submission");
    releaseLookup?.();
    await expect(first).resolves.toMatchObject({ issueNumber: 42 });
  });

  it("retains the reviewed content when submit duplicate lookup is unavailable", async () => {
    const client = createClient();
    client.searchOpenIssueByTitle
      .mockResolvedValueOnce({ status: "none" })
      .mockResolvedValueOnce({
        status: "unavailable",
        reason: "http",
        statusCode: 503,
        message: "service unavailable",
      })
      .mockResolvedValue({ status: "none" });
    const service = createIssueReportDraftService({
      createClient: () => client,
      resolveRepository: () => repository,
      detectForeignNames: vi.fn().mockResolvedValue([]),
      createDraftId: () => "draft-lookup-retry",
    });
    await service.prepare({ title: "Problem", body: "Reviewed details" });

    await expect(service.submit("draft-lookup-retry")).rejects.toThrow("duplicate lookup failed");
    await expect(service.submit("draft-lookup-retry")).resolves.toMatchObject({ issueNumber: 42 });
    expect(client.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({ body: "Reviewed details", requireDuplicateCheck: true }),
    );
  });

  it("expires drafts and caps the number awaiting review", async () => {
    const client = createClient();
    let currentTime = 0;
    let sequence = 0;
    const service = createIssueReportDraftService({
      createClient: () => client,
      resolveRepository: () => repository,
      detectForeignNames: vi.fn().mockResolvedValue([]),
      createDraftId: () => `draft-${++sequence}`,
      now: () => currentTime,
      ttlMs: 10,
      maxDrafts: 1,
    });
    await service.prepare({ title: "First", body: "Details" });
    await expect(service.prepare({ title: "Second", body: "Details" })).rejects.toThrow("Too many");
    currentTime = 10;
    await expect(service.submit("draft-1")).rejects.toThrow(/not found or has expired/);
    await expect(service.prepare({ title: "Second", body: "Details" })).resolves.toMatchObject({
      draftId: "draft-2",
    });
  });

  it("keeps the draft bound when prepares overlap", async () => {
    let releaseLookup: (() => void) | undefined;
    const delayedLookup = new Promise<void>((resolve) => {
      releaseLookup = resolve;
    });
    const client = createClient();
    client.searchOpenIssueByTitle.mockImplementation(async () => {
      await delayedLookup;
      return { status: "none" };
    });
    let sequence = 0;
    const service = createIssueReportDraftService({
      createClient: () => client,
      resolveRepository: () => repository,
      detectForeignNames: vi.fn().mockResolvedValue([]),
      createDraftId: () => `draft-${++sequence}`,
      maxDrafts: 1,
    });

    const first = service.prepare({ title: "First", body: "Details" });
    const second = service.prepare({ title: "Second", body: "Details" });
    releaseLookup?.();

    const outcomes = await Promise.allSettled([first, second]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
  });

  it("discard removes a draft without contacting GitHub", async () => {
    const client = createClient();
    const service = createIssueReportDraftService({
      createClient: () => client,
      resolveRepository: () => repository,
      detectForeignNames: vi.fn().mockResolvedValue([]),
      createDraftId: () => "draft-discard",
    });
    await service.prepare({ title: "Problem", body: "Details" });
    service.discard("draft-discard");

    await expect(service.submit("draft-discard")).rejects.toThrow(/not found or has expired/);
    expect(client.createIssue).not.toHaveBeenCalled();
  });
});

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMcpServer } from "../server.js";

const {
  credentialStatus,
  createGithubService,
  resolveIssueRepo,
  detectForeignProjectNames,
  sanitizeForPublicIssue,
  readActiveSession,
} = vi.hoisted(() => ({
  credentialStatus: vi.fn(),
  createGithubService: vi.fn(),
  resolveIssueRepo: vi.fn(),
  detectForeignProjectNames: vi.fn(),
  sanitizeForPublicIssue: vi.fn((text: string) => ({ text, maskedCount: 0 })),
  readActiveSession: vi.fn(),
}));

vi.mock("../service/github-service.js", () => ({
  getGithubCredentialStatus: credentialStatus,
  createGithubService,
  resolveIssueRepo,
  sanitizeForPublicIssue,
  formatGithubCredentialError: () => "credential error",
  PRODUCT_SELF_NAMES: ["designdiff", "figdiff"],
}));
vi.mock("../service/cross-project-guard.js", () => ({
  detectForeignProjectNames,
  formatForeignProjectError: (names: string[]) => `他プロジェクト: ${names.join(", ")}`,
  PRODUCT_SELF_NAMES: ["designdiff", "figdiff"],
}));
vi.mock("../service/active-session.js", () => ({ readActiveSession }));

async function callReport(arguments_: Record<string, unknown>) {
  const server = createMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "report-issue-test", version: "1.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    return await client.callTool({ name: "report_issue", arguments: arguments_ });
  } finally {
    await client.close();
  }
}

describe("report_issue MCP handler", () => {
  beforeEach(() => {
    credentialStatus.mockReset();
    createGithubService.mockReset();
    resolveIssueRepo.mockReset();
    detectForeignProjectNames.mockReset();
    sanitizeForPublicIssue.mockReset();
    readActiveSession.mockReset();
    credentialStatus.mockReturnValue({ valid: true, token: "ghp_test" });
    resolveIssueRepo.mockReturnValue({ owner: "kouiso", repo: "designdiff" });
    detectForeignProjectNames.mockResolvedValue([]);
    sanitizeForPublicIssue.mockImplementation((text: string) => ({ text, maskedCount: 0 }));
    readActiveSession.mockResolvedValue({
      comparisonId: "cmp-context",
      sourceKey: "local:fixture",
      designSource: "https://figma.com/design/secretkey/frame",
      matchRate: 91,
      status: "FAIL",
      updatedAt: 1,
    });
    createGithubService.mockReturnValue({
      createIssue: vi.fn().mockResolvedValue({
        number: 42,
        html_url: "https://github.com/kouiso/designdiff/issues/42",
        deduped: false,
      }),
    });
  });

  it("rejects missing credentials before any GitHub request", async () => {
    credentialStatus.mockReturnValue({ valid: false, issue: "missing" });
    const response = await callReport({ title: "Bug", body: "Details" });
    expect(response.isError).toBe(true);
    expect(createGithubService).not.toHaveBeenCalled();
    expect(String((response.content[0] as { text?: string }).text)).toContain("credential error");
  });

  it("blocks foreign project names after sanitization", async () => {
    detectForeignProjectNames.mockResolvedValue(["other-product"]);
    const service = createGithubService();
    const response = await callReport({ title: "Bug", body: "Other product leaked" });
    expect(response.isError).toBe(true);
    expect(service.createIssue).not.toHaveBeenCalled();
    expect(String((response.content[0] as { text?: string }).text)).toContain("他プロジェクト");
  });

  it("sends category, comparison context, and sanitized design source", async () => {
    sanitizeForPublicIssue.mockImplementation((text: string, includeSource = false) => ({
      text: includeSource
        ? text.replace("secretkey", "*****tkey")
        : text.replace("secretkey", "[REDACTED]"),
      maskedCount: 1,
    }));
    const service = createGithubService();
    const response = await callReport({
      title: "Layout issue",
      body: "Screenshot /Users/alice/shot.png",
      category: "bug",
      comparison_id: "cmp-123",
      include_context: true,
      include_design_source: true,
    });
    expect(response.isError).toBeFalsy();
    expect(service.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "[bug] Layout issue",
        labels: ["mcp-feedback", "bug"],
        body: expect.stringContaining("cmp-123"),
      }),
    );
    expect(response.structuredContent).toMatchObject({ issueNumber: 42, maskedCount: 2 });
  });

  it("preserves dedupe result and handles GitHub failures", async () => {
    const service = createGithubService();
    service.createIssue.mockResolvedValueOnce({
      number: 7,
      html_url: "https://github.com/kouiso/designdiff/issues/7",
      deduped: true,
    });
    const deduped = await callReport({ title: "Existing", body: "Body", include_context: false });
    expect(deduped.structuredContent).toMatchObject({ issueNumber: 7, deduped: true });

    service.createIssue.mockRejectedValueOnce(new Error("network failure"));
    const failed = await callReport({ title: "Failure", body: "Body", include_context: false });
    expect(failed.isError).toBe(true);
    expect(String((failed.content[0] as { text?: string }).text)).toContain("network failure");
  });

  it("omits the context footer when no active session exists", async () => {
    readActiveSession.mockResolvedValue(null);
    const service = createGithubService();
    const response = await callReport({ title: "No session", body: "Body" });
    expect(response.isError).toBeFalsy();
    expect(service.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.not.stringContaining("comparisonId") }),
    );
  });

  it("formats non-Error GitHub failures without losing the failure result", async () => {
    const service = createGithubService();
    service.createIssue.mockRejectedValueOnce("upstream unavailable");
    const response = await callReport({ title: "Failure", body: "Body", include_context: false });
    expect(response.isError).toBe(true);
    expect(String((response.content[0] as { text?: string }).text)).toContain(
      "upstream unavailable",
    );
  });
});

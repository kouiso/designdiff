import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getGithubCredentialStatus, GithubService, resolveIssueRepo } from "./github-service.js";

describe("getGithubCredentialStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns missing when GITHUB_TOKEN is undefined", () => {
    expect(
      getGithubCredentialStatus({ GITHUB_TOKEN: undefined, GH_TOKEN: undefined }, () => null),
    ).toMatchObject({
      valid: false,
      issue: "missing",
    });
  });

  it("returns valid for a printable ASCII token", () => {
    expect(
      getGithubCredentialStatus({ GITHUB_TOKEN: "ghp_printable_TOKEN_123" }, () => null),
    ).toMatchObject({
      valid: true,
    });
  });

  it("returns invalid-chars for a token with non-printable chars", () => {
    expect(getGithubCredentialStatus({ GITHUB_TOKEN: "ghp_token\nbad" }, () => null)).toMatchObject(
      {
        valid: false,
        issue: "invalid-chars",
      },
    );
  });

  it("returns valid for GH_TOKEN when GITHUB_TOKEN is unset", () => {
    expect(
      getGithubCredentialStatus(
        { GITHUB_TOKEN: undefined, GH_TOKEN: "ghp_from_GH_TOKEN" },
        () => null,
      ),
    ).toMatchObject({
      valid: true,
      source: "env",
      token: "ghp_from_GH_TOKEN",
    });
  });

  it("falls back to gh CLI token when env tokens are unset", () => {
    expect(
      getGithubCredentialStatus(
        { GITHUB_TOKEN: undefined, GH_TOKEN: undefined },
        () => "ghp_from_cli",
      ),
    ).toMatchObject({
      valid: true,
      source: "gh",
      token: "ghp_from_cli",
    });
  });

  it("returns missing when neither env tokens nor gh CLI token exist", () => {
    expect(
      getGithubCredentialStatus({ GITHUB_TOKEN: undefined, GH_TOKEN: undefined }, () => null),
    ).toMatchObject({
      valid: false,
      issue: "missing",
    });
  });
});

describe("resolveIssueRepo", () => {
  const originalIssueRepo = process.env.FIGDIFF_ISSUE_REPO;

  beforeEach(() => {
    delete process.env.FIGDIFF_ISSUE_REPO;
  });

  afterEach(() => {
    if (originalIssueRepo === undefined) delete process.env.FIGDIFF_ISSUE_REPO;
    else process.env.FIGDIFF_ISSUE_REPO = originalIssueRepo;
    vi.unstubAllGlobals();
  });

  it("returns kouiso/designdiff by default", () => {
    expect(resolveIssueRepo()).toEqual({ owner: "kouiso", repo: "designdiff" });
  });

  it("reads owner and repo from FIGDIFF_ISSUE_REPO", () => {
    process.env.FIGDIFF_ISSUE_REPO = "octo/example";

    expect(resolveIssueRepo()).toEqual({ owner: "octo", repo: "example" });
  });

  it.each([
    "octo/example/extra",
    "octo/",
    "/example",
    "-octo/example",
    "octo-/example",
    "octo/repo?tab=issues",
    "octo/..",
  ])("rejects an unsafe repository target: %s", (repository) => {
    process.env.FIGDIFF_ISSUE_REPO = repository;

    expect(() => resolveIssueRepo()).toThrow(/安全な GitHub owner\/repo/);
  });

  it("does not repeat an invalid setting in its error", () => {
    process.env.FIGDIFF_ISSUE_REPO = "ghp_secret_value";

    expect(() => resolveIssueRepo()).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("ghp_secret_value") }),
    );
  });
});

describe("GithubService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("dedupes createIssue when an open issue has the same title", async () => {
    const title = "Visual regression";
    const fetchMock = vi.fn(async (): Promise<Response> => {
      return new Response(
        JSON.stringify({
          items: [
            {
              number: 123,
              html_url: "https://github.com/kouiso/designdiff/issues/123",
              title,
            },
          ],
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const service = new GithubService("ghp_printable_TOKEN_123");
    const result = await service.createIssue({
      owner: "kouiso",
      repo: "designdiff",
      title,
      body: "body",
    });

    expect(result).toEqual({
      number: 123,
      html_url: "https://github.com/kouiso/designdiff/issues/123",
      deduped: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("creates an issue when no duplicate exists", async () => {
    const fetchMock = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            number: 456,
            html_url: "https://github.com/kouiso/designdiff/issues/456",
          }),
          { status: 201 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const service = new GithubService("ghp_printable_TOKEN_123");
    const result = await service.createIssue({
      owner: "kouiso",
      repo: "designdiff",
      title: "Visual regression",
      body: "body",
    });

    expect(result).toEqual({
      number: 456,
      html_url: "https://github.com/kouiso/designdiff/issues/456",
      deduped: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const postCall = fetchMock.mock.calls[1];
    expect(postCall).toBeDefined();
    if (!postCall) throw new Error("Expected issue creation request");
    expect(String(postCall[0])).toBe("https://api.github.com/repos/kouiso/designdiff/issues");
    expect(postCall[1]).toMatchObject({ method: "POST" });
    expect(postCall[1]?.body).toBe(
      JSON.stringify({ title: "Visual regression", body: "body", labels: [] }),
    );
  });

  it("distinguishes an unavailable search from no duplicate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("rate limited", { status: 403 })),
    );

    const result = await new GithubService("ghp_printable_TOKEN_123").searchOpenIssueByTitle(
      "kouiso",
      "designdiff",
      "Visual regression",
    );

    expect(result).toEqual({
      status: "unavailable",
      reason: "http",
      statusCode: 403,
      message: "GitHub issue search failed with status 403",
    });
  });

  it("treats a malformed successful response as unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ unexpected: [] }))),
    );

    const result = await new GithubService("ghp_printable_TOKEN_123").searchOpenIssueByTitle(
      "kouiso",
      "designdiff",
      "Visual regression",
    );

    expect(result).toEqual({
      status: "unavailable",
      reason: "invalid-response",
      message: "GitHub issue search response is invalid",
    });
  });

  it("returns unavailable instead of throwing when the search request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network unavailable");
      }),
    );

    const result = await new GithubService("ghp_printable_TOKEN_123").searchOpenIssueByTitle(
      "kouiso",
      "designdiff",
      "Visual regression",
    );

    expect(result).toEqual({
      status: "unavailable",
      reason: "request-error",
      message: "network unavailable",
    });
  });

  it("keeps request failures throwable through the legacy find method", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network unavailable");
      }),
    );

    await expect(
      new GithubService("ghp_printable_TOKEN_123").findOpenIssueByTitle(
        "kouiso",
        "designdiff",
        "Visual regression",
      ),
    ).rejects.toThrow("network unavailable");
  });

  it("does not create when duplicate checking is required but unavailable", async () => {
    const fetchMock = vi.fn(async () => new Response("rate limited", { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new GithubService("ghp_printable_TOKEN_123").createIssue({
        owner: "kouiso",
        repo: "designdiff",
        title: "Visual regression",
        body: "body",
        labels: ["bug"],
        requireDuplicateCheck: true,
      }),
    ).rejects.toThrow(/重複を確認できませんでした/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the existing create behavior when duplicate checking is not required", async () => {
    const fetchMock = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(new Response("rate limited", { status: 403 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            number: 789,
            html_url: "https://github.com/kouiso/designdiff/issues/789",
          }),
          { status: 201 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new GithubService("ghp_printable_TOKEN_123").createIssue({
        owner: "kouiso",
        repo: "designdiff",
        title: "Visual regression",
        body: "body",
      }),
    ).resolves.toEqual({
      number: 789,
      html_url: "https://github.com/kouiso/designdiff/issues/789",
      deduped: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps request failures as errors when duplicate checking is not required", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network unavailable");
      }),
    );

    await expect(
      new GithubService("ghp_printable_TOKEN_123").createIssue({
        owner: "kouiso",
        repo: "designdiff",
        title: "Visual regression",
        body: "body",
      }),
    ).rejects.toThrow("network unavailable");
  });
});

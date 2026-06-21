import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  getGithubCredentialStatus,
  GithubService,
  resolveIssueRepo,
  sanitizeForPublicIssue,
} from "./github-service.js";

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

describe("sanitizeForPublicIssue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("replaces Linux home paths with a tilde path", () => {
    const result = sanitizeForPublicIssue("screenshot: /home/alice/project/out.png", true);

    expect(result.text).toBe("screenshot: ~/project/out.png");
  });

  it("replaces macOS user paths with a tilde path", () => {
    const result = sanitizeForPublicIssue("screenshot: /Users/alice/project/out.png", true);

    expect(result.text).toBe("screenshot: ~/project/out.png");
  });

  it("redacts ghp tokens", () => {
    const result = sanitizeForPublicIssue("token ghp_abcdef123456", true);

    expect(result.text).toBe("token [REDACTED]");
  });

  it("redacts figd tokens", () => {
    const result = sanitizeForPublicIssue("token figd_abcdef123456", true);

    expect(result.text).toBe("token [REDACTED]");
  });

  it("redacts figma.com URLs when includeDesignSource is false", () => {
    const result = sanitizeForPublicIssue(
      "source https://figma.com/design/FILEKEY/Title?node-id=1-2",
      false,
    );

    expect(result.text).toBe("source https://[FIGMA_URL_REDACTED]");
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
});
